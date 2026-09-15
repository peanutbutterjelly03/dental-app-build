"""Render the IPTR dashboard as one self-contained HTML file.

    python build_report.py IPTR_Dataset.xlsx
    python build_report.py IPTR_Dataset.xlsx -o report.html --cdn

The output opens by double-clicking — no server, no Python needed to read it.
The charts keep their hover tooltips, legend toggles and zoom; what they cannot
keep is the sidebar filtering, which needs a running process. This file is
therefore the whole labelled dataset, and `iptr_dashboard.py` is where a slice
of it gets explored.

Every section is computed from the workbook passed in. Where there is no data
the section says so rather than drawing an empty axis.
"""

from __future__ import annotations

import argparse
import html
import sys
from datetime import date
from pathlib import Path

import pandas as pd

import iptr_charts as ch
import iptr_data as idata
from iptr_data import TARGET
from iptr_theme import FONT, RISK_ORDER, STATUS, palette

P = palette("light")   # the report commits to one look; charts are baked in

ICON = {"good": "✅", "warning": "⚠️", "serious": "❗", "critical": "⛔"}

# Plotly sizes a chart when it is created; the charts here sit in flex cells whose
# width settles after layout, so re-fit each one once the page is laid out and
# again whenever its cell changes size.
RESIZE_JS = """<script>
(function () {
  var plots = Array.prototype.slice.call(
      document.querySelectorAll('.plotly-graph-div'));
  var fit = function (el) {
    if (window.Plotly) { try { Plotly.Plots.resize(el); } catch (e) {} }
  };
  var run = function () { plots.forEach(fit); };
  window.addEventListener('load', run);
  if (window.ResizeObserver) {
    plots.forEach(function (el) {
      new ResizeObserver(function () { fit(el); }).observe(el.parentNode);
    });
  }
  run();
})();
</script>"""

SECTIONS = [
    ("overview", "Overview"),
    ("demographics", "Demographics"),
    ("findings", "Oral findings"),
    ("burden", "Caries burden"),
    ("quality", "Data quality"),
    ("label", "Label check"),
]


# ── html pieces ──────────────────────────────────────────────────────────────
def esc(text) -> str:
    return html.escape(str(text))


def fig_html(fig, *, first: bool) -> str:
    """First figure carries plotly.js; the rest reuse it."""
    if fig is None:
        return note("No data for this chart in the workbook.")
    return fig.to_html(full_html=False,
                       include_plotlyjs=("inline" if first else False),
                       default_width="100%",   # fill the flex cell, never overflow it
                       config={"displayModeBar": False, "responsive": True})


def table(df: pd.DataFrame, *, index=True, title: str | None = None) -> str:
    if df is None or df.empty:
        return ""
    body = df.to_html(index=index, border=0, classes="tbl", justify="left")
    head = f"<h4>{esc(title)}</h4>" if title else ""
    return f"<div class='tbl-wrap'>{head}{body}</div>"


def note(text: str) -> str:
    return f"<p class='note'>{esc(text)}</p>"


def cards(items) -> str:
    out = "".join(
        f"<div class='card'><div class='card-label'>{esc(l)}</div>"
        f"<div class='card-value'>{esc(v)}</div>"
        f"<div class='card-note'>{esc(n)}</div></div>"
        for l, v, n in items)
    return f"<div class='cards'>{out}</div>"


def flag_rows(rows) -> str:
    if not rows:
        return "<p class='ok'>No encoding corrections were needed on this sheet.</p>"
    return "".join(
        f"<div class='flag'><span class='flag-icon' style='color:{STATUS[level]}'>"
        f"{ICON[level]}</span><span><b>{esc(title)}</b> — {esc(body)}</span></div>"
        for level, title, body in rows)


def section(anchor: str, heading: str, *blocks: str) -> str:
    inner = "".join(b for b in blocks if b)
    return (f"<section id='{anchor}'><h2>{esc(heading)}</h2>{inner}</section>")


def row(*blocks: str, weights=None) -> str:
    """Side-by-side blocks that stack on a narrow screen."""
    blocks = [b for b in blocks if b]
    if not blocks:
        return ""
    w = weights or [1] * len(blocks)
    cells = "".join(f"<div style='flex:{wi} 1 320px;min-width:0'>{b}</div>"
                    for wi, b in zip(w, blocks))
    return f"<div class='row'>{cells}</div>"


