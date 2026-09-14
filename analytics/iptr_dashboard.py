"""IPTR Dental EDA Dashboard — Group 13.

Reads the IPTR workbook, applies the notebook's cleaning steps, and reports what
the encoded records actually contain. Every figure on screen is computed from the
file that is loaded; nothing is sampled, rounded up, or filled in for effect. If a
filter empties the set, the panel says so instead of drawing an empty axis.

Run:  streamlit run iptr_dashboard.py
"""

from __future__ import annotations

import io
import os
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import iptr_data as idata
from iptr_data import TARGET
from iptr_theme import RISK_ORDER, STATUS, palette, style

st.set_page_config(page_title="IPTR Dental EDA", page_icon="🦷", layout="wide")


# ── theme ────────────────────────────────────────────────────────────────────
def active_palette() -> dict:
    try:
        mode = st.context.theme.type or "light"
    except Exception:
        mode = "light"
    return palette(mode)


P = active_palette()

st.markdown(
    f"""<style>
    .block-container {{padding-top: 2.2rem; max-width: 1500px;}}
    .stat-card {{border: 1px solid {P['grid']}; border-radius: 10px;
                 padding: 14px 16px; background: {P['surface']}; height: 100%;}}
    .stat-label {{font-size: 0.72rem; letter-spacing: .04em; text-transform: uppercase;
                  color: {P['muted']};}}
    .stat-value {{font-size: 1.7rem; font-weight: 650; color: {P['ink']}; line-height: 1.25;}}
    .stat-note {{font-size: 0.78rem; color: {P['ink_secondary']};}}
    .flag-row {{display: flex; gap: 8px; align-items: baseline; padding: 6px 0;
                border-bottom: 1px solid {P['grid']};}}
    </style>""",
    unsafe_allow_html=True,
)


def stat(col, label: str, value: str, note: str = "") -> None:
    col.markdown(
        f"<div class='stat-card'><div class='stat-label'>{label}</div>"
        f"<div class='stat-value'>{value}</div>"
        f"<div class='stat-note'>{note}</div></div>",
        unsafe_allow_html=True,
    )


def table_view(df: pd.DataFrame, label: str = "Show the numbers") -> None:
    with st.expander(label):
        st.dataframe(df, width="stretch")


def empty_note(msg: str = "No records match the current filters.") -> None:
    st.info(msg)


# ── chart builders ───────────────────────────────────────────────────────────
def risk_colors() -> list[str]:
    return [P["risk"][r] for r in RISK_ORDER]


def count_bar(labels, values, *, title: str, color=None, horizontal=False,
              ylab="Learners", xlab="", height=340):
    """Single series: no legend, direct value labels, thin marks."""
    color = color or P["cat"][0]
    txt = [f"{v:,}" for v in values]
    if horizontal:
        fig = go.Figure(go.Bar(
            y=labels, x=values, orientation="h", marker_color=color,
            marker_line=dict(color=P["surface"], width=1.5),
            text=txt, textposition="outside", cliponaxis=False,
            textfont=dict(color=P["ink_secondary"], size=11),
            hovertemplate="%{y}<br>%{x:,} learners<extra></extra>",
        ))
        fig.update_layout(title=title)
        return style(fig, P, height=height, showlegend=False, xlab=ylab)
    fig = go.Figure(go.Bar(
        x=labels, y=values, marker_color=color,
        marker_line=dict(color=P["surface"], width=1.5),
        text=txt, textposition="outside", cliponaxis=False,
        textfont=dict(color=P["ink_secondary"], size=11),
        hovertemplate="%{x}<br>%{y:,} learners<extra></extra>",
    ))
    fig.update_layout(title=title)
    return style(fig, P, height=height, showlegend=False, ylab=ylab, xlab=xlab)


