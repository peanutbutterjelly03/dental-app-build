# IPTR Dental EDA Dashboard

An interactive read of the IPTR workbook (school-based oral health examination
records) — the same dataset and the same cleaning as the Group 13 notebook
`Group_13_A_1.ipynb`, rebuilt as a dashboard so the findings can be filtered and
shown live instead of re-run cell by cell.

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
| `iptr_dashboard.py` | The Streamlit app — layout, filters, charts |
| `iptr_data.py` | Workbook loading, cleaning, and the audit it returns |
| `iptr_theme.py` | Chart palette and chrome (validated light and dark steps) |
| `.streamlit/config.toml` | App theme |

## A note on the data

The workbook holds learner names and other patient information. It is not
committed to this repository and the downloadable correction list contains
names — handle both as patient data.
