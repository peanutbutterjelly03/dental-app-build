# FLORAL: A Dental Health Record Management System with Predictive Analytics

**Barangay Tanyag School Dental Clinics — Taguig City**

---

**JOSÉ RIZAL UNIVERSITY**
College of Computer Studies and Engineering
Bachelor of Science in Information Technology
2nd Semester, SY 2025–2026

**Group 404**

| Name | Role |
|------|------|
| Alondres, Jerald T. | Developer |
| Arcaina, Annika July J. | Developer |
| Bartolome, Beatrice Matilda D. | Developer |
| Pagayunan, Maria Catlyn T. | Developer |

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Objectives](#2-objectives)
3. [Scope and Limitations](#3-scope-and-limitations)
4. [System Architecture](#4-system-architecture)
5. [Technology Stack](#5-technology-stack)
6. [User Roles and Permissions](#6-user-roles-and-permissions)
7. [Core Features and Modules](#7-core-features-and-modules)
8. [System Design](#8-system-design)
9. [Project Structure](#9-project-structure)
10. [Setup and Installation](#10-setup-and-installation)
11. [Deployment](#11-deployment)
12. [Testing and Quality Assurance](#12-testing-and-quality-assurance)
13. [Known Issues and Limitations](#13-known-issues-and-limitations)
14. [Attributions](#14-attributions)

---

## 1. Project Overview

**FLORAL** (Dental Health Record Management System with Predictive Analytics) is a web-based application developed as a capstone project for the school dental clinics of Barangay Tanyag, Taguig City. The system addresses the persistent challenge of manual, paper-based record management in school dental clinics by providing a centralized digital platform for patient record management, appointment scheduling, dental charting, routine preventive care monitoring, predictive risk analytics, and automated reporting.

The three covered schools are:
- **Bagong Tanyag Integrated School** (main clinic; Kinder–Grade 10)
- **South Daang Hari Elementary School** (Kinder–Grade 6)
- **Bagong Tanyag Elementary School Annex A** (Kinder–Grade 6)

The clinic serves approximately **8,000 students** across the three schools with only one dentist and one dental aide working on rotation, making digital tools essential for efficient service delivery.

---

## 2. Objectives

### General Objective

To design, develop, and evaluate FLORAL, a Dental Health Record Management System that centralizes student dental and treatment records across schools, enhances appointment management, and supports data-driven decision-making through automated reporting in Barangay Tanyag, Taguig City, with integrated predictive analytics to identify potential dental health risks and facilitate preventive dental care planning among students.

### Specific Objectives

1. Develop a system that manages student dental health information including personal details, medical history, dietary habits, social history, dental health conditions, treatment records, dental charts, and appointment data.
2. Design and develop appointment scheduling and monitoring, recording and updating of individual patient treatment records, routine preventive care (RPC) records, audit trails, and centralized storage of student dental records across schools.
3. Integrate a predictive analytics module to analyze historical dental records, identify potential dental health conditions, provide treatment recommendations, and risk classification through risk stratification.
4. Generate dashboards providing an overview of student dental health, reports summarizing treatment history and appointment data, and filterable/searchable dental records.
5. Evaluate the system using **ISO 25010:2023** in terms of: Functional Suitability, Performance Efficiency, Compatibility, Usability, Reliability, and Security.

---

## 3. Scope and Limitations

### Scope

- Role-based access control for Dentist, Dental Aide, School Admin, Barangay Health Office, and System Admin
- Appointment scheduling and monitoring
- Recording and updating of Individual Patient Treatment Records (IPTR)
- Routine Preventive Care (RPC) tracking (two-visit preventive care per student per year)
- Predictive analytics module for oral health risk classification (High / Medium / Low)
- Treatment recommendations as a decision-support tool for the dentist
- DOH-compliant consolidated report generation
- Audit trail for all user actions
- Centralized storage of student dental records across the three covered schools
- Multi-year dental chart with DMFT progression tracking
- Filipino-language consent forms aligned with RA 10173 (Data Privacy Act)

### Limitations

- Web application only; no native mobile application
- Predictive analytics functions as a clinical decision-support tool only — does not replace the professional judgment of the dentist
- Standalone platform with no integration to national government databases
- No computer vision–based caries detection, biometric authentication, or tele-dentistry
- Accuracy of the predictive module depends on completeness and correctness of historical data
- No SMS notifications — transactional email only (Brevo), used for password reset and 2FA
- Browser Print of the 77-column DOH report is cropped; PDF and Excel export are the supported paths

---

## 4. System Architecture

Three tiers: a React PWA, an Express/MongoDB backend, and a separate Python ML service.

```
Browser (React PWA)
    │  React Router v7 (role-protected routes) · AuthContext · Tailwind v4 + Radix
    │  Service Worker + IndexedDB — offline queue, FIFO sync
    │
    │  fetch('/api/…')   JWT in an httpOnly cookie
    ▼
Express (MVC)  —  Vercel serverless function via api/index.ts
    │  middleware (requireAuth, requireRole) → routes → controllers → Mongoose models
    │  audit trail written on every data change; sensitive fields encrypted at rest
    ▼
MongoDB Atlas
    │
    └── Express is the ONLY caller of ▶ Python ML service (FastAPI, Render)
                                        predictor.py → active/model.pkl
```

Full folder map, request flow, and the complete API surface:
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

### Data Flow (Input–Process–Output)

| Phase | Description |
|-------|-------------|
| **Input** | Student personal data, IPTR (medical history, dental chart, treatment records), appointment data |
| **Process** | Role-based auth, dental record management, appointment scheduling, DMFT calculation, RPC tracking, predictive risk scoring (15+ factors), report aggregation |
| **Output** | Centralized student records, interactive dental charts, RPC completion logs, risk classification labels, treatment recommendations, appointment summaries, DOH consolidated reports, health dashboards |

---

## 5. Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 18.3.1 | UI framework |
| **TypeScript** | ~5.5 | Type-safe development |
| **Vite** | 6.3.5 | Build tool and dev server |
| **React Router** | 7.13.0 | Client-side routing (Data mode) |
| **Tailwind CSS** | 4.1.12 | Utility-first styling |
| **shadcn/ui (Radix UI)** | Various | Accessible UI component primitives |
| **Lucide React** | 0.487.0 | Icon library |
| **Recharts** | 2.15.2 | Data visualization (charts) |
| **React Hook Form** | 7.55.0 | Form state management |
| **date-fns** | 3.6.0 | Date utilities |
| **React Day Picker** | 8.10.1 | Calendar component |
| **motion** | 12.23.24 | Animation |
| **sonner** | 2.0.3 | Toast notifications |
| **vite-plugin-pwa / Workbox** | 1.2.0 | PWA install, service worker, offline caching |
| **Tesseract.js** | 7.x | OCR of paper DOH IPTR forms |
| **exceljs · jsPDF · html2canvas-pro** | — | Excel and PDF report export |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 24 | Runtime |
| **Express** | 4.22.2 | HTTP server, MVC structure |
| **Mongoose** | 8.24.1 | MongoDB ODM, schema validation |
| **jsonwebtoken** | 9.0.2 | JWT auth (access + refresh, httpOnly cookies) |
| **bcryptjs** | 2.4.3 | Password hashing |
| **mongoose-field-encryption** | 7.0.1 | AES-256-CBC encryption of sensitive patient fields |
| **helmet · express-rate-limit** | 8.x | Security headers, brute-force protection on auth |
| **Brevo** (HTTP API) | — | Transactional email: password reset, 2FA codes |

### Database

| Technology | Purpose |
|------------|---------|
| **MongoDB Atlas (M0)** | Cloud database, 17 collections — see [`../docs/DATA-MODEL.md`](../docs/DATA-MODEL.md) |

### Machine Learning

| Technology | Purpose |
|------------|---------|
| **Python + FastAPI** | ML service, hosted on Render |
| **scikit-learn · pandas · numpy · XGBoost** | Five algorithms compared: Logistic Regression, Decision Tree, Random Forest, SVM, XGBoost |

### Build & Deployment

| Tool | Purpose |
|------|---------|
| **Vite** | Bundler / dev server |
| **Vercel** | Hosting and continuous deployment |
| **TypeScript** | Static type checking (0 errors at build time) |

### Design System

| Color | Hex | Usage |
|-------|-----|-------|
| Alert Red | `#DC2626` | Critical alerts, high-risk badges — **the only red in the system** |
| Primary Blue | `#1E40AF` | Navigation, primary buttons, active states |
| Watch Amber | `#B45309` | Warnings, medium risk, pending / deadline approaching |
| Fit Green | `#15803D` | Success, low risk, orally fit status |

Authoritative source: [`../DESIGN.md`](../DESIGN.md). Colors are consumed as design
tokens (`theme.css`), never as literal hex values in components.

---

## 6. User Roles and Permissions

| Role | Access |
|------|--------|
| **Dentist** | Full access: patients, dental charts, appointments, AI analytics, RPC, follow-ups, reports |
| **Dental Aide** | Patients, dental charts, appointments, RPC, follow-up alerts |
| **School Admin** | Appointments and reports for their school only |
| **Barangay Health Office** | Aggregate reports and statistics (no individual patient access) |
| **System Admin** | Account management and audit trail only (no clinical data) |

### Demo accounts

Demo logins are `admin`, `dentist`, `aide`, `schooladmin`, and `bho` at **`@floral.com`**.
Passwords have been rotated and live only in `.env` (`SEED_*`) — they are deliberately not
documented here. Accounts are created by `npm run seed:admin` / `seed:demo`.

---

## 7. Core Features and Modules

### 7.1 Login (`/login`)

- Email and password authentication (bcrypt; JWT access + refresh in httpOnly cookies)
- Optional two-factor authentication via emailed one-time code
- Forgot-password / reset flow by emailed link
- Rate limiting on login, OTP, and reset endpoints
- Role auto-detection and route redirection
- FLORAL branding and logo
- Fully mobile responsive

---

### 7.2 Dashboard (`/`)

Role-specific dashboards with KPI cards and Recharts visualizations:

**Dentist Dashboard:**
- KPI cards: Total Patients, Today's Appointments, High-Risk Count, RPC Completion Rate
- Donut chart: Risk distribution (High / Medium / Low)
- Line chart: Oral health trend over 6 months (Decayed / Treated / Orally Fit)
- Today's appointment list + Quick action buttons

**Dental Aide Dashboard:**
- Appointments today, pending charts, follow-ups due, RPC pending
- Appointment status bar chart

**School Admin Dashboard:**
- School-specific statistics
- Screening coverage ring chart, oral health status breakdown

**Barangay Health Office Dashboard:**
- Program coverage metrics, multi-school comparison, orally fit trend line

**System Admin Dashboard:**
- Active users, login activity chart, recent audit feed

---

### 7.3 Patient Records (`/patients`, `/patients/:id`)

**Patient List:**
- Search and filter by school, grade, oral condition, risk level
- Add new patient with form fields: personal info, PhilHealth number, PhilHealth status, 4Ps checkbox and ID, consent status
- Bulk CSV upload (3-step: Upload → Preview → Done)
- Mobile-responsive table / card view

**Patient Profile:**
- Student information card (personal details, risk badge)
- **Medical History tab** — 12 fields covering systemic conditions
- **Treatment History tab** — table of past visits (date, chief complaint, diagnosis, treatment, dentist, remarks) with mobile card fallback
- **Dental Records tab** — DMFT by year table, color-coded by D/M/F/X columns, oral status badge per year, KPI cards, "Open IPTR" link

---

### 7.4 Digital Dental Charts — IPTR (`/dental-charts`, `/dental-charts/:id`)

Implements the DOH **Individual Patient Treatment Record (IPTR)** standard:

**Tab 1 — Medical & Social History:**
- Medical History: 12 fields (systemic conditions)
- Dietary/Social History: 7 fields (sugar intake, tobacco, betel nut, etc.)
- Oral Health Condition: 10 fields
- All fields organized per school-year column

**Tab 2 — Dental Charting:**
- Full FDI odontogram (permanent + primary dentition)
- Base44 DOH dental condition codes:
  - ✓ = Sound/Sealed, D/d = Decayed, M/m = Missing, F/f = Filled, X/x = DX Extracted, and more
- DMFT auto-calculation (d, m, f, x, t for primary; D, M, F, X, T for permanent)
- DMFT displayed as 5-value box sets
- Color-coded tooth conditions with swatched legend
- Multi-year support — year tabs at top, DMFT progression table
- Code-first selection: select a code then click teeth to apply
- Selected tooth highlight (teal ring)
- Treatment codes displayed as full-width rows

**Tab 3 — Consent & Appointments:**
- Filipino-language consent text
- RA 10173 Data Privacy Act notice in Filipino
- Consent checkboxes
- Appointment list for the student

**Navigation:**
- Prev/Next patient navigation in the IPTR header
- Current position indicator (e.g., "2/10")
- Year navigation (chevron left/right)

---

### 7.5 Appointments (`/appointments`)

- **Tabs:** Today / Upcoming / Past / Calendar / Rotation
- Mark attended (✓) or missed (✗), with reset
- Calendar view (React Day Picker)
- Dentist rotation schedule — Set Rotation modal, per-school cards in Rotation tab
- Appointment cards include a link to dental charts (FileText icon)

---

### 7.6 RPC Tracking (`/rpc`)

- Monitors the DOH-mandated two-visit Routine Preventive Care per student per year
- Services tracked: oral screening, caries risk assessment, dental hygiene instruction, oral prophylaxis, fluoride varnish, pit and fissure sealant, silver diamine fluoride
- Filterable by school and grade
- Completion status indicators

---

### 7.7 AI Analytics / Risk Classification (`/ai-analytics`)

**Risk Scoring Algorithm (15+ factors):**

| Factor | Score |
|--------|-------|
| DMFT ≥ 4 | +3 |
| D (decayed) ≥ 3 | +3 |
| DMFT increased vs. prior year | +3 |
| DX (extracted) teeth | +3 |
| No clinic visits / last visit > 12 months | +2 |
| Recurring gingivitis | +2 |
| Recurring debris/plaque | +2 |
| Sugar intake risk | +2 |
| Tobacco use | +2 |
| Betel nut use | +2 |
| Diabetes present | +2 |
| No preventive treatment | +2 |
| 4Ps beneficiary | +1 |
| Thumbsucking habit | +1 |

**Risk Levels:**
- 🔴 **High** — score ≥ 6
- 🟡 **Medium** — score ≥ 3
- 🟢 **Low** — score < 3

**Features:**
- "Update Risk Scores" button re-runs algorithm on all students
- **Risk Assessment sub-tab** — ranked list with color-coded risk badges, validate button per row
- **Treatment Pending sub-tab** — grouped by Grade → Section, shows predicted issue, recommended action, and risk factor badges

---

### 7.8 Follow-Up Alerts (`/follow-up`)

- Lists students with overdue fluoride treatments
- Lists students with missed appointments
- SMS notification button per student (UI; requires backend for actual sending)
- Bulk SMS option

---

### 7.9 Reports (`/reports`)

**DOH Consolidated Report:**
- Exact official format with age brackets per grade:
  - Kinder: 4 and below / 5–9
  - Grade 1: 4 and below / 5–9 / 10–14 / 15–19
  - Grades 2–6: 5–9 / 10–14 / 15–19 / 20+
- Summary columns spanning all age brackets
- Blank cells when zero (no "0" displayed)
- Sticky grade labels on horizontal scroll
- Row hover highlighting (yellow tint)

**Internal Reports:**
- Monthly procedure volume bar chart (Recharts)
- Consent compliance progress bars per school (Complete / Pending / Missing totals)
- Quick stats grid
- Referral tracking table
- Export as PDF and Excel

---

### 7.10 Account Management (`/accounts`) — System Admin Only

- User accounts table with role, status, school
- Create new account form
- Deactivate / reactivate user accounts

---

### 7.11 Audit Trail (`/audit`) — System Admin Only

- Chronological log of all user actions (adds, edits, deletions)
- Filters: user, date range, module
- Supports compliance with RA 10173 Data Privacy Act

---

## 8. System Design

### Routing Structure

```
/login                → Login (public)
/                     → Dashboard (role-based)
/patients             → Patient List
/patients/:id         → Patient Profile
/dental-charts        → Dental Chart List
/dental-charts/:id    → Individual IPTR (Dental Chart)
/appointments         → Appointments
/rpc                  → RPC Tracking
/ai-analytics         → AI Risk Analytics
/follow-up            → Follow-Up Alerts
/reports              → Reports
/accounts             → Account Management (System Admin)
/audit                → Audit Trail (System Admin)
```

### Key Design Decisions

- **School context filtering** — `selectedSchool` from `AuthContext` filters all data in Patient List, RPC Tracking, Appointments, and AI Analytics. Dashboard shows a school banner with a "Switch School" button.
- **Multi-year dental charts** — DMFT data stored per school year; year tabs at top with a progression table; "+ Add Year" button.
- **Filipino consent** — Tab 3 of IPTR is fully in Filipino, including the RA 10173 privacy notice.
- **Print styles** — `src/styles/index.css` includes print-specific CSS that hides navigation and buttons, preserves table colors, and adds page-break utilities.
- **TypeScript strict mode** — Project maintains 0 TypeScript errors at all times.

---

## 9. Project Structure

Summarised below. The authoritative map — including the backend, the ML service, and the
request flow — is [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

```
dental-4-12-main/
├── project/
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/      # screens + UI (Dashboard, DentalChart, PatientList,
│   │   │   │                    #   Reports, Appointments, RPCTracking, AIAnalytics,
│   │   │   │                    #   AccountManagement, AuditTrail, Login, Root, …)
│   │   │   ├── api/             # fetch wrappers calling /api/*
│   │   │   ├── hooks/           # data hooks (useStudents, …)
│   │   │   ├── context/         # auth + school-selection state
│   │   │   ├── offline/         # IndexedDB queue, background sync
│   │   │   ├── utils/           # chartColors.ts, iptrOcr.ts, helpers
│   │   │   ├── App.tsx
│   │   │   └── routes.tsx       # client-side route table
│   │   ├── imports/             # shared re-exports
│   │   ├── styles/              # theme.css design tokens + print styles
│   │   ├── main.tsx             # application entry point
│   │   └── sw.ts                # service worker (PWA / offline)
│   ├── server/                  # Express backend (MVC)
│   │   ├── routes/ controllers/ models/ middleware/ utils/ config/ scripts/
│   ├── api/index.ts             # Vercel serverless entry (re-exports server/app)
│   ├── public/                  # static assets (logo, icons, manifest)
│   ├── vite.config.ts · tsconfig*.json · postcss.config.mjs · vercel.json
│   └── index.html
└── PROJECT_DOCUMENTATION.md     # this file

../ml-service/                   # Python FastAPI ML service (separate deploy target)
    main.py · predictor.py · config.py · algorithms/ · pipeline/ · experiments/ · active/
```

---

## 10. Setup and Installation

### Prerequisites

- **Node.js** v24 (what both dev machines and the Codespace run)
- **npm** — the committed lockfile is `package-lock.json`

### Install Dependencies

```bash
cd project
npm install
```

### Run Development Server

```bash
cd project
npm run dev
```

Open `http://localhost:5173` in your browser.

### Build for Production

```bash
cd project
npm run build
```

The production build output is placed in `project/dist/`.

---

## 11. Deployment

The project is deployed on **Vercel**. `project/vercel.json` configures:
- API rewrite: `/api/*` routes to the serverless handler at `project/api`
- SPA rewrite: all non-API routes fall through to `index.html` for client-side routing

The build command (`npm run build`) and output directory (`project/dist`) are set in the
Vercel project settings rather than in the repository.

---

## 12. Testing and Quality Assurance

### Quality Standard

The system is evaluated against **ISO 25010:2023** across six quality characteristics:

| Characteristic | Description |
|----------------|-------------|
| **Functional Suitability** | All specified features are implemented and correctly perform their intended functions |
| **Performance Efficiency** | Page load times, responsiveness, and rendering efficiency meet acceptable thresholds |
| **Compatibility** | Works correctly across modern browsers (Chrome, Firefox, Edge, Safari) and device sizes |
| **Usability** | Intuitive navigation, clear labels, mobile-responsive layouts, accessible UI components |
| **Reliability** | System behaves consistently under expected operating conditions |
| **Security** | Role-based access control enforced; sensitive data handling aligned with RA 10173 |

### Compliance Summary

| Module | Compliance Status |
|--------|-------------------|
| Login | ✅ Fully Compliant |
| Dashboard (all roles) | ✅ Fully Compliant |
| Patient Records | ✅ Fully Compliant |
| Digital Dental Chart (IPTR) | ✅ Fully Compliant |
| Appointments | ✅ Fully Compliant |
| RPC Tracking | ✅ Fully Compliant |
| Predictive Analytics | ⚠️ Pipeline complete; model trained on synthetic data pending the real-data run |
| Reports (DOH + Internal) | ⚠️ PDF and Excel complete; browser Print of the 77-column DOH table is cropped |
| Account Management | ✅ Fully Compliant |
| Audit Trail | ✅ Fully Compliant |

> The formal ISO 25010:2023 evaluation (30 respondents) has **not** been conducted yet.
> The table above is an internal implementation check, not an evaluation result, and no
> overall compliance score is claimed until the survey is run.

---

## 13. Known Issues and Limitations

| Issue | Priority | Notes |
|-------|----------|-------|
| ML model trained on synthetic data | High | Real dental records exist only on paper; a hand-encoded sample must be captured before the model reflects real cases. The UI shows a synthetic-data banner until then |
| ISO 25010:2023 evaluation not conducted | High | Requires 30 respondents |
| Browser Print of the DOH report is cropped | Medium | 77 columns cannot fit; PDF (zoomable single page) and Excel (real pagination) are the supported paths |
| No SMS notifications | Low | Out of scope — transactional email (Brevo) covers password reset and 2FA |
| iOS evicts PWA storage after ~7 days idle | Low | Platform limitation; affects the IndexedDB offline queue. Standardise clinics on Android + Windows |
| Render free tier sleeps after ~15 min idle | Low | First prediction request takes 30–60s and may 503 once; retry succeeds |

The live backlog is maintained in `HANDOFF.md` (`## Open work`), which supersedes this
table if the two disagree.

---

## 14. Attributions

- **shadcn/ui** — UI component library, used under the [MIT License](https://github.com/shadcn-ui/shadcn-ui/blob/main/LICENSE.md)
- **Unsplash** — Stock photos, used under the [Unsplash License](https://unsplash.com/license)
- **Lucide React** — Icon set, MIT License
- **Recharts** — Charting library, MIT License
- **Radix UI** — Accessible component primitives, MIT License
- **Tailwind CSS** — Utility-first CSS framework, MIT License

---

*Document prepared by Group 404 — BSIT, José Rizal University, 2nd Semester SY 2025–2026*
