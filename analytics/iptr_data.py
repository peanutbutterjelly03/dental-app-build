"""Load and clean the IPTR workbook.

Every step here mirrors the cleaning in the Group 13 notebook so the dashboard
and the notebook cannot drift apart. Nothing is imputed: missing stays missing,
and every correction the loader makes is recorded in the audit dictionary so the
Data quality tab can report it instead of hiding it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

TARGET = "Risk Classification"
DEFAULT_SHEET = "Raw Copy of Manual Encoded"

RENAME_MAP = {
    "Number of Permanent Decayed Teeth D": "Perm_Decayed",
    "Number of Permanent Missing Teeth M": "Perm_Missing",
    "Number of Permanent Filled Teeth F": "Perm_Filled",
    "Number of Permanent Teeth for Extraction X": "Perm_ForExtraction",
    "Number of Permanent DMFX Teeth DMFX": "Perm_DMFX",
    "Number of Permanent Teeth Present": "Perm_Present",
    "Number of Permanent Sound Teeth": "Perm_Sound",
    "Number of Temporary decayed teeth d": "Temp_Decayed",
    "Number of Temporary Teeth for Filled f": "Temp_Filled",
    "Number of temporary missing teeth m": "Temp_Missing",
    "Number of Temporary Teeth for Extraction x": "Temp_ForExtraction",
    "Number of Temporary dfx teeth dmfxt": "Temp_dfx",
    "Number of Temporary Teeth Present": "Temp_Present",
    "Number of Temporary Sound Teeth": "Temp_Sound",
    "TOTAL DMFX+dmfx": "Total_DMFX_dmfx",
    "Gingivities": "Gingivitis",
    "Weight (kg)": "Weight",
    "Height (m)": "Height",
}

NUMERIC_COLS = [
    "Age", "Weight", "Height", "BMI",
    "Perm_Present", "Perm_Sound", "Perm_Decayed", "Perm_Missing", "Perm_Filled",
    "Perm_ForExtraction", "Perm_DMFX",
    "Temp_Present", "Temp_Sound", "Temp_Decayed", "Temp_Filled", "Temp_Missing",
    "Temp_ForExtraction", "Temp_dfx", "Total_DMFX_dmfx",
]

FLAG_SOURCES = ["Dental Caries", "Gingivitis", "Debris", "Calculus"]
OFC_SOURCE = "OFC Upon Oral Examination"

YES_TOKENS = ["yes", "y", "yse", "1", "true"]

AGE_MIN, AGE_MAX = 3, 20
BMI_MIN, BMI_MAX = 8, 40

GRADE_ORDER = ["Kinder", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]


def sheet_names(source) -> list[str]:
    return pd.ExcelFile(source).sheet_names


def sheet_sizes(source) -> pd.DataFrame:
    """Row and column count of every sheet, so the sheet choice is documented."""
    xl = pd.ExcelFile(source)
    rows = []
    for name in xl.sheet_names:
        header = 1 if "Manual Encoded" in name else 0
        tmp = pd.read_excel(xl, sheet_name=name, header=header)
        rows.append({"Sheet": name, "Rows": tmp.shape[0], "Columns": tmp.shape[1],
                     "Header row": header + 1,
                     "Has label column": TARGET in [str(c).replace("\n", " ").strip()
                                                    for c in tmp.columns]})
    return pd.DataFrame(rows)


def _to_flag(series: pd.Series) -> np.ndarray:
    s = series.astype(str).str.strip().str.lower()
    return np.where(s.isin(YES_TOKENS), 1, 0)


def _raw_values(series: pd.Series) -> list[str]:
    return sorted(series.dropna().astype(str).str.strip().unique().tolist())


def load_sheet(source, sheet: str, header: int = 1) -> pd.DataFrame:
    df = pd.read_excel(source, sheet_name=sheet, header=header)
    df.columns = [str(c).replace("\n", " ").strip() for c in df.columns]
    return df


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Return the labelled, cleaned subset plus an audit of what was corrected."""
    audit: dict = {"raw_rows": len(df), "raw_cols": df.shape[1]}

    if TARGET not in df.columns:
        raise KeyError(
            f"Column '{TARGET}' is not on this sheet. Pick the sheet that carries "
            f"the caries risk label (usually '{DEFAULT_SHEET}')."
        )

    audit["label_raw_values"] = _raw_values(df[TARGET])
    audit["unlabelled"] = int(df[TARGET].isna().sum())

    data = df[df[TARGET].notna()].copy()
    data[TARGET] = data[TARGET].astype(str).str.strip().str.title()
    audit["labelled"] = len(data)

    # Columns that are entirely empty inside the labelled subset carry no
    # information; they are dropped rather than imputed.
    non_empty = data.columns[data.notna().sum() > 0]
    audit["empty_cols_dropped"] = int(data.shape[1] - len(non_empty))
    data = data[non_empty]
    audit["cols_retained"] = data.shape[1]

    data = data.rename(columns={k: v for k, v in RENAME_MAP.items() if k in data.columns})

    # Counts encoded as text become missing rather than silently breaking maths.
    coerced = {}
    for c in NUMERIC_COLS:
        if c in data.columns:
            before = data[c].notna().sum()
            data[c] = pd.to_numeric(data[c], errors="coerce")
            lost = int(before - data[c].notna().sum())
            if lost:
                coerced[c] = lost
    audit["non_numeric_coerced"] = coerced

    # Yes / no findings -> binary flags. The raw spellings are kept for the report.
    flag_variants = {}
    for c in FLAG_SOURCES:
        if c in data.columns:
            flag_variants[c] = _raw_values(data[c])
            data[c + "_Flag"] = _to_flag(data[c])
    if OFC_SOURCE in data.columns:
        flag_variants["OFC"] = _raw_values(data[OFC_SOURCE])
        data["OFC_Flag"] = _to_flag(data[OFC_SOURCE])
    audit["flag_variants"] = flag_variants

    # Impossible values: a mis-typed birth year, or a BMI divided by a blank height.
    if "Age" in data.columns:
        audit["age_range_before"] = (float(data["Age"].min()), float(data["Age"].max()))
        out_of_range = data[(data["Age"] < AGE_MIN) | (data["Age"] > AGE_MAX)]
        audit["age_out_of_range"] = int(len(out_of_range))
        audit["age_out_of_range_values"] = sorted(out_of_range["Age"].dropna().unique().tolist())
        data.loc[(data["Age"] < AGE_MIN) | (data["Age"] > AGE_MAX), "Age"] = np.nan
        audit["age_range_after"] = (float(data["Age"].min()), float(data["Age"].max()))

    if {"BMI", "Weight", "Height"} <= set(data.columns):
        height_safe = data["Height"].replace(0, np.nan)
        data["BMI"] = data["BMI"].replace(0, np.nan)
        audit["bmi_blank_or_zero"] = int(data["BMI"].isna().sum())
        recomputed = data["Weight"] / (height_safe ** 2)
        data["BMI"] = data["BMI"].fillna(recomputed)
        audit["bmi_recomputed"] = int(audit["bmi_blank_or_zero"] - data["BMI"].isna().sum())
        implausible = ((data["BMI"] < BMI_MIN) | (data["BMI"] > BMI_MAX)).sum()
        audit["bmi_out_of_range"] = int(implausible)
        data.loc[(data["BMI"] < BMI_MIN) | (data["BMI"] > BMI_MAX), "BMI"] = np.nan

    # Categorical text. Sex was encoded with stray punctuation and doubled letters,
    # which would otherwise split one real category into several.
    if "Sex" in data.columns:
        audit["sex_raw_values"] = _raw_values(data["Sex"])
        sex = data["Sex"].astype(str).str.strip().str.upper()
        audit["sex_repaired"] = int((~sex.isin(["M", "F"]) & sex.ne("NAN")).sum())
        data["Sex"] = pd.Series(
            np.where(sex.str.startswith("F"), "F",
                     np.where(sex.str.startswith("M"), "M", None)),
            index=data.index, dtype=object)
    if "Grade" in data.columns:
        data["Grade"] = (data["Grade"].astype(str).str.strip().str.title()
                         .replace({"Nan": np.nan}))
        data["Grade"] = data["Grade"].str.replace(r"^Grade\s*", "", regex=True)
        data["Grade"] = data["Grade"].str.replace(r"\.0$", "", regex=True)
    if "Nutritional Status" in data.columns:
        data["Nutritional Status"] = (data["Nutritional Status"].astype(str)
                                      .str.replace(r"\s+", " ", regex=True)
                                      .str.strip().str.title().replace({"Nan": np.nan}))

    # Exact duplicates are encoding repeats. Repeated names are reported, never
    # dropped: a learner examined twice is two valid rows.
    audit["exact_duplicates"] = int(data.duplicated().sum())
    data = data.drop_duplicates().reset_index(drop=True)
    if "Full Name" in data.columns:
        audit["repeated_names"] = int(data["Full Name"].duplicated().sum())

    audit["clean_rows"] = len(data)
    return data, audit


