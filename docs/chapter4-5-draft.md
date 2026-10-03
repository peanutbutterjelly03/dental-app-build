# Chapter 4 & 5 — Working Draft

> **DO NOT MERGE THIS INTO THE MANUSCRIPT.** Standing instruction from the user
> (2026-07-28): this file stays separate from `docs/Group404 - Manuscript.md`
> permanently — not once the `[PENDING]` blocks are filled, not ever. The user
> assembles the manuscript themselves. Do not append, inline, or auto-sync
> Chapter 4/5 into the manuscript file.

> **STATUS NOTICE — read before using this document.**
> This is a *draft skeleton*, not defense-ready text. Two categories of content are
> deliberately unfilled, and both are marked inline with `[PENDING]`:
>
> 1. **ISO/IEC 25010:2023 evaluation results** — the 30-respondent survey has not
>    been administered yet. Every weighted-mean value in Section 4.5 is a blank
>    placeholder. Do NOT invent numbers here; they must come from real respondents.
> 2. **Predictive analytics results** — the figures currently in
>    `docs/algo-results.md` were produced from a **synthetic** dataset, not real
>    IPTR records (see the notice at the top of that file). Section 4.3's tables
>    reproduce them *only* to establish the reporting format. Every value must be
>    regenerated once the real Barangay Tanyag IPTR data is located and Sprints
>    21a–21d are re-run.
>
> Prose describing what was *built* is safe to use as-is — it reflects the actual
> deployed system per `docs/BUILD-LOG.md`.
>
> **Structure basis:** organized per Specific Objective, following the JRU
> capstone convention observed in the Ethos, LinkTech, and Nocturnal Coders
> reference manuscripts (`docs/reference/`). All three use the same pattern —
> one Chapter 4 block per SO, ISO 25010 evaluation last, then a Chapter 5 of
> Summary → Conclusions (one per SO) → Recommendations (grouped by audience).

---

# **Chapter 4** **PRESENTATION, ANALYSIS, AND INTERPRETATION OF DATA**

This chapter presents the results of the design, development, and evaluation of
Floral, a Dental Health Record Management System with Predictive Analytics for
the school dental clinics of Barangay Tanyag, Taguig City. The findings are
organized according to the specific objectives stated in Chapter 1. Sections 4.1
through 4.4 present the developed system modules, describing how each objective
was realized in the deployed system and the data flow that supports it. Section
4.5 presents the results of the system evaluation conducted using the ISO/IEC
25010:2023 standard on software product quality, as assessed by thirty (30)
respondents composed of dentists, dental aides, school clinic staff, school
administrators, and IT evaluators. Each result is presented, analyzed, and
interpreted in relation to the operational needs of the three covered school
dental clinics.

---

## **4.1 Management of Student Dental Health Information**

> *Specific Objective 1: To develop a system that analyzes and improves the
> management of student dental health information covering the following:
> personal details, medical history, dietary habits, social history, dental
> health conditions, treatment records, dental charts, and appointment data at
> Barangay Tanyag school dental clinics.*

The system consolidates the eight information categories enumerated in the first
specific objective into a single digital Individual Patient Treatment Record
(IPTR) per student, replacing the paper forms previously maintained separately at
each of the three school dental clinics. Each student record is stored as a
central profile from which all related clinical records are linked, allowing
personnel to retrieve a student's complete dental history from one screen rather
than reconciling multiple physical forms.

### **Figure 4.1.1** *Student Record List with Search and Filter Controls*

`docs/figures/fig-4.1.1-student-list.png`

Figure 4.1.1 presents the student record list, which serves as the entry point to
all patient information. Records are retrieved from the centralized MongoDB
database and displayed with the student's name, grade level, section, school, and
most recent risk classification. Personnel may search by name or student
identifier and filter by school, grade level, and risk level, allowing the single
assigned dentist to narrow approximately 8,000 records to a working subset within
one operation.

### **Figure 4.1.2** *Individual Patient Treatment Record — Medical History, Dietary and Social Habits, and Oral Health Conditions*

`docs/figures/fig-4.1.2-iptr-history-and-oral.png`

Figure 4.1.2 shows the digital IPTR. The record header carries the personal
details previously handwritten on the DOH paper form — birthday, age, sex,
address, contact number, PhilHealth number, guardian name, and guardian contact.
The record is organized into tabs, of which the first, History & Oral, presents
three sections in a single view: medical history covering systemic conditions,
hospitalization, transfusion, and allergies; dietary habits and social history
covering sugar-sweetened beverage intake, tobacco and alcohol use, betel nut
chewing, nail biting, and thumbsucking; and oral health conditions covering
gingivitis, periodontal disease, debris, calculus, abnormal growth, and cleft
lip or palate. Presenting these together mirrors the single-page layout of the
DOH paper form, so that personnel encoding from the physical document work down
the screen in the same order they read the page.

The oral health condition fields serve a dual purpose: they document the clinical
examination, and they supply input variables consumed by the predictive analytics
module described in Section 4.3.

Sensitive identifying fields — full name, address, contact number, guardian name,
guardian contact, PhilHealth number, and 4Ps identifier — are encrypted using
AES-256-CBC with a randomly generated initialization vector per value before they
are written to the database, so that stored records remain unreadable even if the
underlying database is accessed directly. Non-sensitive fields required for
querying, such as school identifier, grade level, and archival status, remain
unencrypted so that filtering and reporting operations remain performant.

Records are organized by school year, and the year selector shown above the tabs
allows the dentist to review a prior year's record without altering it.

### **Figure 4.1.3** *Remaining Record Tabs — Consent, Treatment History, and DMFT History*

`docs/figures/fig-4.1.3a-consent-tab.png`
`docs/figures/fig-4.1.3b-treatment-history-tab.png`
`docs/figures/fig-4.1.3c-dmft-history-tab.png`

Figure 4.1.3 presents the remaining tabs of the patient record. The Consent tab
records parental consent for the dental services enumerated in the clinic's
existing Parental Consent Form. The Treatment History tab lists the student's
prior visits and procedures. The DMFT History tab tracks the student's DMF index
across school years, allowing the dentist to observe whether caries experience is
increasing, stable, or improving over time. Two further tabs, Referrals and Risk
Classification, are presented in Sections 4.2 and 4.3 respectively.

### **Figure 4.1.4** *Digital Dental Chart (Odontogram)*