def risk_share_bar(df: pd.DataFrame, dim: str, *, title: str, order=None,
                   horizontal=True, height=380):
    """100% stacked share of risk class within each level of `dim`.

    Colour carries the risk class (ordinal blue ramp, Low -> High); the legend is
    always present and segments over 8% are labelled directly.
    """
    d = df[[dim, TARGET]].dropna()
    if d.empty:
        return None
    ct = pd.crosstab(d[dim], d[TARGET])
    for r in RISK_ORDER:
        if r not in ct.columns:
            ct[r] = 0
    ct = ct[RISK_ORDER]
    if order:
        ct = ct.reindex([o for o in order if o in ct.index])
    share = ct.div(ct.sum(axis=1), axis=0) * 100

    fig = go.Figure()
    for r in RISK_ORDER:
        labels = [f"{v:.0f}%" if v >= 8 else "" for v in share[r]]
        common = dict(
            name=r, marker_color=P["risk"][r],
            marker_line=dict(color=P["surface"], width=2),
            text=labels, textposition="inside", insidetextanchor="middle",
            textfont=dict(color=P["surface"] if r == "High" else P["ink"], size=11),
        )
        if horizontal:
            fig.add_bar(y=ct.index.astype(str), x=share[r], orientation="h",
                        customdata=ct[r],
                        hovertemplate=f"%{{y}} · {r}<br>%{{x:.1f}}%"
                                      "<br>%{customdata:,} learners<extra></extra>",
                        **common)
        else:
            fig.add_bar(x=ct.index.astype(str), y=share[r], customdata=ct[r],
                        hovertemplate=f"%{{x}} · {r}<br>%{{y:.1f}}%"
                                      "<br>%{customdata:,} learners<extra></extra>",
                        **common)
    fig.update_layout(barmode="stack", title=title)
    fig = style(fig, P, height=height)
    if horizontal:
        fig.update_xaxes(title_text="Percent of learners", ticksuffix="%", range=[0, 100])
        fig.update_yaxes(autorange="reversed", type="category", dtick=1)
    else:
        fig.update_yaxes(title_text="Percent of learners", ticksuffix="%", range=[0, 100])
        fig.update_xaxes(type="category", dtick=1)
    return fig, ct


def box_by_risk(df: pd.DataFrame, col: str, *, title: str, height=340):
    d = df[[col, TARGET]].dropna()
    if d.empty:
        return None
    fig = go.Figure()
    for r in RISK_ORDER:
        vals = d.loc[d[TARGET] == r, col]
        if vals.empty:
            continue
        fig.add_box(y=vals, name=r, marker_color=P["risk"][r], line_width=2,
                    boxpoints=False, fillcolor=P["risk"][r], opacity=0.85,
                    hovertemplate=f"{r}<br>median %{{median}}<extra></extra>")
    fig.update_layout(title=title, showlegend=False)
    return style(fig, P, height=height, ylab=col)


# ── data source ──────────────────────────────────────────────────────────────
@st.cache_data(show_spinner=False)
def read_workbook(payload: bytes, sheet: str, header: int):
    return idata.load_sheet(io.BytesIO(payload), sheet, header)


@st.cache_data(show_spinner=False)
def clean_cached(df: pd.DataFrame):
    return idata.clean(df)


@st.cache_data(show_spinner=False)
def sizes_cached(payload: bytes):
    return idata.sheet_sizes(io.BytesIO(payload))


st.sidebar.markdown("### IPTR dataset")
upload = st.sidebar.file_uploader("IPTR_Dataset.xlsx", type=["xlsx", "xlsm"])

# A workbook sitting next to the app (or named in IPTR_DATASET) is picked up
# automatically, so the file does not have to be re-uploaded on every restart.
local_path = Path(os.environ.get("IPTR_DATASET", "IPTR_Dataset.xlsx"))
if upload is None and local_path.is_file():
    raw_bytes, source_name = local_path.read_bytes(), local_path.name
    st.sidebar.caption(f"Reading `{local_path}` from disk.")
elif upload is not None:
    raw_bytes, source_name = upload.getvalue(), upload.name
else:
    raw_bytes, source_name = None, None

