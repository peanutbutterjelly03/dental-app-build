"""Sprint 21a — clean + standardize raw dental IPTR Excel files.

Reads every .xlsx in the input directory (originals are never modified),
maps each file's own column names onto canonical IPTR fields, normalizes
values (dates → YYYY-MM-DD, booleans → true/false/null, sex → M/F,
grade → 0-10 where 0 = Kinder), DROPS all name columns entirely (privacy:
names are never needed for training — rows are identified by a generated
student_id placeholder instead), removes junk/summary rows and exact
duplicates, and writes:

    data/cleaned/dataset.csv     (UTF-8)
    data/cleaning-report.md

Currently pointed at data/raw-synthetic/ (SYNTHETIC placeholder data).
When the real IPTR files arrive, drop them in data/raw/ and run:

    python ml-service/pipeline/clean_excel.py data/raw

Unknown column names in the real files just need new entries in
COLUMN_SYNONYMS below — the rest of the pipeline is format-agnostic.
"""

import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IN = REPO_ROOT / "data" / "raw-synthetic"
DEFAULT_OUT_DIR = REPO_ROOT / "data"

# normalized header (lowercase, alphanumeric only, parenthesized parts stripped)
# → canonical field name. "__drop__" = known-but-unused (logged in the report).
COLUMN_SYNONYMS: dict[str, str] = {
    # student name — mapped only so we can consciously DROP it (privacy)
    "nameofpupil": "__name__", "studentname": "__name__", "pupilsname": "__name__",
    "name": "__name__", "learnersname": "__name__", "nameoflearner": "__name__",
    # the clinic's own encoding template ("Raw Copy of Manual Encoded", the
    # classmate's workbook, 2026-10-04): names are split across four columns
    "fullname": "__name__", "surname": "__name__", "lastname": "__name__",
    "firstname": "__name__", "middleinitial": "__name__", "middlename": "__name__",
    # identity / demographics
    "dateofbirth": "birthday", "birthday": "birthday", "birthdate": "birthday",
    "dob": "birthday", "birthdate2": "birthday",
    "sex": "sex", "gender": "sex", "sexmf": "sex",
    "grade": "grade", "gradelevel": "grade",
    "section": "section",
    "gradesection": "__grade_section__",  # combined "3-Rose" style, split below
    # DMF components + total (PRIMARY variable)
    "d": "decayed_count", "decayed": "decayed_count",
    "noofdecayedteeth": "decayed_count", "decayedcount": "decayed_count",
    "m": "missing_count", "missing": "missing_count",
    "noofmissingteeth": "missing_count", "missingcount": "missing_count",
    "f": "filled_count", "filled": "filled_count",
    "nooffilledteeth": "filled_count", "filledcount": "filled_count",
    "dmfscore": "dmf_score", "dmft": "dmf_score", "dmf": "dmf_score",
    "dmfindex": "dmf_score", "dmfscore2": "dmf_score",
    # the clinic's template counts permanent (D/M/F) and temporary (d/m/f)
    # teeth in separate columns. Both map to the same field and are SUMMED,
    # because the app sends the model decayed = D + d, missing = M + m,
    # filled = F + f (shared/riskCandidates.ts). Its "TOTAL DMFX+dmfx" and
    # "Number of Permanent DMFX Teeth" are deliberately NOT mapped: they include
    # X (indicated for extraction), which the app's DMF does not, so dmf_score
    # is derived as D + M + F instead (see clean_file).
    "numberofpermanentdecayedteethd": "decayed_count",
    "numberoftemporarydecayedteethd": "decayed_count",
    "numberofpermanentmissingteethm": "missing_count",
    "numberoftemporarymissingteethm": "missing_count",
    "numberofpermanentfilledteethf": "filled_count",
    "numberoftemporaryteethforfilledf": "filled_count",
    # oral health conditions
    "gingivitis": "gingivitis", "gingvitis": "gingivitis",  # common misspelling
    "gingivities": "gingivitis",  # the clinic template's spelling
    "periodontaldisease": "periodontal_disease", "periodontal": "periodontal_disease",
    "periodontitis": "periodontal_disease", "periodontaldse": "periodontal_disease",
    "debris": "debris",
    "calculus": "calculus",
    "abnormalgrowth": "abnormal_growth", "growth": "abnormal_growth",
    # dietary / social habits
    "sugarydrinks": "sugar_beverages", "sugarbeverages": "sugar_beverages",
    "sugarybev": "sugar_beverages",
    "sugarsweetenedbeveragesfooddrinkereater": "sugar_beverages",
    "tobaccouse": "tobacco_user", "tobacco": "tobacco_user",
    "tobaccouser": "tobacco_user",
    # risk assessment (dentist-recorded, when present)
    "risklevel": "risk_level", "cariesrisk": "risk_level", "risk": "risk_level",
    "cariesriskassessment": "risk_level",
    "riskclassification": "risk_level",  # the clinic template: the dentist's label
    # visit date
    "dateoforalexamination": "visit_date", "examdate": "visit_date",
    "visitdate": "visit_date", "dateexamined": "visit_date",
    "dateofexam": "visit_date",
    # known-but-unused (sparse free text / notes) — dropped, but reported
    "remarks": "__drop__", "medicalhistory": "__drop__", "allergies": "__drop__",
}

