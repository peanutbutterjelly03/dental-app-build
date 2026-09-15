"""Figure builders shared by the Streamlit app and the static HTML report.

Every function takes the palette `p` and returns a Plotly figure — and, where the
chart summarises a table, the table with it so the caller can show the numbers.
Keeping them here is what stops the app and the exported report from drifting
into two different readings of the same data.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go

from iptr_data import TARGET, grade_order
from iptr_theme import RISK_ORDER, style


def risk_colors(p: dict) -> list[str]:
    return [p["risk"][r] for r in RISK_ORDER]


def count_bar(p, labels, values, *, title, color=None, horizontal=False,
              ylab="Learners", xlab="", height=340):
    """Single series: no legend, direct value labels, thin marks."""
    color = color or p["cat"][0]
    txt = [f"{v:,}" for v in values]
    if horizontal:
        fig = go.Figure(go.Bar(
            y=labels, x=values, orientation="h", marker_color=color,
            marker_line=dict(color=p["surface"], width=1.5),
            text=txt, textposition="outside", cliponaxis=False,
            textfont=dict(color=p["ink_secondary"], size=11),
            hovertemplate="%{y}<br>%{x:,} learners<extra></extra>",
        ))
        fig.update_layout(title=title)
        return style(fig, p, height=height, showlegend=False, xlab=ylab)
    fig = go.Figure(go.Bar(
        x=labels, y=values, marker_color=color,
        marker_line=dict(color=p["surface"], width=1.5),
        text=txt, textposition="outside", cliponaxis=False,
        textfont=dict(color=p["ink_secondary"], size=11),
        hovertemplate="%{x}<br>%{y:,} learners<extra></extra>",
    ))
    fig.update_layout(title=title)
    return style(fig, p, height=height, showlegend=False, ylab=ylab, xlab=xlab)


def risk_counts(p, df, *, title="Caries risk class — counts", height=360):
    counts = df[TARGET].value_counts().reindex(RISK_ORDER).fillna(0).astype(int)
    if counts.sum() == 0:
        return None
    share = counts / counts.sum() * 100
    fig = go.Figure(go.Bar(
        x=counts.index, y=counts.values, marker_color=risk_colors(p),
        marker_line=dict(color=p["surface"], width=2),
        text=[f"{v:,}<br>{s:.1f}%" for v, s in zip(counts.values, share.values)],
        textposition="outside", cliponaxis=False,
        textfont=dict(color=p["ink_secondary"], size=11),
        hovertemplate="%{x} risk<br>%{y:,} learners<extra></extra>"))
    fig.update_layout(title=title)
    table = pd.DataFrame({"Learners": counts, "Share %": share.round(1)})
    return style(fig, p, height=height, showlegend=False, ylab="Learners"), table


def risk_share_bar(p, df, dim, *, title, order=None, horizontal=True, height=380):
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
            name=r, marker_color=p["risk"][r],
            marker_line=dict(color=p["surface"], width=2),
            text=labels, textposition="inside", insidetextanchor="middle",
            textfont=dict(color=p["surface"] if r == "High" else p["ink"], size=11),
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
    fig = style(fig, p, height=height)
    if horizontal:
        fig.update_xaxes(title_text="Percent of learners", ticksuffix="%", range=[0, 100])
        fig.update_yaxes(autorange="reversed", type="category", dtick=1)
    else:
        fig.update_yaxes(title_text="Percent of learners", ticksuffix="%", range=[0, 100])
        fig.update_xaxes(type="category", dtick=1)
    return fig, ct


def box_by_risk(p, df, col, *, title, height=340):
    d = df[[col, TARGET]].dropna()
    if d.empty:
        return None
    fig = go.Figure()
    for r in RISK_ORDER:
        vals = d.loc[d[TARGET] == r, col]
        if vals.empty:
            continue
        fig.add_box(y=vals, name=r, marker_color=p["risk"][r], line_width=2,
                    boxpoints=False, fillcolor=p["risk"][r], opacity=0.85,
                    hovertemplate=f"{r}<br>median %{{median}}<extra></extra>")
    fig.update_layout(title=title, showlegend=False)
    table = d.groupby(TARGET)[col].describe().round(2).reindex(
        [r for r in RISK_ORDER if r in d[TARGET].unique()])
    return style(fig, p, height=height, ylab=col), table


def age_hist(p, df, *, title="Age distribution by risk class", height=360):
    d = df[["Age", TARGET]].dropna()
    if d.empty:
        return None
    fig = go.Figure()
    for r in RISK_ORDER:
        vals = d.loc[d[TARGET] == r, "Age"]
        if vals.empty:
            continue
        fig.add_histogram(x=vals, name=r, marker_color=p["risk"][r],
                          marker_line=dict(color=p["surface"], width=1),
                          xbins=dict(size=1),
                          hovertemplate=f"{r}<br>age %{{x}}"
                                        "<br>%{y:,} learners<extra></extra>")
    fig.update_layout(barmode="stack", title=title)
    return style(fig, p, height=height, ylab="Learners", xlab="Age (years)")


def dmfx_hist(p, df, *, title="Combined DMFX + dmfx count", height=340):
    total = df["Total_DMFX_dmfx"].dropna()
    if total.empty:
        return None
    fig = go.Figure(go.Histogram(
        x=total, xbins=dict(size=1), marker_color=p["cat"][0],
        marker_line=dict(color=p["surface"], width=1),
        hovertemplate="%{x} affected teeth<br>%{y:,} learners<extra></extra>"))
    fig.update_layout(title=title)
    return style(fig, p, height=height, showlegend=False,
                 ylab="Learners", xlab="Affected teeth")


def mean_burden_by_grade(p, df, *, title="Mean affected teeth by grade", height=340):
    if not {"Grade", "Total_DMFX_dmfx"} <= set(df.columns):
        return None
    order = grade_order(df["Grade"].dropna().unique())
    g = (df.groupby("Grade")["Total_DMFX_dmfx"].agg(["mean", "count"])
         .reindex(order).dropna())
    if g.empty:
        return None
    fig = go.Figure(go.Bar(
        x=g.index, y=g["mean"], marker_color=p["cat"][0],
        marker_line=dict(color=p["surface"], width=1.5), customdata=g["count"],
        text=[f"{v:.1f}" for v in g["mean"]], textposition="outside", cliponaxis=False,
        textfont=dict(color=p["ink_secondary"], size=11),
        hovertemplate="Grade %{x}<br>mean %{y:.2f} affected teeth"
                      "<br>%{customdata:,} learners<extra></extra>"))
    fig.update_layout(title=title)
    fig = style(fig, p, height=height, showlegend=False, ylab="Mean affected teeth")
    fig.update_xaxes(type="category", dtick=1)
    return fig, g.round(2)


def dentition_by_grade(p, df, *, title="Where the burden sits — dentition by grade",
                       height=340):
    if not {"Perm_DMFX", "Temp_dfx", "Grade"} <= set(df.columns):
        return None
    order = grade_order(df["Grade"].dropna().unique())
    comp = (df.groupby("Grade")[["Perm_DMFX", "Temp_dfx"]].mean()
            .reindex(order).dropna(how="all"))
    if comp.empty:
        return None
    fig = go.Figure()
    for i, (col, label) in enumerate([("Temp_dfx", "Temporary (dfx)"),
                                      ("Perm_DMFX", "Permanent (DMFX)")]):
        fig.add_bar(x=comp.index, y=comp[col], name=label, marker_color=p["cat"][i],
                    marker_line=dict(color=p["surface"], width=2),
                    hovertemplate=f"{label}<br>grade %{{x}}"
                                  "<br>mean %{y:.2f} teeth<extra></extra>")
    fig.update_layout(barmode="stack", title=title)
    fig = style(fig, p, height=height, ylab="Mean affected teeth")
    fig.update_xaxes(type="category", dtick=1)
    return fig, comp.round(2)


def missing_bar(p, data, *, top=20, height=520):
    miss = data.isnull().sum()
    miss = miss[miss > 0].sort_values(ascending=False)
    if miss.empty:
        return None
    pct = (miss / len(data) * 100).round(1)
    head = miss.head(top)[::-1]
    fig = go.Figure(go.Bar(
        y=head.index, x=(head / len(data) * 100), orientation="h",
        marker_color=p["cat"][0], marker_line=dict(color=p["surface"], width=1.5),
        customdata=head.values,
        text=[f"{v:.0f}%" for v in (head / len(data) * 100)], textposition="outside",
        cliponaxis=False, textfont=dict(color=p["ink_secondary"], size=11),
        hovertemplate="%{y}<br>%{x:.1f}% missing<br>%{customdata:,} records<extra></extra>"))
    fig.update_layout(title="Most incomplete columns (labelled subset)")
    fig = style(fig, p, height=height, showlegend=False, xlab="Percent missing")
    fig.update_xaxes(ticksuffix="%", range=[0, 105])
    return fig, pd.DataFrame({"Missing": miss, "Percent": pct})


def leak_heatmap(p, df, *, cap=20, height=520):
    """Caries count against assigned risk. A zero cell renders blank, not pale."""
    d = df[["Total_DMFX_dmfx", TARGET]].dropna()
    if d.empty:
        return None
    ct = pd.crosstab(d["Total_DMFX_dmfx"], d[TARGET])
    ct = ct.reindex(columns=[r for r in RISK_ORDER if r in ct.columns])
    cap = int(min(ct.index.max(), cap))
    heat = ct.loc[ct.index <= cap]
    z = heat.astype(float).where(heat > 0)
    fig = go.Figure(go.Heatmap(
        z=z.values, x=z.columns, y=z.index,
        colorscale=[[i / (len(p["seq"]) - 1), c] for i, c in enumerate(p["seq"])],
        hovertemplate="%{x} risk<br>%{y} affected teeth<br>%{z:,} learners<extra></extra>",
        colorbar=dict(title=dict(text="Learners", font=dict(color=p["muted"], size=11)),
                      tickfont=dict(color=p["muted"], size=10),
                      outlinewidth=0, thickness=12)))
    fig.update_layout(title=f"Caries count against assigned risk (0–{cap} teeth)")
    fig = style(fig, p, height=height, showlegend=False, ylab="Affected teeth")
    fig.update_yaxes(gridcolor="rgba(0,0,0,0)", dtick=1)
    fig.update_xaxes(type="category")
    return fig, ct