if raw_bytes is None:
    st.title("IPTR Dental EDA")
    st.caption("School-based oral health examination records — Bagong Tanyag Integrated School")
    st.warning("Load `IPTR_Dataset.xlsx` from the sidebar to build the dashboard.")
    st.markdown(
        "The dashboard reads one sheet of the workbook, keeps the records that carry a "
        f"**{TARGET}** value, and applies the same cleaning as the notebook: header "
        "flattening, numeric coercion, yes/no flags, impossible-value correction and "
        "exact-duplicate removal. Nothing is imputed and nothing is invented — every "
        "panel is computed from the file you load."
    )
    st.stop()

names = idata.sheet_names(io.BytesIO(raw_bytes))
default_idx = names.index(idata.DEFAULT_SHEET) if idata.DEFAULT_SHEET in names else 0
sheet = st.sidebar.selectbox("Sheet", names, index=default_idx)
header_row = st.sidebar.number_input(
    "Header row (1-based)", min_value=1, max_value=10,
    value=2 if "Manual Encoded" in sheet else 1,
    help="The encoded sheets put merged group labels on row 1, so the real column "
         "names sit on row 2.",
)

raw = read_workbook(raw_bytes, sheet, int(header_row) - 1)
try:
    data, audit = clean_cached(raw)
except KeyError as exc:
    st.error(str(exc).strip('"'))
    st.stop()

# ── filters ──────────────────────────────────────────────────────────────────
st.sidebar.markdown("### Filters")
f = data.copy()

if "Grade" in f.columns:
    grades = idata.grade_order(f["Grade"].dropna().unique())
    pick = st.sidebar.multiselect("Grade", grades, default=grades)
    f = f[f["Grade"].isin(pick)]
if "Sex" in f.columns:
    sexes = sorted(f["Sex"].dropna().unique())
    pick = st.sidebar.multiselect("Sex", sexes, default=sexes)
    f = f[f["Sex"].isin(pick)]
if "Nutritional Status" in f.columns:
    ns = sorted(f["Nutritional Status"].dropna().unique())
    pick = st.sidebar.multiselect("Nutritional status", ns, default=ns)
    f = f[f["Nutritional Status"].isin(pick)]
risk_pick = st.sidebar.multiselect("Risk class", RISK_ORDER, default=RISK_ORDER)
f = f[f[TARGET].isin(risk_pick)]
if "Age" in f.columns and f["Age"].notna().any():
    lo, hi = int(np.nanmin(f["Age"])), int(np.nanmax(f["Age"]))
    if lo < hi:
        a, b = st.sidebar.slider("Age", lo, hi, (lo, hi))
        f = f[f["Age"].between(a, b) | f["Age"].isna()]

st.sidebar.caption(
    f"{len(f):,} of {audit['labelled']:,} labelled records in view. "
    "Records with a blank age are kept by the age filter."
)


# ── header ───────────────────────────────────────────────────────────────────
st.title("IPTR Dental EDA")
st.caption(
    f"{source_name} · sheet “{sheet}” · school-based oral health examination records"
)

tabs = st.tabs(["Overview", "Demographics", "Oral findings", "Caries burden",
                "Data quality", "Label check"])