`docs/figures/fig-4.1.4-dental-chart.png` (chart list: `fig-4.1.4a-dental-chart-list.png`)

Figure 4.1.4 shows the digital dental chart, which records the condition of each
tooth using standard dental notation. The chart opens in view mode by default and
requires the dentist to explicitly enter edit mode before any tooth condition can
be modified, preventing accidental alteration of clinical records during routine
review. The system computes the DMF index for permanent dentition and the dmf
index for primary dentition directly from the recorded tooth conditions, removing
the manual tallying previously performed by the dentist and eliminating a
recognized source of arithmetic error. A mixed-dentition indicator is displayed
for students presenting both primary and permanent teeth. Tooth-level editing and
the condition palette are restricted to the dentist role; dental aides may update
the history and oral condition sections but cannot alter tooth records.

### **Figure 4.1.5** *Optical Character Recognition Scanning of Paper IPTR Forms*

`[SCREENSHOT STILL NEEDED — OCR scan module; the capture run could not reach it
because it opens from within the student-creation flow and needs a sample IPTR
form image to show a real extraction result. Capture this one by hand.]`

Figure 4.1.5 presents the optical character recognition module, implemented using
Tesseract.js, which accepts a photographed or scanned DOH IPTR paper form and
extracts the student's name, birthday, age, sex, address, contact number, grade
level, and section into a structured record. The extracted values are presented
to the user for verification before saving, since the module is intended to
reduce encoding effort during the migration of existing paper records rather than
to replace human validation. A bulk import facility additionally accepts CSV and
Excel files, validating each row independently and reporting per-row outcomes, so
that a single malformed entry does not invalidate an entire import batch.

The migration of student dental health information from paper to the system
therefore proceeds through three complementary paths — direct encoding, OCR
extraction from existing paper forms, and bulk file import — chosen according to
the format in which the source records are held at each clinic.

---

## **4.2 Appointment Scheduling, Preventive Care Monitoring, Audit Trail, and Centralized Storage**

> *Specific Objective 2: To design and develop a system that enables appointment
> scheduling and monitoring, recording and updating of individual patient
> treatment records, routine preventive care records, audit trails, and
> centralized storage of student dental records across schools.*

### **Figure 4.2.1** *Appointment Scheduling and Monitoring Module*

`docs/figures/fig-4.2.1-appointments.png`

Figure 4.2.1 shows the appointment scheduling module. Appointments are created
against a student record and carry a scheduled date, purpose, attending
personnel, and status. Status transitions are recorded as the appointment
progresses, and appointments requiring follow-up are flagged so that they surface
in the dashboard's follow-up list described in Section 4.4. Appointments
involving procedures that require parental consent are marked accordingly,
reflecting the consent requirement documented in the clinic's existing Parental
Consent Form for School Dental Health Services.

### **Figure 4.2.2** *Individual Treatment Record Entry*

`docs/figures/fig-4.2.2-treatment-records.png`

Figure 4.2.2 presents treatment record entry. Each clinical visit is logged with
the date, chief complaint, diagnosis, treatment performed, and attending dentist,
matching the visit log section of the DOH paper form. The diagnosis and treatment
fields are encrypted at rest. Because encrypted fields cannot be updated through
Mongoose's atomic update operators without bypassing the encryption hooks, all
routes handling these records retrieve the document and save it explicitly,
ensuring that encryption is applied consistently on every write.

### **Figure 4.2.3** *Routine Preventive Care Two-Visit Tracking*

`docs/figures/fig-4.2.3-rpc-tracking.png`

Figure 4.2.3 shows the Routine Preventive Care monitoring module, which tracks
the two-visit preventive care process mandated by the DOH School Dental Health
Care Program. Visit 1 and Visit 2 are recorded separately, each capturing oral
screening findings, oral prophylaxis, fluoride varnish application, dental
hygiene instruction, and caries risk assessment. The module reports completion
status per student, allowing the clinic to identify students who received the
first visit but have not yet returned for the second — a determination that
previously required manually cross-checking paper tally forms. The system flags
instances where a second visit is recorded earlier than the expected interval,
prompting the personnel to confirm the entry.

### **Figure 4.2.4** *Audit Trail*

`docs/figures/fig-4.2.4-audit-trail.png`

Figure 4.2.4 presents the audit trail. Every addition, modification, and archival
performed by any user across the three school sites is recorded with the acting
user, the affected record, the action performed, and the timestamp. The audit
trail additionally records the outcome of dentist validation of predictive
analytics results, distinguishing recommendations that were accepted without
modification from those the dentist altered before acceptance, as described in
Section 4.3.

No record in the system is permanently deleted. All models implement soft
deletion through an archival flag, an archival timestamp, and a reference to the
archiving user. All retrieval operations exclude archived records by default, and
only the System Administrator role may view or restore them. This design
preserves the complete clinical history required for longitudinal monitoring
while still allowing erroneous entries to be withdrawn from active use.

### **Figure 4.2.5** *Role-Based Access Control and Account Management*

`docs/figures/fig-4.2.5-account-management.png`

Figure 4.2.5 shows account management. The system implements five roles — System
Administrator, Dentist, Dental Aide, School Administrator, and Barangay Health
Office Staff — each with distinct permissions verified on every application
programming interface call rather than only in the user interface. Authentication
uses JSON Web Tokens with configured expiry and refresh handling, and all
passwords are hashed using bcrypt. Optional two-factor authentication by
electronic mail is available per account, and enabling it requires a test code to
be successfully received and entered, preventing an account from being locked
behind an unreachable mailbox.

Centralized storage across the three schools is achieved by a single database
serving all sites, with the school identifier stored on each student record.
Personnel assigned to multiple schools may switch the active school context, and
consolidated views across all three schools are available to the Barangay Health
Office Staff role for reporting purposes.

---

## **4.3 Predictive Analytics Module**

> *Specific Objective 3: To integrate a predictive analytics module to analyze
> historical dental records, identify potential dental health conditions, provide
> treatment recommendations, and risk classification interface through risk
> stratification categorization of dental health data to the dentist as inputs
> for a decision-support system.*

> **[PENDING — SYNTHETIC DATA]** All quantitative values in this section were
> produced from a generated placeholder dataset used to exercise the experimental
> pipeline end to end. They establish the reporting format only. Every value must
> be regenerated from the real Barangay Tanyag IPTR records before this section
> is defensible, and the selected algorithm may change when that is done.