SCHOOL_FROM_FILENAME = [
    ("btis", "Bagong Tanyag Integrated School"),
    ("annex", "Bagong Tanyag Elementary School Annex A"),
    ("sdhes", "South Daang Hari Elementary School Main"),
]

TRUE_TOKENS = {"yes", "y", "true", "1", "✓", "x"}
FALSE_TOKENS = {"no", "n", "false", "0"}
MISSING_TOKENS = {"", "na", "n/a", "-", "none", "null"}

DATE_FORMATS = ["%m/%d/%Y", "%d-%b-%Y", "%Y-%m-%d", "%m/%d/%y", "%B %d, %Y"]
# Used for a column whose heading says "dd/mm" (the clinic template's
# "Date of Birth (dd/mm/yyyy)"): month-first would silently turn 05/03 into
# May 3 instead of March 5.
DATE_FORMATS_DAY_FIRST = ["%d/%m/%Y", "%d-%b-%Y", "%Y-%m-%d", "%d/%m/%y", "%B %d, %Y"]

RISK_MAP = {
    "high": "High", "highrisk": "High", "h": "High",
    "medium": "Medium", "moderate": "Medium", "m": "Medium",
    "low": "Low", "lowrisk": "Low", "l": "Low",
}

BOOL_FIELDS = ["gingivitis", "periodontal_disease", "debris", "calculus",
               "abnormal_growth", "sugar_beverages", "tobacco_user"]
NUM_FIELDS = ["decayed_count", "missing_count", "filled_count", "dmf_score"]

OUTPUT_COLUMNS = ["student_id", "school", "source_file", "birthday", "sex",
                  "grade", "section"] + NUM_FIELDS + BOOL_FIELDS + \
                 ["visit_date", "risk_level"]


def norm_header(h) -> str:
    # pandas renames a repeated heading "X", "X.1", "X.2"; the clinic template
    # has "Date of Birth (dd/mm//yyyy)" twice, so drop that suffix first
    s = re.sub(r"\.\d+$", "", str(h))
    s = unicodedata.normalize("NFKD", s).lower()
    s = re.sub(r"\(.*?\)", "", s)          # strip "(1/0)", "(M/F)" qualifiers
    return re.sub(r"[^a-z0-9]", "", s)


def find_header_row(raw: pd.DataFrame) -> int:
    """Real files often have title rows above the header — find the first row
    that contains a recognizable name-ish column."""
    for i in range(min(10, len(raw))):
        normed = {norm_header(v) for v in raw.iloc[i] if pd.notna(v)}
        if normed & {k for k, v in COLUMN_SYNONYMS.items() if v == "__name__"}:
            return i
    raise ValueError("no header row found in first 10 rows")


def parse_date(value, issues: list[str], day_first: bool = False) -> str | None:
    if pd.isna(value) or str(value).strip().lower() in MISSING_TOKENS:
        return None
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.strftime("%Y-%m-%d")
    s = str(value).strip()
    for fmt in (DATE_FORMATS_DAY_FIRST if day_first else DATE_FORMATS):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    issues.append(f"unparseable date: {s!r}")
    return None


def parse_bool(value, issues: list[str]):
    if pd.isna(value):
        return None
    s = str(value).strip().lower()
    if s in MISSING_TOKENS:
        return None
    if s in TRUE_TOKENS:
        return True
    if s in FALSE_TOKENS:
        return False
    issues.append(f"unknown boolean token: {value!r}")
    return None