# ── 1. Overview ──────────────────────────────────────────────────────────────
with tabs[0]:
    c = st.columns(4)
    pct_labelled = audit["labelled"] / audit["raw_rows"] * 100 if audit["raw_rows"] else 0
    stat(c[0], "Records on sheet", f"{audit['raw_rows']:,}",
         f"{audit['raw_cols']} columns as encoded")
    stat(c[1], "Carry a risk label", f"{audit['labelled']:,}",
         f"{pct_labelled:.1f}% — the rest cannot be used for supervised learning")
    stat(c[2], "Columns with data", f"{audit['cols_retained']:,}",
         f"{audit['empty_cols_dropped']} were blank for every labelled record")
    stat(c[3], "In view", f"{len(f):,}",
         "after the sidebar filters")

    st.markdown("")
    if f.empty:
        empty_note()
    else:
        counts = f[TARGET].value_counts().reindex(RISK_ORDER).fillna(0).astype(int)
        share = counts / counts.sum() * 100
        biggest, smallest = counts.idxmax(), counts[counts > 0].idxmin()

        left, right = st.columns([1, 1.35])
        with left:
            fig = go.Figure(go.Bar(
                x=counts.index, y=counts.values, marker_color=risk_colors(),
                marker_line=dict(color=P["surface"], width=2),
                text=[f"{v:,}<br>{s:.1f}%" for v, s in zip(counts.values, share.values)],
                textposition="outside", cliponaxis=False,
                textfont=dict(color=P["ink_secondary"], size=11),
                hovertemplate="%{x} risk<br>%{y:,} learners<extra></extra>",
            ))
            fig.update_layout(title="Caries risk class — counts in view")
            st.plotly_chart(style(fig, P, height=360, showlegend=False, ylab="Learners"),
                            width="stretch")
            table_view(pd.DataFrame({"Learners": counts, "Share %": share.round(1)}))
        with right:
            if "Grade" in f.columns:
                out = risk_share_bar(f, "Grade", title="Risk mix by grade level",
                                     order=idata.grade_order(f["Grade"].dropna().unique()),
                                     height=360)
                if out:
                    fig, ct = out
                    st.plotly_chart(fig, width="stretch")
                    table_view(ct)

        ratio = counts[biggest] / counts[smallest] if counts[smallest] else float("nan")
        st.markdown(
            f"**Class balance.** {biggest} is the largest class at {counts[biggest]:,} "
            f"records and {smallest} the smallest at {counts[smallest]:,} — a ratio of "
            f"{ratio:.1f} to 1. Accuracy would flatter a model that simply predicted "
            f"{biggest} every time, so macro-averaged F1 is the metric to compare on."
        )

# ── 2. Demographics ──────────────────────────────────────────────────────────
with tabs[1]:
    if f.empty:
        empty_note()
    else:
        c1, c2 = st.columns(2)
        with c1:
            d = f[["Age", TARGET]].dropna()
            if d.empty:
                empty_note("No age values in view.")
            else:
                fig = go.Figure()
                for r in RISK_ORDER:
                    vals = d.loc[d[TARGET] == r, "Age"]
                    if vals.empty:
                        continue
                    fig.add_histogram(x=vals, name=r, marker_color=P["risk"][r],
                                      marker_line=dict(color=P["surface"], width=1),
                                      xbins=dict(size=1),
                                      hovertemplate=f"{r}<br>age %{{x}}"
                                                    "<br>%{y:,} learners<extra></extra>")
                fig.update_layout(barmode="stack", title="Age distribution by risk class")
                st.plotly_chart(style(fig, P, height=360, ylab="Learners", xlab="Age (years)"),
                                width="stretch")
        with c2:
            fig = box_by_risk(f, "BMI", title="BMI by risk class", height=360)
            if fig:
                st.plotly_chart(fig, width="stretch")
                table_view(f.groupby(TARGET)["BMI"].describe().round(2)
                           .reindex([r for r in RISK_ORDER if r in f[TARGET].unique()]))
            else:
                empty_note("No BMI values in view.")

        c3, c4 = st.columns(2)
        with c3:
            if "Sex" in f.columns:
                out = risk_share_bar(f, "Sex", title="Risk mix by sex", height=300)
                if out:
                    fig, ct = out
                    st.plotly_chart(fig, width="stretch")
                    table_view(ct)
        with c4:
            if "Nutritional Status" in f.columns:
                ns_order = ["Severely Wasted", "Wasted", "Normal", "Overweight", "Obese"]
                out = risk_share_bar(f, "Nutritional Status",
                                     title="Risk mix by nutritional status",
                                     order=ns_order, height=300)
                if out:
                    fig, ct = out
                    st.plotly_chart(fig, width="stretch")
                    table_view(ct)