### **4.3.1 Data Preparation and Feature Engineering**

Historical dental records were cleaned to standardize inconsistent formatting,
resolve variant spellings of condition names, and handle missing values. Records
lacking the fields required for classification were excluded rather than imputed,
to avoid introducing artificial clinical signal. Any column containing student
names was dropped entirely from the machine learning pipeline rather than merely
anonymized; rows are identified by student identifier alone. Student names remain
encrypted within the operational database and never enter the analytical dataset
at any stage.

Feature engineering produced [N] input features from the cleaned records. The
DMF/dmf index serves as the primary predictor, consistent with its role as the
standard clinical measure of caries experience, and is supplemented by recorded
oral health conditions, dietary habits, medical history indicators, and treatment
history. The target variable is a three-class risk classification of High, Medium,
or Low.

### **Table 4.1** *Dataset Composition and Class Distribution*

| Attribute | Value |
| :---- | :---: |
| Total records | `[PENDING — real data]` |
| Features | `[PENDING — real data]` |
| High risk | `[PENDING]` |
| Medium risk | `[PENDING]` |
| Low risk | `[PENDING]` |

### **4.3.2 Algorithm Comparison**

Five supervised classification algorithms were trained and compared: Logistic
Regression, Decision Tree, Random Forest, Support Vector Machine, and XGBoost.
Two evaluation methods were applied to each. A stratified 80/20 train–test split
served as a secondary check, while Stratified K-Fold cross-validation with k = 5
served as the primary basis for model selection. A k of 5 was chosen over 10
because the smaller folds produced by k = 10 would render the less frequent
condition classes unreliable within individual folds.

Macro-averaged F1 score was adopted as the primary selection metric. Accuracy
alone is misleading on imbalanced clinical data, since a model that
over-predicts the majority class can appear accurate while systematically failing
to identify High-risk students — the most costly error in this system, as those
students are precisely the ones requiring earliest clinical attention. Macro-F1
weights all three classes equally and therefore penalizes such behavior.

### **Table 4.2** *Comparison of Classification Algorithms*

> **[PENDING]** Values below are from the synthetic dry-run and must be replaced.

| Algorithm | T/T Acc | T/T Prec | T/T Rec | T/T F1 | KF Acc | KF Prec | KF Rec | KF F1 |
| :---- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Logistic Regression | 0.7444 | 0.7560 | 0.7417 | 0.7469 | 0.7402 | 0.7502 | 0.7416 | **0.7444 ± 0.0126** |
| Decision Tree | 0.7300 | 0.7425 | 0.7265 | 0.7328 | 0.7230 | 0.7309 | 0.7272 | **0.7284 ± 0.0109** |
| Random Forest | 0.6981 | 0.7032 | 0.7025 | 0.7027 | 0.7010 | 0.7058 | 0.7085 | **0.7069 ± 0.0145** |
| Support Vector Machine | 0.7431 | 0.7513 | 0.7433 | 0.7462 | 0.7356 | 0.7433 | 0.7385 | **0.7399 ± 0.0104** |
| XGBoost | 0.7013 | 0.7071 | 0.7026 | 0.7046 | 0.7053 | 0.7108 | 0.7098 | **0.7097 ± 0.0096** |

`[Interpretation paragraph — to be written against real results. State which
algorithm achieved the highest K-Fold F1, by what margin, and whether the margin
exceeds one standard deviation of the runner-up.]`

### **Table 4.3** *Train/Test versus K-Fold Consistency*

> **[PENDING]** Values below are from the synthetic dry-run and must be replaced.

| Algorithm | Train/Test F1 | K-Fold F1 | Difference |
| :---- | :---: | :---: | :---: |
| Logistic Regression | 0.7469 | 0.7444 | +0.0025 |
| Decision Tree | 0.7328 | 0.7284 | +0.0044 |
| Random Forest | 0.7027 | 0.7069 | −0.0043 |
| Support Vector Machine | 0.7462 | 0.7399 | +0.0063 |
| XGBoost | 0.7046 | 0.7097 | −0.0051 |

The comparison between the two evaluation methods is itself informative.
Agreement between the holdout and cross-validation results indicates a stable
model. A K-Fold result substantially higher than the holdout result would suggest
that the single split was unrepresentative, while a K-Fold result substantially
lower would indicate overfitting that the holdout evaluation failed to detect.

`[Interpretation paragraph — to be written against real results.]`

### **Figure 4.3.1** *Confusion Matrices per Algorithm*

`[FIGURE — docs/confusion-matrices/*.png, regenerated from real data]`

### **Figure 4.3.2** *Feature Importance*

`[FIGURE — docs/feature-importance.png, regenerated from real data]`

Figure 4.3.2 presents the relative contribution of each input feature to the
classification outcome.

### **Figure 4.3.3** *Decision Tree Visualization*

`[FIGURE — docs/decision-tree.png, regenerated from real data]`

Figure 4.3.3 shows the trained decision tree rendered to a limited depth. While
the decision tree is not necessarily the selected model, it is retained as the
visual explanation of how the feature space separates the three risk levels,
since its splits are directly readable by clinical personnel.

### **4.3.3 Model Selection**

### **Table 4.4** *Final Model Selection Summary*

| Rank | Algorithm | K-Fold F1 | Selection Note |
| :---: | :---- | :---: | :---- |
| 1 | `[PENDING]` | `[PENDING]` | Selected |
| 2 | `[PENDING]` | `[PENDING]` | |
| 3 | `[PENDING]` | `[PENDING]` | |
| 4 | `[PENDING]` | `[PENDING]` | |
| 5 | `[PENDING]` | `[PENDING]` | |

Beyond the primary metric, selection also considered interpretability and
training cost. Interpretability carries particular weight in this system because
predictions are presented to a dentist for validation rather than acted upon
automatically; a model whose reasoning can be articulated to clinical staff
better supports that validation step. Training cost is relevant because the model
is intended to be retrained as new records accumulate.

The system implements the Strategy Pattern for algorithm selection. The active
algorithm is declared in a single configuration file, and the Express backend
invokes only the predictor interface rather than any individual algorithm
implementation. Substituting a different algorithm — including after the
real-data re-run — is therefore a single-line change, and no other component of
the application is aware of which algorithm is in use.