def grade_order(values) -> list[str]:
    present = [g for g in values if pd.notna(g)]
    known = [g for g in GRADE_ORDER if g in present]
    return known + sorted([g for g in set(present) if g not in GRADE_ORDER])


def ofc_contradictions(data: pd.DataFrame, threshold: int = 2) -> pd.DataFrame:
    """Rows ticked Orally Fit Child while carrying affected teeth."""
    if "OFC_Flag" not in data.columns or "Total_DMFX_dmfx" not in data.columns:
        return pd.DataFrame()
    hit = data[(data["OFC_Flag"] == 1) & (data["Total_DMFX_dmfx"] >= threshold)]
    cols = [c for c in ["Full Name", "Grade", "Section", "Age", "Sex",
                        "Perm_DMFX", "Temp_dfx", "Total_DMFX_dmfx", TARGET]
            if c in hit.columns]
    return hit[cols].sort_values("Total_DMFX_dmfx", ascending=False)


def derived_rule(data: pd.DataFrame) -> dict | None:
    """Recover the cut-off the encoder applied, and measure how well it holds.

    The thresholds are read off the data (max count seen in Low, max in Medium),
    never hard-coded, so a workbook that was labelled differently reports
    differently instead of being forced into last year's rule.
    """
    if "Total_DMFX_dmfx" not in data.columns:
        return None
    d = data[["Total_DMFX_dmfx", TARGET]].dropna()
    if d.empty or d[TARGET].nunique() < 2:
        return None

    stats = d.groupby(TARGET)["Total_DMFX_dmfx"].agg(["count", "min", "max"])
    low_max = stats.loc["Low", "max"] if "Low" in stats.index else None
    med_max = stats.loc["Medium", "max"] if "Medium" in stats.index else None
    if low_max is None or med_max is None:
        return None

    def predict(v):
        if v <= low_max:
            return "Low"
        if v <= med_max:
            return "Medium"
        return "High"

    pred = d["Total_DMFX_dmfx"].map(predict)
    agree = (pred == d[TARGET])
    return {
        "stats": stats,
        "low_max": int(low_max),
        "med_max": int(med_max),
        "conformance": float(agree.mean() * 100),
        "breaking_rows": int((~agree).sum()),
        "n": int(len(d)),
    }