# ── 3. Oral findings ─────────────────────────────────────────────────────────
with tabs[2]:
    flags = [c for c in ["Dental Caries_Flag", "Gingivitis_Flag", "Debris_Flag",
                         "Calculus_Flag", "OFC_Flag"] if c in f.columns]
    if f.empty or not flags:
        empty_note("No oral finding columns in view.")
    else:
        st.caption(
            "A blank cell on the paper form is read as “not observed”, which is how the "
            "clinic fills it in. That means a blank the encoder never reached and a genuine "
            "negative look identical here — the counts below are a floor, not a census."
        )
        names = [c.replace("_Flag", "") for c in flags]
        vals = [int(f[c].sum()) for c in flags]
        c1, c2 = st.columns([1, 1.2])
        with c1:
            st.plotly_chart(
                count_bar(names, vals, title="Findings recorded (learners in view)",
                          horizontal=True, height=340),
                width="stretch")
            table_view(pd.DataFrame({"Finding": names, "Learners": vals,
                                     "Percent of view": [round(v / len(f) * 100, 1)
                                                         for v in vals]})
                       .set_index("Finding"))
        with c2:
            pickable = [n for n in names if n != "OFC"]
            chosen = st.selectbox("Finding", pickable, index=0)
            col = chosen + "_Flag"
            tmp = f.copy()
            tmp["_obs"] = np.where(tmp[col] == 1, "Observed", "Not observed")
            out = risk_share_bar(tmp, "_obs", title=f"Risk mix — {chosen}",
                                 order=["Not observed", "Observed"], height=340)
            if out:
                fig, ct = out
                st.plotly_chart(fig, width="stretch")
                table_view(ct)

        if "OFC_Flag" in f.columns:
            st.markdown("#### Orally Fit Child")
            st.caption(
                "OFC is the DOH marker for a learner whose mouth needs nothing done to it: "
                "no untreated decay, no debris, no gum inflammation, no tooth for removal. "
                "It should agree with the caries count from the same examination."
            )
            ct = pd.crosstab(f["OFC_Flag"].map({0: "Not ticked", 1: "OFC"}), f[TARGET])
            ct = ct.reindex(columns=[r for r in RISK_ORDER if r in ct.columns])
            k1, k2 = st.columns([1.2, 1])
            with k1:
                out = risk_share_bar(
                    f.assign(_ofc=f["OFC_Flag"].map({0: "Not ticked", 1: "OFC"})),
                    "_ofc", title="Risk mix by OFC tick",
                    order=["Not ticked", "OFC"], height=280)
                if out:
                    st.plotly_chart(out[0], width="stretch")
            with k2:
                st.dataframe(ct, width="stretch")
                if "Total_DMFX_dmfx" in f.columns:
                    st.dataframe(
                        f.groupby(f["OFC_Flag"].map({0: "Not ticked", 1: "OFC"}))
                        ["Total_DMFX_dmfx"].describe().round(2),
                        width="stretch")