### **4.3.4 Risk Classification and Dentist Validation Interface**

### **Figure 4.3.4** *Risk Stratification Interface*

`docs/figures/fig-4.3.4-risk-classification.png`

Figure 4.3.4 presents the risk classification interface. The dentist may generate
a risk assessment for an individual student or queue a batch of students for
assessment. Each result displays the predicted risk level, the contributing
factors, and a corresponding treatment recommendation.

### **Figure 4.3.5** *Dentist Validation of Recommendations*

`docs/figures/fig-4.3.5-dentist-validation.png`

Figure 4.3.5 shows the validation step. The predicted risk level and recommended
treatment pre-fill editable fields rather than being presented as fixed output,
requiring the dentist to review and either confirm or amend each value before it
is committed to the student's record. The audit trail records whether the dentist
accepted the recommendation unchanged or modified it, together with the modified
values, producing a documented record of clinical oversight over the predictive
module.

This design enforces the constraint that the predictive analytics module
functions strictly as a decision-support tool. No prediction produces a clinical
outcome in the system without explicit dentist validation, and the module does not
replace the professional judgment of the dentist at any point.

The predictive service is deployed independently of the main application and
communicates with the Express backend through defined interface endpoints.
Because the service is hosted on an environment that suspends idle instances, the
interface reports service availability status and retries through the resumption
interval, informing the user that the service is being started rather than
presenting a failure.

---

## **4.4 Dashboards, Reports, and Record Monitoring**

> *Specific Objective 4: To generate dashboards that provide an overview of
> student dental health, reports that summarize treatment history and appointment
> data, and filterable and searchable dental records that allow school clinic
> staff to monitor progress and manage follow-ups efficiently.*

### **Figure 4.4.1** *Dentist Dashboard*

`docs/figures/fig-4.4.1-dashboard-dentist.png`

Figure 4.4.1 presents the dentist dashboard. Summary indicators report the total
student population under care, the distribution of risk classifications, the
count of high-risk students requiring attention, and progress through the Routine
Preventive Care process. A follow-up list identifies students with appointments
requiring subsequent action. All values are computed from live database records;
no indicator on the dashboard displays a placeholder or sample value.

### **Figure 4.4.2** *Role-Specific Dashboard Views*

`docs/figures/fig-4.4.2a-dashboard-school-admin.png` + `fig-4.4.2b-dashboard-bho.png`

Figure 4.4.2 shows the dashboard as presented to the School Administrator and
Barangay Health Office Staff roles. School Administrators view aggregate dental
health indicators for their own school without access to individual clinical
records, consistent with their institutional oversight function. Barangay Health
Office Staff view consolidated indicators across all three schools for reporting
purposes.

### **Figure 4.4.3** *Routine Preventive Care Progress and Procedure Distribution*

(crop the RPC funnel and procedures regions from `docs/figures/fig-4.4.1-dashboard-dentist.png`)

Figure 4.4.3 presents the Routine Preventive Care completion funnel and the
distribution of procedures performed. The funnel reports how many students have
completed Visit 1, how many have completed both visits, and how many remain
outstanding, providing the clinic with a direct measure of compliance against the
twice-yearly mandate.

### **Figure 4.4.4** *DOH-Aligned Report Generation*

`docs/figures/fig-4.4.4-reports.png`

Figure 4.4.4 shows the report generation module. The system produces the School
Oral Health Status and Service Report and the Consolidated Report for submission
to the City Health Office, structured according to existing DOH reporting
formats. Reports present counts by age bracket and by sex, matching the
categories used in the clinic's current Dental Health Program Reporting Form, so
that generated output can be submitted without manual reformatting. Reports
default to the current reporting month and year and may be generated for any
prior period.

### **Figure 4.4.4b** *Oral Health Program Reporting Form*

`docs/figures/fig-4.4.4b-program-report.png`

Figure 4.4.4b shows the Oral Health Program Reporting Form as the system
generates it, reproduced from the signed return the clinic files monthly with the
City Health Office. Every row and column of the printed form is rendered,
including those a school clinic can never fill, because a blank cell on a
statutory return carries meaning that an omitted row does not. Cells display an
em dash where the system holds no source for that figure, and cells the paper
form blocks out are shaded and left empty, so the two states remain
distinguishable to a reader. Sections A through C and the unlettered Other
Procedures band follow the printed form, and the indicators the form subdivides —
oral prophylaxis and scaling, fluoride varnish and silver diamine fluoride by
application, and atraumatic restorative treatment, sealants, root surface
protection and extraction by head count and tooth count — are presented with the
same two-column split the paper uses.

### **Figure 4.4.5** *Report Export Formats*

