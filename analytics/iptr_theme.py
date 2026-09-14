"""Chart theme for the IPTR dashboard.

Palette slots are validated (light and dark) with the data-viz validator:
  - risk ramp   : single-hue blue ordinal ramp, Low -> High (monotone lightness)
  - categorical : slots 1-2 (blue, orange) for two-way splits
  - status      : reserved for data-quality states, always shipped with a label
Colours are never invented here; every value comes from the reference ramps.
"""

LIGHT = {
    "surface": "#fcfcfb",
    "plane": "#f9f9f7",
    "ink": "#0b0b0b",
    "ink_secondary": "#52514e",
    "muted": "#898781",
    "grid": "#e1e0d9",
    "axis": "#c3c2b7",
    "risk": {"Low": "#86b6ef", "Medium": "#2a78d6", "High": "#0d366b"},
    "cat": ["#2a78d6", "#eb6834"],
    "seq": ["#cde2fb", "#9ec5f4", "#5598e7", "#2a78d6", "#184f95", "#0d366b"],
}

DARK = {
    "surface": "#1a1a19",
    "plane": "#0d0d0d",
    "ink": "#ffffff",
    "ink_secondary": "#c3c2b7",
    "muted": "#898781",
    "grid": "#2c2c2a",
    "axis": "#383835",
    "risk": {"Low": "#cde2fb", "Medium": "#5598e7", "High": "#184f95"},
    "cat": ["#3987e5", "#d95926"],
    "seq": ["#0d366b", "#184f95", "#2a78d6", "#5598e7", "#9ec5f4", "#cde2fb"],
}

STATUS = {"good": "#0ca30c", "warning": "#fab219", "serious": "#ec835a", "critical": "#d03b3b"}

RISK_ORDER = ["Low", "Medium", "High"]

FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'


def palette(mode: str) -> dict:
    return DARK if mode == "dark" else LIGHT


def style(fig, p, *, height=340, showlegend=None, ylab="", xlab=""):
    """Apply recessive chrome: hairline grid, muted ticks, no chart junk."""
    fig.update_layout(
        height=height,
        margin=dict(l=8, r=8, t=64, b=8),
        paper_bgcolor=p["surface"],
        plot_bgcolor=p["surface"],
        font=dict(family=FONT, color=p["ink_secondary"], size=12),
        title=dict(font=dict(color=p["ink"], size=14), x=0, xanchor="left",
                   y=0.97, yanchor="top", yref="container"),
        hoverlabel=dict(font_family=FONT, font_size=12),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0,
                    traceorder="normal", title_text="",
                    font=dict(color=p["ink_secondary"])),
        bargap=0.28,
    )
    if showlegend is not None:
        fig.update_layout(showlegend=showlegend)
    fig.update_xaxes(title_text=xlab, showgrid=False, zeroline=False,
                     linecolor=p["axis"], tickcolor=p["axis"],
                     tickfont=dict(color=p["muted"], size=11),
                     title_font=dict(color=p["muted"], size=11))
    fig.update_yaxes(title_text=ylab, gridcolor=p["grid"], zeroline=False,
                     linecolor="rgba(0,0,0,0)", tickcolor=p["axis"],
                     tickfont=dict(color=p["muted"], size=11),
                     title_font=dict(color=p["muted"], size=11))
    return fig