# ── 4. Caries burden ─────────────────────────────────────────────────────────
with tabs[3]:
    if f.empty or "Total_DMFX_dmfx" not in f.columns:
        empty_note("No caries count column in view.")
    else:
        total = f["Total_DMFX_dmfx"].dropna()
        c = st.columns(4)
        stat(c[0], "Median affected teeth", f"{total.median():.0f}",
             f"mean {total.mean():.2f} across {len(total):,} records")
        stat(c[1], "Caries-free learners", f"{int((total == 0).sum()):,}",
             f"{(total == 0).mean() * 100:.1f}% of the view")
        stat(c[2], "Highest count recorded", f"{total.max():.0f}",
             "combined permanent and temporary")
        if {"Perm_DMFX", "Temp_dfx"} <= set(f.columns):
            perm = f["Perm_DMFX"].fillna(0).sum()
            temp = f["Temp_dfx"].fillna(0).sum()
            stat(c[3], "Temporary share of burden",
                 f"{temp / (perm + temp) * 100:.0f}%" if perm + temp else "—",
                 f"{int(temp):,} temporary vs {int(perm):,} permanent affected teeth")

        st.markdown("")
        c1, c2 = st.columns(2)
        with c1:
            fig = go.Figure(go.Histogram(
                x=total, xbins=dict(size=1), marker_color=P["cat"][0],
                marker_line=dict(color=P["surface"], width=1),
                hovertemplate="%{x} affected teeth<br>%{y:,} learners<extra></extra>"))
            fig.update_layout(title="Combined DMFX + dmfx count")
            st.plotly_chart(style(fig, P, height=340, showlegend=False,
                                  ylab="Learners", xlab="Affected teeth"),
                            width="stretch")
        with c2:
            if "Grade" in f.columns:
                order = idata.grade_order(f["Grade"].dropna().unique())
                g = (f.groupby("Grade")["Total_DMFX_dmfx"].agg(["mean", "count"])
                     .reindex(order).dropna())
                if g.empty:
                    empty_note("No grade values in view.")
                else:
                    fig = go.Figure(go.Bar(
                        x=g.index, y=g["mean"], marker_color=P["cat"][0],
                        marker_line=dict(color=P["surface"], width=1.5),
                        customdata=g["count"],
                        text=[f"{v:.1f}" for v in g["mean"]], textposition="outside",
                        cliponaxis=False, textfont=dict(color=P["ink_secondary"], size=11),
                        hovertemplate="Grade %{x}<br>mean %{y:.2f} affected teeth"
                                      "<br>%{customdata:,} learners<extra></extra>"))
                    fig.update_layout(title="Mean affected teeth by grade")
                    fig = style(fig, P, height=340, showlegend=False,
                                ylab="Mean affected teeth")
                    fig.update_xaxes(type="category", dtick=1)
                    st.plotly_chart(fig, width="stretch")
                    table_view(g.round(2))

        if {"Perm_DMFX", "Temp_dfx", "Grade"} <= set(f.columns):
            order = idata.grade_order(f["Grade"].dropna().unique())
            comp = (f.groupby("Grade")[["Perm_DMFX", "Temp_dfx"]].mean()
                    .reindex(order).dropna(how="all"))
            if not comp.empty:
                fig = go.Figure()
                for i, (col, label) in enumerate([("Temp_dfx", "Temporary (dfx)"),
                                                  ("Perm_DMFX", "Permanent (DMFX)")]):
                    fig.add_bar(x=comp.index, y=comp[col], name=label,
                                marker_color=P["cat"][i],
                                marker_line=dict(color=P["surface"], width=2),
                                hovertemplate=f"{label}<br>grade %{{x}}"
                                              "<br>mean %{y:.2f} teeth<extra></extra>")
                fig.update_layout(barmode="stack",
                                  title="Where the burden sits — dentition by grade")
                fig = style(fig, P, height=340, ylab="Mean affected teeth")
                fig.update_xaxes(type="category", dtick=1)
                st.plotly_chart(fig, width="stretch")
                table_view(comp.round(2))