def parse_num(value):
    if pd.isna(value) or str(value).strip().lower() in MISSING_TOKENS:
        return None
    n = pd.to_numeric(value, errors="coerce")
    return None if pd.isna(n) else float(n)


def parse_grade(value):
    """'Kinder'/'K' → 0, 'Grade 3'/'G3'/'3' → 3."""
    if pd.isna(value):
        return None
    s = str(value).strip().lower()
    if s in MISSING_TOKENS:
        return None
    if s in ("k", "kinder", "kindergarten"):
        return 0
    m = re.search(r"(\d+)", s)
    return int(m.group(1)) if m else None


def parse_sex(value, issues: list[str]):
    if pd.isna(value):
        return None
    s = str(value).strip().lower()
    if s in MISSING_TOKENS:
        return None
    if s in ("m", "male", "lalaki"):
        return "M"
    if s in ("f", "female", "babae"):
        return "F"
    issues.append(f"unknown sex token: {value!r}")
    return None


def parse_risk(value):
    if pd.isna(value):
        return None
    s = re.sub(r"[^a-z]", "", str(value).strip().lower())
    return RISK_MAP.get(s)


def clean_file(path: Path, report: dict) -> pd.DataFrame:
    raw = pd.read_excel(path, header=None)
    header_row = find_header_row(raw)
    df = pd.read_excel(path, header=header_row)
    df = df.dropna(axis=1, how="all")

    issues: list[str] = []
    mapping: dict[str, str] = {}
    unmapped: list[str] = []
    for col in df.columns:
        canon = COLUMN_SYNONYMS.get(norm_header(col))
        if canon:
            mapping[col] = canon
        else:
            unmapped.append(str(col))

    has_dmf_column = "dmf_score" in mapping.values()

    school = next((name for key, name in SCHOOL_FROM_FILENAME
                   if key in path.name.lower()), "UNKNOWN")

    out_rows = []
    junk_rows = 0
    for _, row in df.iterrows():
        rec: dict = {"school": school, "source_file": path.name}
        # every name column's text, joined: used only to spot duplicates. A
        # template that splits names into four columns must not collapse to
        # its last one (the middle initial), or different pupils would match.
        name_parts: list[str] = []
        for col, canon in mapping.items():
            v = row[col]
            if canon == "__name__":
                if pd.notna(v) and str(v).strip():
                    name_parts.append(str(v).strip())
            elif canon == "__grade_section__":
                if pd.notna(v) and "-" in str(v):
                    g, _, sec = str(v).partition("-")
                    rec["grade"] = parse_grade(g)
                    rec["section"] = sec.strip().title()
            elif canon == "__drop__":
                continue
            elif canon == "birthday" or canon == "visit_date":
                parsed = parse_date(v, issues, day_first="dd/mm" in str(col).lower())
                # a template can carry the same date twice (a real date and a
                # typed copy): keep the first that reads, never overwrite with None
                if parsed is not None or canon not in rec:
                    rec[canon] = rec.get(canon) or parsed
            elif canon == "sex":
                rec[canon] = parse_sex(v, issues)
            elif canon == "grade":
                rec[canon] = parse_grade(v)
            elif canon == "section":
                rec[canon] = None if pd.isna(v) else str(v).strip().title()
            elif canon in NUM_FIELDS:
                # several columns may feed one count (permanent + temporary): sum
                n = parse_num(v)
                if n is not None:
                    rec[canon] = (rec.get(canon) or 0) + n
                else:
                    rec.setdefault(canon, None)
            elif canon in BOOL_FIELDS:
                rec[canon] = parse_bool(v, issues)
            elif canon == "risk_level":
                rec[canon] = parse_risk(v)

        # A file with NO DMF column of its own (the clinic template): D + M + F,
        # the same sum the app sends the model, when at least one count was
        # given. A file that HAS a DMF column keeps a blank cell blank, as before.
        if not has_dmf_column:
            parts = [rec.get(k) for k in ("decayed_count", "missing_count", "filled_count")]
            if any(p is not None for p in parts):
                rec["dmf_score"] = sum(p or 0 for p in parts)

        # junk/summary rows (e.g. a "TOTAL" footer): no birthday, no sex, and
        # no per-tooth counts → not a student record
        if rec.get("birthday") is None and rec.get("sex") is None \
                and rec.get("decayed_count") is None:
            junk_rows += 1
            continue
        # used only for duplicate detection, then dropped
        rec["_dedupe_name"] = " ".join(name_parts) or None
        out_rows.append(rec)

    report[path.name] = {
        "columns_found": [str(c) for c in df.columns],
        "mapping": {c: m for c, m in mapping.items() if not m.startswith("__")},
        "name_columns_dropped": [c for c, m in mapping.items() if m == "__name__"],
        "unused_columns": [c for c, m in mapping.items() if m == "__drop__"] + unmapped,
        "raw_rows": len(df),
        "junk_rows_removed": junk_rows,
        "value_issues": issues,
    }
    return pd.DataFrame(out_rows)


