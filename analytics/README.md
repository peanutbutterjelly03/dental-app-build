# IPTR Dental EDA Dashboard

An interactive read of the IPTR workbook (school-based oral health examination
records) — the same dataset and the same cleaning as the Group 13 notebook
`Group_13_A_1.ipynb`, rebuilt as a dashboard so the findings can be filtered and
shown live instead of re-run cell by cell.

## Step by step, from nothing (first time on a machine)

**1. Check you have Python.** Open a terminal — **Command Prompt** on Windows,
**Terminal** on macOS — and type:

```
python --version
```

Anything 3.9 or newer is fine. If it says the command is not found, install it
from python.org — **on Windows tick “Add python.exe to PATH”** on the first
screen of the installer — then close and reopen the terminal.

On Windows, if `python` still isn't found, use `py` in place of `python` in every
command below. On macOS use `python3`.

**2. Get the code.** In the terminal, go to wherever you keep the repo and pull
this branch:

```
cd path\to\dental-app-build
git fetch origin
git checkout claude/exciting-goldberg-uodxdu
git pull
cd analytics
```

**3. Install the libraries.** Once per machine:

```
python -m pip install -r requirements.txt
```

**4. Put the workbook where the script can find it.** Copy
`IPTR_Dataset.xlsx` into this `analytics` folder.

**5a. To get the HTML file:**

```
python build_report.py IPTR_Dataset.xlsx
```

It prints how many records it read and writes `iptr_report.html` beside the
script. Double-click that file to open it in your browser.

**5b. Or to get the filterable app instead:**

```
python -m streamlit run iptr_dashboard.py
```

Leave the terminal window open — closing it stops the app. It opens
`http://localhost:8501` in your browser by itself; if it doesn't, copy the URL
the terminal prints. Press `Ctrl+C` in the terminal to stop it.

### If something goes wrong

| What you see | What it means |
|---|---|
| `python: command not found` | Use `py` (Windows) or `python3` (macOS), or reinstall Python with “Add to PATH” ticked |
| `No such workbook: IPTR_Dataset.xlsx` | You are not in the `analytics` folder, or the file is named differently — run `dir` (Windows) / `ls` (macOS) to see what's actually there |
| `No module named pandas` | Step 3 was skipped, or it installed into a different Python — re-run it with the same word (`python` / `py` / `python3`) you use to run the script |
| `Column 'Risk Classification' is not on this sheet` | The sheet has no label column; pass the right one, e.g. `--sheet "Raw Copy of Manual Encoded"` |
| `streamlit: command not found` | Use `python -m streamlit run iptr_dashboard.py` rather than plain `streamlit` |

## Run it

```bash
cd analytics
pip install -r requirements.txt
streamlit run iptr_dashboard.py
```

Then load `IPTR_Dataset.xlsx` from the sidebar. If the workbook sits next to
`iptr_dashboard.py` (or its path is in the `IPTR_DATASET` environment variable)
it is picked up automatically and the uploader can be skipped.

Run it from this folder so `.streamlit/config.toml` is picked up — it pins the
app to the light surface the chart palette was validated against.

## Or export it as one HTML file

No server, nothing to install on the machine that reads it:

```bash
python build_report.py IPTR_Dataset.xlsx            # writes iptr_report.html
python build_report.py IPTR_Dataset.xlsx -o docs/iptr_report.html
```

Double-click the file and it opens in any browser. Plotly is embedded, so the
charts keep hover tooltips, legend toggles and zoom, and the file works offline
and prints. It covers the same six sections over the whole labelled dataset.

**What the export cannot do is filter** — sidebar filtering needs a running
process. For a grade/sex/age slice, use the Streamlit app above.

## What it shows

| Tab | Answers |
|---|---|
| **Overview** | How much of the sheet is usable, how the three risk classes are spread, and how the mix shifts by grade |
| **Demographics** | Age, sex, BMI and nutritional status against risk |
| **Oral findings** | Recorded caries / gingivitis / debris / calculus, each against the risk mix, plus the Orally Fit Child tick |
| **Caries burden** | The combined DMFX + dmfx distribution, mean burden by grade, and the permanent-vs-temporary split |
| **Data quality** | Every correction the loader applied, the missingness profile, and the OFC-vs-caries contradiction list (downloadable) |
| **Label check** | Recovers the cut-off rule the encoder applied to assign the label, and measures how well it holds — the target-leakage evidence |

## How it handles the data

- Only records carrying a `Risk Classification` value are used; the rest cannot
  be used for supervised learning and are counted, not silently dropped.
- Columns that are blank for every labelled record are dropped rather than
  imputed — imputing a wholly empty column only invents data.
- Missing values stay missing. Nothing on screen is a placeholder: where there is
  no data the panel says so.
- Corrections (impossible ages, zero BMI, mixed yes/no spellings, sex variants,
  exact duplicates) are applied in `iptr_data.clean` and **reported** on the Data
  quality tab, so the cleaning is auditable rather than invisible.
- Repeated names are reported but kept — a learner examined twice is two valid
  rows.
- The cut-off rule on the Label check tab is read off the loaded data, never
  hard-coded, so a differently labelled workbook reports differently.

## Files

| File | Role |
|---|---|
| `iptr_dashboard.py` | The Streamlit app — layout, filters, tabs |
| `build_report.py` | Exports the same report as one self-contained HTML file |
| `iptr_charts.py` | The figures, shared by both so they cannot drift apart |
| `iptr_data.py` | Workbook loading, cleaning, and the audit it returns |
| `iptr_theme.py` | Chart palette and chrome (validated light and dark steps) |
| `.streamlit/config.toml` | App theme |

## A note on the data

The generated `iptr_report.html` is gitignored along with the workbook: it
carries learner names in the contradiction list. The workbook holds learner names and other patient information. It is not
committed to this repository and the downloadable correction list contains
names — handle both as patient data.