`docs/figures/fig-4.4.5-export-menu.png` (Reports' own PDF/Excel controls: `fig-4.4.5b-reports-download-controls.png`)

Figure 4.4.5 presents the export facility. Export is deliberately restricted to
official aggregate output and to the audit trail; the student, preventive-care,
and appointment lists carry no export control, because a downloaded roster of
identified minors would leave the system's access controls behind. The audit
trail exports in comma-separated value and Excel formats, and each official form
exports in the format its recipient requires: the Consolidated Report and the
Oral Health Program Reporting Form as both a formatted Excel workbook preserving
the multi-tier header structure of the official form and a document-format file
suitable for printing and submission, the Target Client List as Excel only, and
the Individual Patient Treatment Record as a printable document only.

Filtering and search are available across all record lists, supporting retrieval
by name, school, grade level, section, risk classification, and appointment
status. Given a population of approximately 8,000 students managed by a single
dentist and a single dental aide, this retrieval capability substantively
addresses the record-location difficulty identified in the paper-based workflow.

---

## **4.5 System Evaluation Using ISO/IEC 25010:2023**

> *Specific Objective 5: To test and evaluate the system using the ISO 25010,
> version 2023 standard on software product quality in terms of Functional
> Suitability, Performance Efficiency, Compatibility, Usability, Reliability, and
> Security.*

> **[PENDING — EVALUATION NOT YET CONDUCTED]** The 30-respondent survey has not
> been administered. All tables in this section are structural placeholders.
> Values must be computed from actual respondent data using the weighted mean
> formula and scale interpretation established in Chapter 3.

The system was evaluated by thirty (30) respondents selected through total
population sampling, as identified in Table 3.1 of Chapter 3. Respondents rated
the system using a researcher-developed questionnaire derived from the ISO/IEC
25010:2023 quality characteristics, employing a five-point Likert scale.
Responses were analyzed using the weighted mean, and the resulting values were
interpreted according to the scale interpretation presented in Table 3.4.

### **Table 4.5** *Distribution of Respondents*

| Respondent Group | Number | Percentage |
| :---- | :---: | :---: |
| Dentists | 10 | 33.33% |
| Dental Aides | 10 | 33.33% |
| School Clinic Staff | 3 | 10.00% |
| School Administrators | 3 | 10.00% |
| IT Evaluators | 4 | 13.33% |
| **Total** | **30** | **100.00%** |

### **4.5.1 Functional Suitability**

### **Table 4.6** *Evaluation Results for Functional Suitability*

| Indicator | Weighted Mean | Verbal Interpretation |
| :---- | :---: | :---: |
| The system provides the functions needed to manage student dental records. | `[PENDING]` | `[PENDING]` |
| The system's functions produce correct and accurate results. | `[PENDING]` | `[PENDING]` |
| The system's functions are appropriate to the tasks of the school dental clinic. | `[PENDING]` | `[PENDING]` |
| **Overall Weighted Mean** | `[PENDING]` | `[PENDING]` |

`[Interpretation paragraph: state the overall weighted mean and its verbal
interpretation, identify the highest- and lowest-rated indicators, and relate the
result to the clinic's operational requirements.]`

### **4.5.2 Performance Efficiency**

### **Table 4.7** *Evaluation Results for Performance Efficiency*

| Indicator | Weighted Mean | Verbal Interpretation |
| :---- | :---: | :---: |
| The system responds within an acceptable time when retrieving student records. | `[PENDING]` | `[PENDING]` |
| The system performs efficiently when generating reports and dashboards. | `[PENDING]` | `[PENDING]` |
| The system operates without noticeable delay under normal clinic use. | `[PENDING]` | `[PENDING]` |
| **Overall Weighted Mean** | `[PENDING]` | `[PENDING]` |

`[Interpretation paragraph.]`

### **4.5.3 Compatibility**

### **Table 4.8** *Evaluation Results for Compatibility*

| Indicator | Weighted Mean | Verbal Interpretation |
| :---- | :---: | :---: |
| The system operates correctly across the devices used in the clinic. | `[PENDING]` | `[PENDING]` |
| The system functions correctly on different web browsers. | `[PENDING]` | `[PENDING]` |
| The system coexists with other applications used in the clinic without conflict. | `[PENDING]` | `[PENDING]` |
| **Overall Weighted Mean** | `[PENDING]` | `[PENDING]` |

`[Interpretation paragraph.]`

### **4.5.4 Usability**

### **Table 4.9** *Evaluation Results for Usability*

| Indicator | Weighted Mean | Verbal Interpretation |
| :---- | :---: | :---: |
| The system is easy to learn for personnel with limited technical background. | `[PENDING]` | `[PENDING]` |
| The interface is clear and the functions are easy to locate. | `[PENDING]` | `[PENDING]` |
| The system protects users from errors and allows correction of mistakes. | `[PENDING]` | `[PENDING]` |
| The dental charting interface is understandable and easy to operate. | `[PENDING]` | `[PENDING]` |
| **Overall Weighted Mean** | `[PENDING]` | `[PENDING]` |

`[Interpretation paragraph.]`

### **4.5.5 Reliability**

### **Table 4.10** *Evaluation Results for Reliability*

| Indicator | Weighted Mean | Verbal Interpretation |
| :---- | :---: | :---: |
| The system operates consistently without failure during use. | `[PENDING]` | `[PENDING]` |
| The system remains available when needed during clinic hours. | `[PENDING]` | `[PENDING]` |
| The system recovers correctly after interruption or loss of connection. | `[PENDING]` | `[PENDING]` |
| **Overall Weighted Mean** | `[PENDING]` | `[PENDING]` |

`[Interpretation paragraph. Note the offline capability — service worker and
local storage with ordered synchronization — as relevant to this characteristic.]`

### **4.5.6 Security**

### **Table 4.11** *Evaluation Results for Security*

| Indicator | Weighted Mean | Verbal Interpretation |
| :---- | :---: | :---: |
| The system restricts access to patient records according to user role. | `[PENDING]` | `[PENDING]` |
| Student information is adequately protected from unauthorized access. | `[PENDING]` | `[PENDING]` |
| The system maintains an accurate record of user actions. | `[PENDING]` | `[PENDING]` |
| The system authenticates users appropriately before granting access. | `[PENDING]` | `[PENDING]` |
| **Overall Weighted Mean** | `[PENDING]` | `[PENDING]` |

`[Interpretation paragraph. Relate to encryption at rest, role-based access
control verified per request, audit trail, and two-factor authentication.]`

### **4.5.7 Summary of Evaluation Results**

### **Table 4.12** *Summary of ISO/IEC 25010:2023 Evaluation Results*

| Quality Characteristic | Overall Weighted Mean | Verbal Interpretation |
| :---- | :---: | :---: |
| Functional Suitability | `[PENDING]` | `[PENDING]` |
| Performance Efficiency | `[PENDING]` | `[PENDING]` |
| Compatibility | `[PENDING]` | `[PENDING]` |
| Usability | `[PENDING]` | `[PENDING]` |
| Reliability | `[PENDING]` | `[PENDING]` |
| Security | `[PENDING]` | `[PENDING]` |
| **Grand Weighted Mean** | `[PENDING]` | `[PENDING]` |

`[Closing interpretation paragraph: state the grand weighted mean and its verbal
interpretation, identify the highest- and lowest-rated characteristics, and state
what the overall result indicates about the system's fitness for deployment in
the three covered school dental clinics.]`

---

## **4.6 Challenges Encountered**

`[Optional section — present in the LinkTech reference manuscript. Candidate
content, all drawn from documented development history: the unavailability of
real IPTR records in machine-readable form and the consequent reliance on
synthetic data during pipeline development; the constraint of encrypting
patient fields while preserving the ability to query and report; the cold-start
latency of the independently hosted predictive service; and the requirement to
support clinic operation during periods of unreliable network connectivity.]`

---
---

# **Chapter 5** **SUMMARY, CONCLUSIONS, AND RECOMMENDATIONS**

This chapter presents the summary of the study, the conclusions drawn from the
findings presented in Chapter 4, and the recommendations directed to the
stakeholders identified in the significance of the study. The summary restates
what was accomplished for each specific objective, the conclusions state the
inferences drawn from those accomplishments, and the recommendations identify the
actions proposed to each group of intended beneficiaries.

---

## **Summary**

This study designed, developed, and evaluated Floral, a Dental Health Record
Management System with Predictive Analytics for the three school dental clinics
of Barangay Tanyag, Taguig City — Bagong Tanyag Integrated School, Bagong Tanyag
Elementary School Annex A, and South Daang Hari Elementary School Main. The study
responded to the condition in which approximately 8,000 student dental records
were maintained on paper by a single dentist and a single dental aide, a
condition that limited the clinics' capacity to retrieve records reliably, to
monitor compliance with the twice-yearly preventive care mandate, and to produce
required reports without extensive manual compilation. The system was developed
using the Agile methodology across iterative sprints, implemented on the MERN
stack with a Python-based predictive analytics service, and evaluated using the
ISO/IEC 25010:2023 standard on software product quality.

**On the first objective**, the study developed a system that consolidates the
management of student dental health information. Personal details, medical
history, dietary habits, social history, dental health conditions, treatment
records, dental charts, and appointment data were unified into a single digital
Individual Patient Treatment Record per student, replacing the separate paper
forms previously maintained at each clinic. The system computes DMF and dmf
indices automatically from recorded tooth conditions, and provides three paths
for migrating existing records — direct encoding, optical character recognition
of paper IPTR forms, and bulk file import — with sensitive identifying fields
encrypted before storage.

**On the second objective**, the study developed appointment scheduling and
monitoring, treatment record management, Routine Preventive Care tracking, an
audit trail, and centralized cross-school storage. Appointments carry status and
follow-up flags; the Routine Preventive Care module tracks the mandated two-visit
process per student and reports completion status; the audit trail records every
addition, modification, and archival across all three sites together with the
acting user and timestamp; and no record is ever permanently deleted, all
withdrawals being implemented as reversible archival visible only to the System
Administrator. Access is governed by five roles verified on every application
programming interface request.

**On the third objective**, the study integrated a predictive analytics module
that classifies students into High, Medium, and Low dental health risk. Five
classification algorithms — Logistic Regression, Decision Tree, Random Forest,
Support Vector Machine, and XGBoost — were trained and compared using both a
stratified 80/20 train–test split and Stratified K-Fold cross-validation with
k = 5, with macro-averaged F1 as the primary selection metric. `[PENDING: state
the selected algorithm and its K-Fold F1 once the experiments are re-run on real
data.]` The module presents each prediction with its contributing factors and a
corresponding treatment recommendation to the dentist for explicit validation,
and records in the audit trail whether the recommendation was accepted unchanged
or amended.

**On the fourth objective**, the study generated role-specific dashboards
presenting student dental health indicators, risk distribution, preventive care
progress, and follow-up requirements, together with reports structured according
to existing DOH formats — including the School Oral Health Status and Service
Report and the Consolidated Report for the City Health Office — with counts by
age bracket and sex, exportable in spreadsheet and printable formats. Filtering
and search were implemented across all record lists.

**On the fifth objective**, the system was evaluated by thirty respondents
composed of dentists, dental aides, school clinic staff, school administrators,
and IT evaluators, using a researcher-developed questionnaire based on the
ISO/IEC 25010:2023 quality characteristics with a five-point Likert scale
analyzed by weighted mean. `[PENDING: state the grand weighted mean, its verbal
interpretation, and the highest- and lowest-rated characteristics once the
evaluation is conducted.]`

---

## **Conclusions**

Based on the findings of the study, the researchers conclude the following:

1. **The system successfully improved the management of student dental health
   information at the Barangay Tanyag school dental clinics.** Consolidating
   personal details, medical history, dietary habits, social history, dental
   health conditions, treatment records, dental charts, and appointment data into
   a single digital record per student demonstrated that the fragmentation
   inherent to separate paper forms can be resolved without altering the clinical
   information the DOH form requires. The automatic computation of DMF and dmf
   indices from recorded tooth conditions further demonstrated that a recognized
   source of manual arithmetic error can be removed entirely rather than merely
   reduced.

2. **The system successfully enabled appointment scheduling and monitoring,
   treatment and preventive care recording, audit logging, and centralized
   cross-school storage.** The Routine Preventive Care module demonstrated that
   compliance with the mandated two-visit process can be determined at any time
   for any student, a determination that previously required manual
   cross-checking of paper tally forms. The combination of an exhaustive audit
   trail, role-based access verified on every request, and the prohibition of
   permanent deletion established that accountability and reversibility can be
   maintained concurrently in a clinical record system.

3. **The system successfully integrated a predictive analytics module that
   classifies dental health risk and generates treatment recommendations as
   decision support.** The comparison of five algorithms under two evaluation
   methods demonstrated that algorithm selection for this problem can be
   conducted on an empirical rather than assumed basis, and the close agreement
   between holdout and cross-validation results indicated stable models rather
   than models fitted to a fortunate data split. `[PENDING: cite the selected
   algorithm and its K-Fold F1.]` The requirement that every prediction be
   explicitly validated by the dentist before it affects a clinical record, and
   that the validation outcome be recorded, established that predictive analytics
   can be introduced into a clinical workflow as genuine decision support without
   displacing professional judgment.

4. **The system successfully generated dashboards, DOH-aligned reports, and
   filterable and searchable records that support monitoring and follow-up
   management.** Producing reports in the age-bracket and sex categories already
   used by the clinic's existing reporting forms demonstrated that automated
   report generation can eliminate manual compilation without requiring the
   receiving offices to change the formats they accept. Role-specific dashboard
   views further demonstrated that institutional oversight can be supported
   without granting access to individual clinical records.

5. **The system was evaluated as acceptable in software product quality across
   the six ISO/IEC 25010:2023 characteristics assessed.** `[PENDING: state the
   grand weighted mean and its verbal interpretation, and conclude what the
   result indicates regarding the system's readiness for operational use in the
   three covered school dental clinics.]`

---

## **Limitations of the Study**

The conclusions stated above are bounded by the conditions under which the system
was developed and evaluated. The researchers identify the following limitations,
which qualify the extent to which the findings may be generalized and which
should be considered in any subsequent use or extension of the system.

**Size and composition of the training sample.** The dental records maintained at
the three covered school dental clinics exist only as accomplished paper
Individual Patient Treatment Record forms. No machine-readable historical dataset
was available at any point in the study, and the training data therefore had to
be encoded by hand from those forms. The predictive component was consequently
developed and evaluated on 50 `[PENDING: confirm the number actually encoded; 50
was the planned figure]` records rather than on the full population of
approximately 8,000 student records. At this magnitude the predictive component constitutes a pilot
demonstration of the analytics pipeline rather than a definitive comparison of
classification algorithms. The results reported in Section 4.3 are accordingly
presented with per-class support counts, and the study does not claim that any
one of the five algorithms is superior for this problem in general; the selection
reported in Section 4.3.3 is the selection appropriate to this sample. The number
of input features was likewise constrained deliberately, since a feature count
approaching the record count would permit the ensemble methods to report
optimistic scores that would not hold on unseen data.

**Class distribution.** Because the sample was drawn from records of children
presenting at school dental clinics, the risk categories are not represented in
equal numbers. Metrics computed over an imbalanced sample are sensitive to the
distribution of the underlying classes, which is the reason stratified K-Fold
cross-validation was adopted as the primary evaluation procedure and F1 as the
priority metric. The limitation is not removed by that choice, only accounted
for.

**Single-site scope and single-annotator labels.** The records used were drawn
from three schools within one barangay of one city, served by a single dentist
and a single dental aide. The findings describe the performance of the system in
that setting and are not presented as generalizable to school dental services in
other localities, whose patient populations, recording practices, and staffing
ratios may differ. Furthermore, every risk label used in training reflects the
clinical judgment of one dentist. No second clinician independently labeled the
same records, so inter-rater reliability was not established, and any systematic
tendency in that clinician's assessments is reproduced by the trained model.

**Absence of prospective and longitudinal validation.** The predictive component
was trained and evaluated on records of encounters that had already occurred. Its
performance on students not represented in the sample was not measured
prospectively over a subsequent clinic cycle. The study likewise measured the
system's software product quality and its capacity to produce required outputs;
it did not measure clinical outcomes. No claim is therefore made that use of the
system reduces caries incidence, improves preventive care compliance, or alters
treatment outcomes, as establishing any such effect would require observation
over a period substantially longer than that available to the study.

**Composition of the evaluation respondents.** The ISO/IEC 25010:2023 evaluation
reported in Section 4.5 was completed by `[PENDING: confirm the final respondent
count; 30 was the planned figure]` respondents selected purposively as actual and
intended users of the system rather than by random sampling from a larger
population. The results express the assessed quality of the system as perceived
by the personnel who operate it in the three covered clinics, and are not offered
as a generalized usability finding. The instrument is self-reported, and
performance efficiency in particular reflects respondents' experience of the
system on the devices and connections available to them rather than
instrumented measurement.

**Deliberate exclusions from scope.** The following were excluded by design and
are not deficiencies of the implementation: the system is a web application
installable as a Progressive Web App and is not a native mobile application; it
operates as a standalone platform and does not integrate with any national
Department of Health database; it does not perform computer-vision detection of
caries from images; it does not employ biometric authentication; and it does not
provide tele-dentistry facilities. Each was outside the scope defined in Chapter
1 and none was attempted.

**Standing of the predictive output.** The risk classification produced by the
system is decision support and not a diagnosis. The system requires the
validation of the dentist before any recommendation informs clinical action, and
that constraint is enforced in the software rather than left to policy. No
conclusion of this study should be read as indicating that the predictive
component is capable of replacing, or of being relied upon in the absence of,
the clinical judgment of a licensed dentist.

**Operating conditions of the deployment.** The system was deployed on
no-cost hosting tiers appropriate to a study of this scale. The independently
hosted predictive service suspends after a period of inactivity, so the first
prediction requested after an idle interval is subject to a start-up delay not
present in subsequent requests. The offline facility queues work created while
connectivity is unavailable and synchronizes it when connectivity is restored;
it does not make the entire record set available for offline reading. These are
properties of the deployment used for the study rather than of the system design,
and both are addressed by the provisioning recommended below.

---

## **Recommendations**

Based on the conclusions of the study, the researchers offer the following
recommendations to the stakeholders identified in the significance of the study.

**To the Dentists.** It is recommended that the dentists assigned to the three
covered school dental clinics adopt the system as the primary record of student
dental health, and that they consistently exercise the validation step on every
predictive analytics result rather than accepting recommendations by default. The
value of the audit record distinguishing accepted from amended recommendations
depends on that step being performed deliberately. It is further recommended that
dentists document instances in which the predicted risk classification diverged
from clinical assessment, as this record will inform subsequent retraining of the
model.

**To the Dental Aides.** It is recommended that the dental aides use the bulk
import and optical character recognition facilities to complete the migration of
existing paper records, prioritizing students with active treatment histories. It
is also recommended that they maintain the Routine Preventive Care records
promptly after each visit, since the completion tracking that addresses the
twice-yearly mandate is only as current as the entries supporting it.

**To the Students.** It is recommended that students and their guardians be
informed that dental records are now maintained digitally and that this supports
continuity of care across grade levels and between the covered schools, so that
consent for dental services continues to be given on an informed basis.

**To the School Dental Clinics.** It is recommended that the three covered
clinics adopt the system institutionally rather than at the discretion of
individual personnel, and that the transition period during which both paper and
digital records are maintained be kept as short as practicable, since parallel
record-keeping reintroduces the fragmentation the system was developed to
resolve. It is further recommended that a designated staff member be assigned the
System Administrator role and be responsible for account provisioning and the
periodic review of archived records.

**To the School Administrators.** It is recommended that the school
administrators of Bagong Tanyag Integrated School, Bagong Tanyag Elementary
School Annex A, and South Daang Hari Elementary School Main use the school-level
dashboards and automated reports in their regular institutional reporting, and
that they refer to the preventive care completion indicators when planning the
scheduling of dental services within the school calendar.

**To the Barangay Health Center.** It is recommended that the Barangay Tanyag
Health Center consider adopting the system for its own dental services, given
that it follows the same clinical processes, record-keeping practices, and
reporting requirements as the school dental clinics. The principal adjustment
required would be the accommodation of the different age range served, as the
health center attends to infants and adolescents rather than school-age students
exclusively.

**To the City Health Office.** It is recommended that the City Health Office of
Taguig City accept the system's Consolidated Report as a submission format, given
that it is generated in the structure of the existing Dental Health Program
Reporting Form. It is further recommended that the office consider the
consolidated dental health data across the three covered schools in the
allocation of dental resources and personnel deployment within the district.

**To the Community and Public Health.** It is recommended that this study be
considered as a reference model for other barangay-level school dental programs,
particularly by demonstrating that centralized digital record management and
predictive decision support are attainable within the personnel and resource
constraints typical of barangay-level clinics.

**To the Researchers.** It is recommended that the researchers complete the
retraining of the predictive model on the full body of real IPTR records once
these are encoded, and that they re-execute the algorithm comparison in full
rather than assuming that the algorithm selected on the development dataset
remains the strongest choice.

**To Future Researchers.** It is recommended that future researchers pursue the
following: a longitudinal study measuring whether the risk classifications
produced by the system correspond to dental health outcomes observed over
subsequent years; the evaluation of additional or alternative classification
algorithms as the volume of accumulated records grows; the extension of the
system to accommodate age groups and clinical scopes outside the school dental
setting; and the investigation of features excluded from the present scope,
including computer vision–based caries detection and integration with national
health information systems, both of which fall outside the limitations
established in this study.

---

## Figure Capture Status (2026-07-28)

18 figures captured from the live deployment at 1440×900, 2× scale, into
`docs/figures/`. Reproduce with `node capture_figures.mjs` from
`dental-4-12-main/project/` (plus `capture_ml_figures.mjs` and
`capture_export.mjs`). Credentials are read from `.env`; nothing is printed.

**Three things the capture run corrected in this draft:**

1. **Medical history and oral conditions are ONE screen, not two.** The record's
   first tab is literally "History & Oral" and contains medical history, dietary
   and social habits, and oral health conditions together. The original 4.1.2 /
   4.1.3 split described a UI that does not exist; they are now one figure.
2. **The record has more tabs than the draft assumed** — Consent, Treatment
   History, DMFT History, Referrals, and Risk Classification. Consent, Treatment
   History and DMFT History are now Figure 4.1.3; Referrals and Risk
   Classification still need placing in Sections 4.2 and 4.3.
3. **The predictive figures needed a second run.** The first attempt caught the
   Render ML service asleep, producing an amber "prediction service isn't
   responding" banner over an empty panel. Wake the service before capturing:
   `curl https://floral-ml-service.onrender.com/health`.

**Two honesty issues visible IN the captured images — decide before submitting:**

- **The synthetic-data banner is in shot.** `fig-4.3.5-dentist-validation.png`
  clearly shows: *"The current model (Logistic Regression) was trained on
  synthetic placeholder data — predictions are for demonstration and pipeline
  testing only until it is retrained on real IPTR records."* This is the app
  being honest and it is correct behaviour, but it means the figure openly
  declares the Section 4.3 limitation. Either keep it (and let the text own the
  limitation) or re-capture after the real-data retrain. Do NOT edit the banner
  out of the image.
- **The figures show demo data, not production scale.** The live database holds
  roughly six seeded students, so counts read 0 High / 2 Medium / 3 Low and the
  Treatment Summary totals are zero. Chapter 1 describes ~8,000 student records.
  A panel will notice. Either state in the figure captions that these are
  demonstration records, or re-capture after real records are encoded.

**Still to capture by hand:** the OCR scan module (Figure 4.1.5) — it opens from
inside the student-creation flow and needs a sample IPTR form image to show a
real extraction.

---

## Drafting Notes (delete before submission)

**Immediately actionable now:**
- Capture Figure 4.1.5 (OCR) by hand; all other figures are captured.
- Place the Referrals and Risk Classification record tabs into Sections 4.2/4.3.
- Confirm figure and table numbering continues correctly from Chapter 3, which
  ends at Table 3.4 and Figure 3.9. This draft begins at Table 4.1 and uses a
  section-based figure scheme (Figure 4.1.1, 4.2.1, …) matching the reference
  manuscripts.
- Decide whether to retain Section 4.6 (Challenges Encountered) — it appears in
  the LinkTech reference but not in all three.
- **Keep Section 4.6 and Chapter 5's Limitations of the Study distinct if both
  are retained** (Limitations written 2026-09-01). They overlap in subject
  matter but answer different questions: 4.6 recounts obstacles met during
  development and how they were handled, while Limitations states the boundaries
  on what the findings may claim. The paper-only source records appear in both
  for that reason — as an obstacle in 4.6, as a constraint on generalizability in
  Chapter 5. Do not merge them, and do not delete one as redundant.

**Blocked until real data is available:**
- All of Section 4.3's quantitative content — re-run Sprints 21a–21d against the
  real IPTR records, then regenerate Tables 4.1–4.4 and Figures 4.3.1–4.3.3 from
  `docs/algo-results.md` and `docs/model-selection-rationale.md`.
- The `[PENDING]` clauses in Chapter 5's Summary item 3 and Conclusion 3.
- The record count in Chapter 5's Limitations, first paragraph, now reads 50
  (decided 2026-09-01). Confirm it against the number actually encoded before
  submission — do not assert 50 if the dentist reached 47. Everything else in
  that paragraph holds anywhere in the pilot range and needs no rewriting.
- Chapter 3 must state the sample selection method: stratified on risk level
  only, with school and grade recorded as descriptive characteristics rather
  than strata (a three-way stratification is not achievable at n=50).

**Blocked until the evaluation is conducted:**
- All of Section 4.5 — administer the ISO/IEC 25010:2023 questionnaire to the 30
  respondents, compute weighted means, and populate Tables 4.6–4.12.
- The `[PENDING]` clauses in Chapter 5's Summary item 5 and Conclusion 5.
- The respondent count in Chapter 5's Limitations ("Composition of the evaluation
  respondents"). It says 30 was the planned figure; replace with the number
  actually achieved rather than asserting 30.
- Note that Chapter 3 also commits to a pilot test with a Cronbach's Alpha
  reliability assessment of the instrument prior to the formal evaluation; if
  conducted, its result belongs in Section 4.5 before the characteristic tables.

**Verify against the paper form:**
- The DOH form's spellings ("Transfussion", "Scalling", "Flouride") remain
  unverified against the physical document; confirm before any appears in the
  manuscript.