# ── the report ───────────────────────────────────────────────────────────────
def build(data: pd.DataFrame, audit: dict, *, source: str, sheet: str) -> str:
    n = len(data)
    first = [True]   # plotly.js rides along with whichever figure renders first

    def F(fig) -> str:
        out = fig_html(fig, first=first[0])
        if fig is not None:
            first[0] = False
        return out

    # ---- overview
    counts = data[TARGET].value_counts().reindex(RISK_ORDER).fillna(0).astype(int)
    biggest = counts.idxmax()
    smallest = counts[counts > 0].idxmin() if (counts > 0).any() else biggest
    ratio = counts[biggest] / counts[smallest] if counts[smallest] else float("nan")
    pct_labelled = audit["labelled"] / audit["raw_rows"] * 100 if audit["raw_rows"] else 0

    risk_fig, risk_tbl = ch.risk_counts(P, data, title="Caries risk class — counts")
    grade_out = ch.risk_share_bar(P, data, "Grade", title="Risk mix by grade level",
                                  order=idata.grade_order(data["Grade"].dropna().unique()),
                                  height=360) if "Grade" in data.columns else None

    overview = section(
        "overview", "Overview",
        cards([
            ("Records on sheet", f"{audit['raw_rows']:,}",
             f"{audit['raw_cols']} columns as encoded"),
            ("Carry a risk label", f"{audit['labelled']:,}",
             f"{pct_labelled:.1f}% — the rest cannot be used for supervised learning"),
            ("Columns with data", f"{audit['cols_retained']:,}",
             f"{audit['empty_cols_dropped']} were blank for every labelled record"),
            ("Records in this report", f"{n:,}", "the whole labelled subset"),
        ]),
        row(F(risk_fig), F(grade_out[0] if grade_out else None), weights=[1, 1.35]),
        f"<p><b>Class balance.</b> {esc(biggest)} is the largest class at "
        f"{counts[biggest]:,} records and {esc(smallest)} the smallest at "
        f"{counts[smallest]:,} — a ratio of {ratio:.1f} to 1. Accuracy would flatter a "
        f"model that simply predicted {esc(biggest)} every time, so macro-averaged F1 "
        "is the metric to compare on.</p>",
        row(table(risk_tbl), table(grade_out[1]) if grade_out else "", weights=[1, 1.35]),
    )

    # ---- demographics
    bmi_out = ch.box_by_risk(P, data, "BMI", title="BMI by risk class", height=360) \
        if "BMI" in data.columns else None
    sex_out = ch.risk_share_bar(P, data, "Sex", title="Risk mix by sex", height=300) \
        if "Sex" in data.columns else None
    ns_out = ch.risk_share_bar(
        P, data, "Nutritional Status", title="Risk mix by nutritional status",
        order=["Severely Wasted", "Wasted", "Normal", "Overweight", "Obese"],
        height=300) if "Nutritional Status" in data.columns else None

    demographics = section(
        "demographics", "Demographics",
        row(F(ch.age_hist(P, data)), F(bmi_out[0] if bmi_out else None)),
        table(bmi_out[1], title="BMI by risk class") if bmi_out else "",
        row(F(sex_out[0] if sex_out else None), F(ns_out[0] if ns_out else None)),
        row(table(sex_out[1]) if sex_out else "", table(ns_out[1]) if ns_out else ""),
    )

    # ---- oral findings
    flags = [c for c in ["Dental Caries_Flag", "Gingivitis_Flag", "Debris_Flag",
                         "Calculus_Flag", "OFC_Flag"] if c in data.columns]
    findings_blocks = []
    if flags:
        names = [c.replace("_Flag", "") for c in flags]
        vals = [int(data[c].sum()) for c in flags]
        findings_blocks.append(F(ch.count_bar(
            P, names, vals, title="Findings recorded", horizontal=True, height=340)))
        findings_blocks.append(table(pd.DataFrame({
            "Finding": names, "Learners": vals,
            "Percent of records": [round(v / n * 100, 1) for v in vals],
        }).set_index("Finding")))

        pairs = []
        for name in [x for x in names if x != "OFC"]:
            tmp = data.assign(_obs=lambda d, c=name + "_Flag":
                              d[c].map({1: "Observed", 0: "Not observed"}))
            out = ch.risk_share_bar(P, tmp, "_obs", title=f"Risk mix — {name}",
                                    order=["Not observed", "Observed"], height=300)
            pairs.append(F(out[0] if out else None))
        for i in range(0, len(pairs), 2):
            findings_blocks.append(row(*pairs[i:i + 2]))

    if "OFC_Flag" in data.columns:
        ofc = data.assign(_ofc=data["OFC_Flag"].map({0: "Not ticked", 1: "OFC"}))
        out = ch.risk_share_bar(P, ofc, "_ofc", title="Risk mix by OFC tick",
                                order=["Not ticked", "OFC"], height=280)
        burden_by_ofc = (data.groupby(data["OFC_Flag"].map({0: "Not ticked", 1: "OFC"}))
                         ["Total_DMFX_dmfx"].describe().round(2)
                         if "Total_DMFX_dmfx" in data.columns else None)
        findings_blocks += [
            "<h3>Orally Fit Child</h3>",
            "<p>OFC is the DOH marker for a learner whose mouth needs nothing done to "
            "it: no untreated decay, no debris, no gum inflammation, no tooth for "
            "removal. It should agree with the caries count from the same "
            "examination.</p>",
            row(F(out[0] if out else None),
                table(burden_by_ofc, title="Caries count by OFC status"),
                weights=[1.2, 1]),
        ]

    findings = section(
        "findings", "Oral findings",
        "<p class='caption'>A blank cell on the paper form is read as “not observed”, "
        "which is how the clinic fills it in. That means a blank the encoder never "
        "reached and a genuine negative look identical here — the counts below are a "
        "floor, not a census.</p>",
        *(findings_blocks or [note("No oral finding columns on this sheet.")]),
    )

    # ---- caries burden
    burden_blocks = []
    if "Total_DMFX_dmfx" in data.columns:
        total = data["Total_DMFX_dmfx"].dropna()
        items = [
            ("Median affected teeth", f"{total.median():.0f}",
             f"mean {total.mean():.2f} across {len(total):,} records"),
            ("Caries-free learners", f"{int((total == 0).sum()):,}",
             f"{(total == 0).mean() * 100:.1f}% of the labelled subset"),
            ("Highest count recorded", f"{total.max():.0f}",
             "combined permanent and temporary"),
        ]
        if {"Perm_DMFX", "Temp_dfx"} <= set(data.columns):
            perm = data["Perm_DMFX"].fillna(0).sum()
            temp = data["Temp_dfx"].fillna(0).sum()
            items.append(("Temporary share of burden",
                          f"{temp / (perm + temp) * 100:.0f}%" if perm + temp else "—",
                          f"{int(temp):,} temporary vs {int(perm):,} permanent "
                          "affected teeth"))
        mean_out = ch.mean_burden_by_grade(P, data)
        dent_out = ch.dentition_by_grade(P, data)
        burden_blocks = [
            cards(items),
            row(F(ch.dmfx_hist(P, data)), F(mean_out[0] if mean_out else None)),
            table(mean_out[1], title="Mean affected teeth by grade") if mean_out else "",
            F(dent_out[0]) if dent_out else "",
            table(dent_out[1], title="Mean affected teeth by dentition") if dent_out else "",
        ]
    burden = section("burden", "Caries burden",
                     *(burden_blocks or [note("No caries count column on this sheet.")]))

    # ---- data quality
    miss_out = ch.missing_bar(P, data)
    contra = idata.ofc_contradictions(data)
    contra_block = (
        f"<p><span style='color:{STATUS['critical']}'>⛔</span> <b>{len(contra)} "
        "record(s)</b> are ticked Orally Fit Child while the same examination recorded "
        "two or more affected teeth. These are encoding errors, not clinical edge "
        "cases. They stay in the dataset — removing the inconvenient rows would flatter "
        "the results — and are listed here so the clinic can correct them at source.</p>"
        + table(contra, index=False)
        if not contra.empty else
        "<p class='ok'>No OFC record contradicts its own caries count.</p>")

    quality = section(
        "quality", "Data quality",
        cards([
            ("Unlabelled records", f"{audit['unlabelled']:,}",
             "no risk value — excluded from this report"),
            ("Empty columns dropped", f"{audit['empty_cols_dropped']:,}",
             "blank for every labelled record"),
            ("Exact duplicate rows", f"{audit['exact_duplicates']:,}",
             "removed — same record encoded twice"),
            ("Repeated full names", f"{audit.get('repeated_names', 0):,}",
             "kept: a learner examined twice is two valid rows"),
        ]),
        "<h3>Corrections applied</h3>", flag_rows(idata.correction_rows(audit)),
        "<h3>Missing values</h3>",
        F(miss_out[0]) if miss_out else "<p class='ok'>No missing values in the "
                                        "retained columns.</p>",
        table(miss_out[1], title="Every incomplete column") if miss_out else "",
        "<h3>OFC contradictions</h3>", contra_block,
    )

    # ---- label check
    rule = idata.derived_rule(data)
    if rule is None:
        label = section("label", "Label check",
                        note("Not enough labelled records with a caries count to test "
                             "how the label was assigned."))
    else:
        heat_out = ch.leak_heatmap(P, data)
        rule_tbl = (
            "<table class='tbl'><thead><tr><th>Combined DMFX + dmfx</th>"
            "<th>Assigned risk</th></tr></thead><tbody>"
            f"<tr><td>0 to {rule['low_max']}</td><td>Low</td></tr>"
            f"<tr><td>{rule['low_max'] + 1} to {rule['med_max']}</td><td>Medium</td></tr>"
            f"<tr><td>{rule['med_max'] + 1} and above</td><td>High</td></tr>"
            "</tbody></table>")
        label = section(
            "label", "Label check",
            "<h3>Was the risk label an independent judgement?</h3>",
            cards([
                ("Records tested", f"{rule['n']:,}", "labelled, with a caries count"),
                ("Fit the recovered cut-off", f"{rule['conformance']:.1f}%",
                 f"{rule['breaking_rows']:,} record(s) break the pattern"),
                ("Recovered thresholds",
                 f"≤{rule['low_max']} · ≤{rule['med_max']} · >{rule['med_max']}",
                 "Low · Medium · High, read off this data"),
            ]),
            row(F(heat_out[0] if heat_out else None),
                table(rule["stats"].reindex([r for r in RISK_ORDER
                                             if r in rule["stats"].index]))
                + f"<p>Each risk class occupies its own band of the caries count with "
                  f"{rule['conformance']:.1f}% agreement, which is the signature of a "
                  "label that was <b>computed</b> from the count rather than judged "
                  "independently:</p>" + rule_tbl,
                weights=[1.4, 1]),
            "<p><b>What this means for modelling.</b> Feeding the caries total back to "
            "a classifier teaches it nothing — it only rediscovers the cut-off, and a "
            "near-perfect score is the warning sign, not the achievement. Hence the two "
            "models: a <b>screening model</b> built from demographics and the visual "
            "findings alone, for the learner whose teeth have not been charted yet, and "
            "a <b>full record model</b> that uses the count as an automated, consistent "
            "scorer once charting is done.</p>",
            table(heat_out[1], title="Full cross-tabulation") if heat_out else "",
        )

    nav = "".join(f"<a href='#{a}'>{esc(t)}</a>" for a, t in SECTIONS)

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IPTR Dental EDA — {esc(source)}</title>
<style>
  :root {{ color-scheme: light; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: {P['plane']}; color: {P['ink']};
          font-family: {FONT}; font-size: 14px; line-height: 1.55; }}
  .page {{ max-width: 1180px; margin: 0 auto; padding: 32px 16px 64px; }}
  h1 {{ font-size: 1.9rem; margin: 0 0 4px; letter-spacing: -0.01em; }}
  h2 {{ font-size: 1.25rem; margin: 0 0 16px; padding-bottom: 8px;
        border-bottom: 1px solid {P['grid']}; }}
  h3 {{ font-size: 1rem; margin: 28px 0 10px; }}
  h4 {{ font-size: .8rem; margin: 0 0 6px; color: {P['ink_secondary']};
        font-weight: 600; }}
  p {{ margin: 12px 0; color: {P['ink_secondary']}; }}
  .sub {{ color: {P['muted']}; margin: 0 0 20px; }}
  nav {{ display: flex; flex-wrap: wrap; gap: 4px 18px; padding: 12px 0 20px;
         border-bottom: 1px solid {P['grid']}; margin-bottom: 28px; }}
  nav a {{ color: {P['ink_secondary']}; text-decoration: none; font-weight: 550; }}
  nav a:hover {{ color: {P['cat'][0]}; }}
  section {{ margin: 0 0 48px; }}
  .row {{ display: flex; flex-wrap: wrap; gap: 16px; }}
  .cards {{ display: flex; flex-wrap: wrap; gap: 12px; margin: 4px 0 20px; }}
  .card {{ flex: 1 1 210px; border: 1px solid {P['grid']}; border-radius: 10px;
           padding: 14px 16px; background: {P['surface']}; }}
  .card-label {{ font-size: .7rem; letter-spacing: .04em; text-transform: uppercase;
                 color: {P['muted']}; }}
  .card-value {{ font-size: 1.7rem; font-weight: 650; line-height: 1.25; }}
  .card-note {{ font-size: .78rem; color: {P['ink_secondary']}; }}
  .flag {{ display: flex; gap: 8px; align-items: baseline; padding: 7px 0;
           border-bottom: 1px solid {P['grid']}; color: {P['ink_secondary']}; }}
  .flag-icon {{ font-weight: 700; }}
  .ok {{ color: {STATUS['good']}; }}
  .note {{ color: {P['muted']}; font-style: italic; }}
  .caption {{ color: {P['muted']}; font-size: .86rem; }}
  .tbl-wrap {{ margin: 8px 0 20px; overflow-x: auto; }}
  table.tbl {{ border-collapse: collapse; width: 100%; font-size: .82rem;
               background: {P['surface']}; }}
  table.tbl th {{ text-align: left; font-weight: 600; color: {P['ink_secondary']};
                  border-bottom: 1px solid {P['axis']}; padding: 6px 10px;
                  white-space: nowrap; }}
  table.tbl td {{ border-bottom: 1px solid {P['grid']}; padding: 6px 10px;
                  font-variant-numeric: tabular-nums; white-space: nowrap; }}
  footer {{ color: {P['muted']}; font-size: .78rem; border-top: 1px solid {P['grid']};
            padding-top: 14px; }}
  @media print {{ body {{ background: #fff; }} nav {{ display: none; }}
                  section {{ break-inside: avoid; }} }}
</style></head>
<body><div class="page">
<h1>IPTR Dental EDA</h1>
<p class="sub">{esc(source)} · sheet “{esc(sheet)}” · {n:,} labelled records ·
generated {date.today().isoformat()}</p>
<nav>{nav}</nav>
{overview}{demographics}{findings}{burden}{quality}{label}
{RESIZE_JS}
<footer>Every figure here is computed from the workbook named above; blank means no
data, never a placeholder. This is the static export — filtering by grade, sex,
nutritional status or age lives in the Streamlit app (<code>streamlit run
iptr_dashboard.py</code>). Learner names appear in the contradiction list: handle
this file as patient data.</footer>
</div></body></html>"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("workbook", type=Path, help="path to IPTR_Dataset.xlsx")
    ap.add_argument("-o", "--out", type=Path, default=Path("iptr_report.html"))
    ap.add_argument("--sheet", default=None,
                    help=f"sheet to read (default: {idata.DEFAULT_SHEET})")
    ap.add_argument("--header", type=int, default=None,
                    help="1-based row holding the column names (default: 2 for the "
                         "encoded sheets, 1 otherwise)")
    args = ap.parse_args()

    if not args.workbook.is_file():
        print(f"No such workbook: {args.workbook}", file=sys.stderr)
        return 1

    names = idata.sheet_names(args.workbook)
    sheet = args.sheet or (idata.DEFAULT_SHEET if idata.DEFAULT_SHEET in names
                           else names[0])
    if sheet not in names:
        print(f"Sheet “{sheet}” is not in the workbook. Sheets: {', '.join(names)}",
              file=sys.stderr)
        return 1
    header = (args.header - 1) if args.header else (1 if "Manual Encoded" in sheet else 0)

    raw = idata.load_sheet(args.workbook, sheet, header)
    try:
        data, audit = idata.clean(raw)
    except KeyError as exc:
        print(str(exc).strip('"'), file=sys.stderr)
        return 1
    if data.empty:
        print("No labelled records on that sheet — nothing to report.", file=sys.stderr)
        return 1

    args.out.write_text(build(data, audit, source=args.workbook.name, sheet=sheet),
                        encoding="utf-8")
    size = args.out.stat().st_size / 1_000_000
    print(f"Wrote {args.out} ({size:.1f} MB) — {len(data):,} labelled records "
          f"from “{sheet}”. Open it in any browser.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