# ── 5. Data quality ──────────────────────────────────────────────────────────
with tabs[4]:
    st.caption(
        "Everything on this tab is measured on the labelled subset as loaded — the "
        "corrections listed are the ones the loader applied, not suggestions. The "
        "cleaning itself is reversible: it lives in `iptr_data.clean`."
    )

    c = st.columns(4)
    stat(c[0], "Unlabelled records", f"{audit['unlabelled']:,}",
         "no risk value — excluded from the whole dashboard")
    stat(c[1], "Empty columns dropped", f"{audit['empty_cols_dropped']:,}",
         "blank for every labelled record")
    stat(c[2], "Exact duplicate rows", f"{audit['exact_duplicates']:,}",
         "removed — same record encoded twice")
    stat(c[3], "Repeated full names", f"{audit.get('repeated_names', 0):,}",
         "kept: a learner examined twice is two valid rows")

    st.markdown("#### Corrections applied")
    rows = []
    if "age_out_of_range" in audit:
        lo, hi = audit["age_range_before"]
        vals = ", ".join(str(int(v)) for v in audit["age_out_of_range_values"][:8])
        rows.append((
            "critical" if audit["age_out_of_range"] else "good",
            "Impossible age",
            f"{audit['age_out_of_range']} record(s) outside {idata.AGE_MIN}–{idata.AGE_MAX} "
            f"years set to missing. Raw range was {lo:.0f}–{hi:.0f}"
            + (f" (values: {vals})" if vals else "") + ".",
        ))
    if "bmi_recomputed" in audit:
        rows.append((
            "warning" if audit["bmi_recomputed"] else "good",
            "BMI blank or zero",
            f"{audit['bmi_recomputed']} value(s) recomputed from weight ÷ height², "
            f"{audit['bmi_out_of_range']} left outside {idata.BMI_MIN}–{idata.BMI_MAX} "
            "and set to missing.",
        ))
    if audit.get("sex_repaired"):
        rows.append((
            "serious", "Sex encoded inconsistently",
            f"{audit['sex_repaired']} record(s) carried a variant spelling "
            f"({', '.join(audit['sex_raw_values'])}) and were folded into M / F.",
        ))
    for col, lost in audit["non_numeric_coerced"].items():
        rows.append(("serious", f"Text in a numeric column — {col}",
                     f"{lost} value(s) could not be read as a number and became missing."))
    for col, variants in audit["flag_variants"].items():
        if len(variants) > 1:
            rows.append(("warning", f"Mixed spellings — {col}",
                         f"raw values {variants} all read as “present”."))
    if len(audit["label_raw_values"]) > 3:
        rows.append(("warning", "Label spelling variants",
                     f"raw label values {audit['label_raw_values']} normalised by casing."))

    if not rows:
        st.success("No encoding corrections were needed on this sheet.")
    for level, title, body in rows:
        icon = {"good": "✅", "warning": "⚠️", "serious": "❗", "critical": "⛔"}[level]
        st.markdown(
            f"<div class='flag-row'><span style='color:{STATUS[level]};"
            f"font-weight:700'>{icon}</span><span><b>{title}</b> — {body}</span></div>",
            unsafe_allow_html=True)

    st.markdown("#### Missing values")
    miss = data.isnull().sum()
    miss = miss[miss > 0].sort_values(ascending=False)
    if miss.empty:
        st.success("No missing values in the retained columns.")
    else:
        pct = (miss / len(data) * 100).round(1)
        top = miss.head(20)[::-1]
        fig = go.Figure(go.Bar(
            y=top.index, x=(top / len(data) * 100), orientation="h",
            marker_color=P["cat"][0], marker_line=dict(color=P["surface"], width=1.5),
            customdata=top.values,
            text=[f"{v:.0f}%" for v in (top / len(data) * 100)], textposition="outside",
            cliponaxis=False, textfont=dict(color=P["ink_secondary"], size=11),
            hovertemplate="%{y}<br>%{x:.1f}% missing"
                          "<br>%{customdata:,} records<extra></extra>"))
        fig.update_layout(title="Most incomplete columns (labelled subset)")
        fig = style(fig, P, height=520, showlegend=False, xlab="Percent missing")
        fig.update_xaxes(ticksuffix="%", range=[0, 105])
        st.plotly_chart(fig, width="stretch")
        table_view(pd.DataFrame({"Missing": miss, "Percent": pct}), "Show every column")

    st.markdown("#### OFC contradictions")
    threshold = st.slider("Flag a learner ticked OFC while carrying at least", 1, 10, 2,
                          format="%d affected teeth")
    contra = idata.ofc_contradictions(f, threshold)
    if contra.empty:
        st.success("No OFC record in view contradicts its own caries count at this threshold.")
    else:
        st.markdown(
            f"<span style='color:{STATUS['critical']};font-weight:700'>⛔</span> "
            f"<b>{len(contra)} record(s)</b> are ticked Orally Fit Child while the same "
            "examination recorded affected teeth. These are encoding errors, not clinical "
            "edge cases. They stay in the dataset — removing the inconvenient rows would "
            "flatter the results — and are listed here so the clinic can correct them at "
            "source.", unsafe_allow_html=True)
        st.dataframe(contra, width="stretch")
        st.download_button(
            "Download the correction list (CSV)",
            contra.to_csv(index=False).encode("utf-8"),
            file_name="ofc_contradictions.csv", mime="text/csv",
            help="Contains learner names — handle it as patient data.")

    with st.expander("Sheet inventory — why this sheet was chosen"):
        st.dataframe(sizes_cached(raw_bytes), width="stretch")