def main() -> None:
    in_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IN
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT_DIR
    files = sorted(in_dir.glob("*.xlsx"))
    if not files:
        raise SystemExit(f"no .xlsx files found in {in_dir}")

    report: dict = {}
    frames = [clean_file(p, report) for p in files]
    df = pd.concat(frames, ignore_index=True)

    # exact duplicates (same name + birthday + school + visit date)
    before = len(df)
    df = df.drop_duplicates(
        subset=["_dedupe_name", "birthday", "school", "grade", "section", "visit_date"])
    duplicates_removed = before - len(df)
    df = df.drop(columns=["_dedupe_name"])  # names never reach the output

    df = df.reset_index(drop=True)
    df.insert(0, "student_id", [f"SYNTH_{i + 1:05d}" for i in df.index])
    df = df.reindex(columns=OUTPUT_COLUMNS)

    cleaned_dir = out_dir / "cleaned"
    cleaned_dir.mkdir(parents=True, exist_ok=True)
    csv_path = cleaned_dir / "dataset.csv"
    df.to_csv(csv_path, index=False, encoding="utf-8")

    # ---- cleaning report ----
    lines = [
        "# Data Cleaning Report — Sprint 21a",
        "",
        f"Generated: {datetime.now():%Y-%m-%d %H:%M}",
        "",
        "> **SYNTHETIC DATA NOTICE**: this run used generated placeholder files",
        "> (`data/raw-synthetic/`), not real IPTR records. Rerun this pipeline on",
        "> `data/raw/` when the real Excel files arrive; this report regenerates.",
        "",
        "## Privacy",
        "All student-name columns were **dropped entirely** during cleaning (used",
        "only transiently for duplicate detection, never written to any output).",
        "Rows are identified by a generated `student_id` placeholder.",
        "",
        "## Summary",
        f"- Files processed: {len(files)}",
        f"- Raw rows: {sum(r['raw_rows'] for r in report.values())}",
        f"- Junk/summary rows removed: {sum(r['junk_rows_removed'] for r in report.values())}",
        f"- Exact duplicates removed: {duplicates_removed}",
        f"- **Final records: {len(df)}**",
        "",
        "## Field completeness (% non-null)",
        "",
        "| Field | Complete |",
        "|---|---|",
    ]
    for col in OUTPUT_COLUMNS:
        pct = 100 * df[col].notna().mean()
        lines.append(f"| {col} | {pct:.1f}% |")
    lines += [
        "",
        "Note: oral-condition and dietary/social-habit fields are sparse **by",
        "design of the source forms** — clinic staff usually tick only positives,",
        "so a blank cell generally means the condition was not observed rather",
        "than not examined. Feature engineering (Sprint 21b) treats null booleans",
        "as `false` for this reason, documented there.",
        "",
        "## Per-file detail",
        "",
    ]
    for fname, r in report.items():
        lines += [
            f"### {fname}",
            f"- Raw rows: {r['raw_rows']} (junk removed: {r['junk_rows_removed']})",
            f"- Name column(s) dropped: {', '.join(r['name_columns_dropped']) or '—'}",
            f"- Unused columns (notes/free text/unrecognized): {', '.join(r['unused_columns']) or '—'}",
            "- Column mapping: " + "; ".join(f"`{c}` → `{m}`" for c, m in r["mapping"].items()),
            f"- Value issues: {len(r['value_issues'])}"
            + (f" (e.g. {r['value_issues'][0]})" if r["value_issues"] else ""),
            "",
        ]
    (out_dir / "cleaning-report.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"cleaned dataset: {csv_path} ({len(df)} records)")
    print(f"report: {out_dir / 'cleaning-report.md'}")
    print("\nrisk_level distribution (recorded by dentist, where present):")
    print(df["risk_level"].value_counts(dropna=False).to_string())


if __name__ == "__main__":
    main()