# ── 6. Label check ───────────────────────────────────────────────────────────
with tabs[5]:
    st.markdown("#### Was the risk label an independent judgement?")
    rule = idata.derived_rule(f)
    if rule is None:
        empty_note("Not enough labelled records with a caries count in view to test this.")
    else:
        c = st.columns(3)
        stat(c[0], "Records tested", f"{rule['n']:,}", "labelled, with a caries count")
        stat(c[1], "Fit the recovered cut-off", f"{rule['conformance']:.1f}%",
             f"{rule['breaking_rows']:,} record(s) break the pattern")
        stat(c[2], "Recovered thresholds",
             f"≤{rule['low_max']} · ≤{rule['med_max']} · >{rule['med_max']}",
             "Low · Medium · High, read off this data")

        st.markdown("")
        d = f[["Total_DMFX_dmfx", TARGET]].dropna()
        ct = pd.crosstab(d["Total_DMFX_dmfx"], d[TARGET])
        ct = ct.reindex(columns=[r for r in RISK_ORDER if r in ct.columns])
        cap = int(min(ct.index.max(), 20))
        heat = ct.loc[ct.index <= cap]

        c1, c2 = st.columns([1.4, 1])
        with c1:
            z = heat.astype(float).where(heat > 0)  # 0 learners renders blank, not pale
            fig = go.Figure(go.Heatmap(
                z=z.values, x=z.columns, y=z.index,
                colorscale=[[i / (len(P["seq"]) - 1), c] for i, c in enumerate(P["seq"])],
                hovertemplate="%{x} risk<br>%{y} affected teeth"
                              "<br>%{z:,} learners<extra></extra>",
                colorbar=dict(title=dict(text="Learners", font=dict(color=P["muted"],
                                                                   size=11)),
                              tickfont=dict(color=P["muted"], size=10),
                              outlinewidth=0, thickness=12)))
            fig.update_layout(title=f"Caries count against assigned risk (0–{cap} teeth)")
            fig = style(fig, P, height=520, showlegend=False, ylab="Affected teeth")
            fig.update_yaxes(gridcolor="rgba(0,0,0,0)", dtick=1)
            fig.update_xaxes(type="category")
            st.plotly_chart(fig, width="stretch")
        with c2:
            st.dataframe(rule["stats"].reindex([r for r in RISK_ORDER
                                                if r in rule["stats"].index]),
                         width="stretch")
            st.markdown(
                f"Each risk class occupies its own band of the caries count with "
                f"{rule['conformance']:.1f}% agreement, which is the signature of a label "
                "that was **computed** from the count rather than judged independently:\n\n"
                f"| Combined DMFX + dmfx | Assigned risk |\n|---|---|\n"
                f"| 0 to {rule['low_max']} | Low |\n"
                f"| {rule['low_max'] + 1} to {rule['med_max']} | Medium |\n"
                f"| {rule['med_max'] + 1} and above | High |\n"
            )

        st.markdown(
            "**What this means for modelling.** Feeding the caries total back to a "
            "classifier teaches it nothing — it only rediscovers the cut-off, and a "
            "near-perfect score is the warning sign, not the achievement. Hence the two "
            "models: a **screening model** built from demographics and the visual findings "
            "alone, for the learner whose teeth have not been charted yet, and a **full "
            "record model** that uses the count as an automated, consistent scorer once "
            "charting is done."
        )
        table_view(ct, "Show the full cross-tabulation")

st.markdown(
    f"<p style='color:{P['muted']};font-size:0.78rem;margin-top:2rem'>"
    "Every figure on this page is computed from the loaded workbook. Blank means no data, "
    "never a placeholder.</p>", unsafe_allow_html=True)
