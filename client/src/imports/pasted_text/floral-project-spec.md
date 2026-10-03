# FLORAL — Dental Health Record Management System with Predictive Analytics
## Complete Project Specification (Revised for Group 404 Capstone)

> **Revision notes:** School names corrected to match research locale. RPC Tracking module added. Dental condition codes updated to DOH IPTR standard. Medical history fields updated to match actual IPTR form. Dashboard and Report visuals significantly enhanced with charts, KPI rings, sparklines, and data visualizations. PWA removed from out-of-scope list.

---

## Design System

### Color Palette (Barangay Tanyag Logo Colors)
- **Primary Red**: `#E31E24` — Critical alerts, high-risk badges, branding
- **Primary Blue**: `#1E40AF` — Main navigation, primary buttons, active states
- **Yellow**: `#FBBF24` — Warnings, medium-risk badges, highlights
- **Cyan**: `#06B6D4` — Info badges, secondary accents
- **Green**: `#16A34A` — Success, low-risk badges, orally fit status
- **White**: `#FFFFFF` — Backgrounds, cards
- **Gray Scale**: Standard Tailwind grays for text and borders

### Logo
- Use the Barangay Tanyag official logo
- Display prominently in navigation header
- Maintain aspect ratio and quality

### Typography
- Modern, clean sans-serif fonts
- Use Tailwind CSS v4 default typography
- Hierarchical text sizing for headers (h1, h2, h3)
- Consistent font weights for labels and body text

---

## Technical Requirements

### Framework & Libraries
- **React** with TypeScript
- **React Router** (react-router package, NOT react-router-dom) with Data mode pattern
- **Tailwind CSS v4** for styling
- **Lucide React** for icons
- **Recharts** for charts and analytics visualizations
- Fully responsive design (mobile-first approach)

### Routing Structure
```
/login                - Login page (public)
/                     - Dashboard (protected, role-based content)
/patients             - Patient List (Dentist, Dental Aide)
/patients/:id         - Patient Profile (Dentist, Dental Aide)
/dental-charts        - Dental Chart List (Dentist, Dental Aide)
/dental-charts/:id    - Individual Dental Chart (Dentist, Dental Aide)
/appointments         - Appointments (Dentist, Dental Aide, School Admin)
/rpc                  - RPC Tracking (Dentist, Dental Aide)
/ai-analytics         - AI Analytics / Risk Classification (Dentist only)
/follow-up            - Follow-up Alerts (Dentist, Dental Aide)
/reports              - Reports (Dentist, School Admin, Barangay Health)
/accounts             - Account Management (System Admin only)
/audit                - Audit Trail (System Admin only)
```

---

## User Roles & Permissions

### 1. **Dentist**
- Full access to patient management
- Can create, view, edit dental charts
- Schedule and manage appointments
- Access AI analytics, risk classification, and validation
- Manage RPC tracking
- Manage follow-up alerts
- Generate and view reports
- **Dashboard**: Patient stats, appointments today, high-risk count, RPC completion rate, oral health trend chart, risk distribution donut chart

### 2. **Dental Aide**
- View and manage patient records
- Create and update dental charts
- Manage appointments and scheduling
- Track RPC visits
- Access follow-up alerts
- Limited editing capabilities
- **Dashboard**: Appointments today, pending charts, follow-ups due, RPC pending count, appointment status bar chart

### 3. **School Admin**
- View appointments for their school
- Access reports for their school students
- Cannot modify dental records
- **Dashboard**: School-specific statistics, screening coverage ring chart, oral health status breakdown pie chart, upcoming Bayanihan events

### 4. **Barangay Health Office**
- View aggregate reports and statistics
- Monitor program compliance
- Cannot access individual patient details (privacy)
- **Dashboard**: Program coverage metrics, multi-school comparison bar chart, orally fit trend line chart, age group breakdown

### 5. **System Admin**
- Manage user accounts (create, edit, deactivate)
- Access full audit trail
- System configuration
- No access to clinical data
- **Dashboard**: Active users, system uptime, login activity line chart, security alert count, recent audit activity feed

---

## Core Features & Screens

### 1. **Login Page** (`/login`)
- Email and password fields
- Role-based authentication
- "Remember me" option
- Barangay Tanyag logo + FLORAL branding
- Tagline: "Dental Health Record Management System"
- Mobile responsive

**Test Credentials:**
```
Dentist:        dentist@floral.ph  / dentist123
Dental Aide:    aide@floral.ph     / aide123
School Admin:   school@floral.ph   / school123
Barangay Health: barangay@floral.ph / barangay123
System Admin:   admin@floral.ph    / admin123
```

---

### 2. **Dashboard** (`/`)
Role-specific dashboard. Every dashboard uses a combination of:
- **KPI cards** with icon, value, label, and trend indicator (↑ ↓)
- **Recharts visualizations** — never plain text summaries
- **Quick action buttons** for most common next steps
- **Recent activity feed** for audit-trail awareness

#### Dentist Dashboard:
**Top row — 4 KPI cards:**
- Total Patients (blue, user icon, count + "↑ 12 this month")
- Today's Appointments (cyan, calendar icon, count + time of next appointment)
- High-Risk Patients (red, alert icon, count + "Needs validation")
- RPC Completion Rate (green, shield icon, percentage + progress bar inline)

**Middle row — 2 charts side by side:**
- **Left: Donut chart (Recharts PieChart)** — Risk Distribution
  - Red slice = High Risk count
  - Yellow slice = Medium Risk count
  - Green slice = Low Risk count
  - Center label showing total students
  - Legend below: High / Medium / Low with counts

- **Right: Line chart (Recharts LineChart)** — Oral Health Trend (last 6 months)
  - X-axis: months (Jan–Jun)
  - Y-axis: number of students
  - Three lines: Decayed (red), Treated (blue), Orally Fit (green)
  - Dots on data points, tooltip on hover

**Bottom row — 2 sections side by side:**
- **Left: Today's Appointments list** — patient name, time, type badge, status badge (colored pill)
- **Right: Quick actions** — Add Patient (blue button), New Appointment (cyan button), View Analytics (purple button), Generate Report (green button)

---

#### Dental Aide Dashboard:
**Top row — 4 KPI cards:**
- Appointments Today (blue, count)
- Pending Charts (yellow, count + "to complete")
- Follow-ups Due (red, count + "this week")
- RPC Visits Pending (cyan, count)

**Middle row — 2 charts:**
- **Left: Stacked bar chart (Recharts BarChart)** — Appointments by Status this week
  - X-axis: Mon–Sun
  - Bars stacked: Completed (green), Scheduled (blue), Cancelled (red)

- **Right: Horizontal bar chart** — Pending Tasks by Priority
  - High priority (red bar)
  - Medium priority (yellow bar)
  - Low priority (green bar)

**Bottom: Task list** — patient name, task type, due date, action button

---

#### School Admin Dashboard:
**Top row — 4 KPI cards:**
- Students Enrolled (blue, count)
- Students Screened (green, count + percentage)
- Treatments Completed (cyan, count)
- Upcoming Visits (yellow, next date)

**Middle row — 2 charts:**
- **Left: Radial/Ring chart (Recharts RadialBarChart)** — Screening Coverage
  - Single ring showing % of students screened
  - Large percentage number in center
  - School name below center

- **Right: Pie chart (Recharts PieChart)** — Oral Health Status Breakdown
  - Slices: Orally Fit (green), Needs Treatment (red), Under Treatment (blue), Needs Follow-up (yellow)
  - Legend with counts

**Bottom: Upcoming Bayanihan Events card** — event name, date, school, expected students count

---

#### Barangay Health Office Dashboard:
**Top row — 4 KPI cards:**
- Total Students Served (blue, count across all 3 schools)
- Program Coverage % (green, ring progress inline)
- Orally Fit % (cyan, percentage)
- Schools Participating (gray, "3 of 3")

**Middle row — 2 charts:**
- **Left: Grouped bar chart (Recharts BarChart)** — School Comparison
  - X-axis: Bagong Tanyag Integrated, Annex A, South Daang Hari
  - Grouped bars: Screened (blue), Treated (green), High Risk (red)

- **Right: Area chart (Recharts AreaChart)** — Monthly Program Coverage Trend
  - X-axis: Jan–current month
  - Shaded area under line
  - Shows upward trend in coverage

**Bottom: Age group breakdown table** — 0–5, 6–14, 15–19 age brackets with counts and oral health status

---

#### System Admin Dashboard:
**Top row — 4 KPI cards:**
- Active Users (blue, count)
- System Uptime (green, "99.8%")
- Failed Logins Today (red, count + "security alert" if > 5)
- Pending Actions (yellow, count)

**Middle row — 2 charts:**
- **Left: Line chart** — Login Activity (last 7 days)
  - X-axis: days
  - Line: number of logins per day
  - Dot markers, tooltip with user count

- **Right: Horizontal bar chart** — Actions by Module
  - Bars: Patients, Charts, Appointments, Reports, Accounts
  - Shows which modules are most used

**Bottom: Recent audit activity feed** — timestamp, user, action, module, status badge

---

### 3. **Patient List** (`/patients`)
**Access**: Dentist, Dental Aide

Features:
- Searchable table with filters
- Columns: Name, Grade, School, Last Visit, Oral Status, Risk Level, Actions
- **Search bar** — Search by name, student ID
- **Filters**:
  - School dropdown:
    - Bagong Tanyag Integrated School
    - Bagong Tanyag Elementary School Annex A
    - South Daang Hari Elementary School Main
  - Grade level (Grade 1–6, Grade 7–10)
  - Risk level (High, Medium, Low)
  - Oral status (Needs Treatment, Under Treatment, Needs Follow-up, Orally Fit)
- **Add New Patient** button — Opens modal form with:
  - Last Name, First Name, Middle Name
  - Birthdate (date picker)
  - Gender (dropdown: Male, Female)
  - Grade & Section
  - School (dropdown — 3 confirmed schools)
  - Guardian Name & Contact Number
  - Address
  - PhilHealth Number (optional)
  - 4Ps / NHTS (checkbox)
  - Form validation (required fields)
  - Success/error alerts
- **Action buttons per row**:
  - View Profile (eye icon)
  - View Chart (tooth icon)
- Pagination for large datasets
- Export to Excel/PDF option
- Mobile responsive table (cards on mobile)

**Risk Level Badge Colors:**
- High: Red background (`bg-red-100 text-red-800`)
- Medium: Yellow background (`bg-yellow-100 text-yellow-800`)
- Low: Green background (`bg-green-100 text-green-800`)

---

### 4. **Patient Profile** (`/patients/:id`)
**Access**: Dentist, Dental Aide

Displays:
- **Patient Header**:
  - Profile photo placeholder with initials
  - Full name, age, grade, section
  - School name
  - Risk level badge
  - Quick action buttons: Edit Profile, View Chart, Schedule Appointment

- **Personal Information Card**:
  - Birthdate, Gender, Student ID
  - Guardian Name & Contact Number
  - Address
  - PhilHealth Number
  - 4Ps / NHTS status

- **Medical History Card** (from DOH IPTR form — Year-by-year entries):
  - Year recorded
  - Allergies
  - Hypertension / CVA (checkbox)
  - Diabetes Mellitus (checkbox)
  - Blood Disorders (checkbox)
  - Cardiovascular Disease (checkbox)
  - Thyroid Disorders (checkbox)
  - Hepatitis Type
  - Malignancy
  - Previous Hospitalization — Medical
  - Previous Hospitalization — Surgical
  - Blood Transfusion (month/year)
  - Tattoo (checkbox)
  - Others (text)

- **Dietary and Social History Card** (Year-by-year):
  - Sugar-sweetened beverages (checkbox)
  - Alcohol drinker (checkbox)
  - Tobacco user (checkbox)
  - Betel nut chewer (checkbox)
  - Body piercing (checkbox)
  - Nail biting (checkbox)
  - Thumbsucking (checkbox)

- **Oral Health Condition Card** (Year-by-year):
  - Orally Fit (checkbox)
  - Dental Caries (checkbox)
  - Gingivitis (checkbox)
  - Periodontal Disease (checkbox)
  - Debris (checkbox)
  - Calculus (checkbox)
  - Abnormal Growth (checkbox)
  - Cleft Lip/Palate (checkbox)
  - Completely Edentulous (checkbox)
  - Others (text)

- **Treatment History Timeline**:
  - Chronological list of all IPTR visit records
  - Date, vital signs, chief complaint, diagnosis, treatment done, dentist
  - Expandable rows for full details

- **Dental Status Summary with Mini Chart**:
  - DMF/dmf index score (large number)
  - Small donut chart: Decayed (red) / Missing (gray) / Filled (blue) counts
  - Overall oral health status badge
  - Current risk level with confidence score

- **RPC Status Card**:
  - Visit 1 status (Completed / Pending) with date
  - Visit 2 status (Completed / Pending) with date
  - Days until next fluoride application due
  - Progress bar: 0% / 50% / 100% completion

- **Consent Form Status**:
  - Consent given (yes/no badge)
  - Guardian name who signed
  - Date signed

- **Appointments Section**:
  - Upcoming appointments list
  - Past appointments list
  - Schedule new appointment button

---

### 5. **Dental Chart List** (`/dental-charts`)
**Access**: Dentist, Dental Aide

Features:
- List view of all dental charts
- Search by patient name
- Filter by date range, completion status, school
- Columns: Patient Name, School, Chart ID, Date, School Year, DMF Index, Status, Actions
- **Create New Chart** button
- Action buttons: View/Edit, Print, Export PDF
- Mobile responsive

---

### 6. **Dental Chart** (`/dental-charts/:id`)
**Access**: Dentist, Dental Aide

Interactive dental charting using DOH IPTR standard:

#### Layout:
- Patient info header (name, age, grade, date, dentist)
- Interactive tooth diagram (permanent and primary teeth)
- Condition/treatment code selection panel
- Vital signs section (weight, temperature, blood pressure)
- Chief complaint, diagnosis, treatment done, remarks
- Consent checkboxes (patient signed, guardian signed)
- Save/Submit buttons

#### Tooth Diagram (FDI Two-Digit Notation):
- **Permanent teeth**: 11–18, 21–28, 31–38, 41–48 (displayed in uppercase/blue)
- **Primary teeth**: 51–55, 61–65, 71–75, 81–85 (displayed in lowercase/red)
- Click tooth to select and apply condition/treatment code
- Color-coded by condition:
  - **Sound (√)**: White/default
  - **Decayed (D/d)**: Red fill
  - **Missing (M/m)**: Gray with X
  - **Filled (F/f)**: Blue fill
  - **Indicated for Extraction (DX/dx)**: Red border with X
  - **Unerupted (Un/un)**: Light gray outline
  - **Supernumerary (S/s)**: Yellow outline
  - **Jacket Crown (JC/jc)**: Purple fill
  - **Pontic (P/p)**: Cyan fill
- **Permanent teeth** shown in UPPERCASE BLUE
- **Primary teeth** shown in lowercase RED
- Color legend displayed below the odontogram

#### Treatment Codes (from DOH IPTR form):
- **FV** — Fluoride Varnish
- **PFS** — Pit and Fissure Sealant
- **PF** — Permanent Filling
- **TF** — Temporary Filling
- **X** — Extraction
- **SDF** — Silver Diamine Fluoride

#### Vital Signs Section:
- Weight (kg)
- Temperature (°C)
- Blood Pressure (mmHg)

#### Actions:
- Save Draft
- Submit / Complete Chart
- Print Chart (IPTR format)
- Export PDF

Mobile: Scrollable odontogram, larger touch targets

---

### 7. **Appointments** (`/appointments`)
**Access**: Dentist, Dental Aide, School Admin

Features:
- **Calendar View** (default): Month/Week/Day views, color-coded by type
- **List View** toggle: Table with sortable columns
- **Appointment Types**: Initial Screening, Treatment, Follow-up, Emergency, Bayanihan Event
- **Create Appointment** modal with patient search, date/time picker, type, dentist, notes
- **Bayanihan Event Mode**: Bulk scheduling for mass dental missions — select school, grade levels, set date, generate slots, track attendance
- **Status color coding**: Scheduled (Blue), Confirmed (Green), In Progress (Yellow), Completed (Gray), Cancelled (Red), No Show (Orange)
- Filters by date range, type, status, school

Mobile: Day view default, swipe between dates

---

### 8. **RPC Tracking** (`/rpc`)
**Access**: Dentist, Dental Aide

Dedicated module for Routine Preventive Care monitoring:

#### Dashboard Header — 4 KPI cards:
- Total Students Enrolled (count)
- RPC Visit 1 Completed (count + percentage ring)
- RPC Visit 2 Completed (count + percentage ring)
- Fluoride Due This Month (count — red if overdue)

#### Main Content:

**RPC Status Table:**
- Columns: Student Name, School, Grade, Visit 1 Date, Visit 1 Status, Visit 2 Date, Visit 2 Status, Days Until Next Due, Actions
- Color coding:
  - Green row = both visits completed
  - Yellow row = visit 1 done, visit 2 pending
  - Red row = overdue (past 6 months since visit 1)
  - Gray row = not yet started
- Filters: School, Grade, Status (Complete / Pending / Overdue)

**RPC Completion Chart (Recharts BarChart):**
- Grouped bars per school
- Blue bar = Visit 1 Completed
- Green bar = Both Visits Completed
- Red bar = Overdue
- X-axis: 3 school names

**Actions per row:**
- Record Visit 1 (opens modal with date, treatment type, dentist)
- Record Visit 2 (enabled only after Visit 1 is completed)
- View student profile

**RPC Visit Modal:**
- Visit number (1 or 2)
- Visit date (date picker)
- Treatment type (Oral Prophylaxis, Fluoride Varnish, OHI, Screening)
- Completion status (Completed / Missed / Pending)
- Dentist
- Next schedule date (auto-calculated: 4–6 months after Visit 1)
- Notes

Mobile: Card view per student

---

### 9. **AI Analytics / Risk Classification** (`/ai-analytics`)
**Access**: Dentist only

#### Dashboard Header — 4 KPI cards with visual indicators:
- Total Assessed (blue, count + sparkline showing assessments over last 7 days)
- High Risk Students (red, count + percentage of total + upward/downward trend arrow)
- Pending Validation (yellow, count — dentist has not yet validated these predictions)
- Model Accuracy (green, percentage — e.g., "87.3% F1-Score")

#### Section 1 — Risk Classification Results Table:
- Columns: Student Name, School, Grade, Risk Level (colored badge), Confidence Score (%), Recommended Procedure, Prediction Date, Validation Status, Actions
- Validation Status: Pending (yellow), Validated (green), Overridden (gray)
- Actions: Validate (checkmark), Override (edit icon), View Profile

#### Section 2 — Charts (2 columns):

**Left: Donut chart — Risk Distribution**
- Red = High Risk (count + %)
- Yellow = Medium Risk (count + %)
- Green = Low Risk (count + %)
- Total count in center
- Legend below with exact numbers

**Right: Bar chart — Risk by School**
- X-axis: Bagong Tanyag Integrated, Annex A, South Daang Hari
- Grouped bars: High (red), Medium (yellow), Low (green)
- Tooltip on hover showing exact counts

#### Section 3 — ML Model Performance Panel:
- Model name displayed (best performing model)
- Accuracy, Precision, Recall, F1-Score as horizontal progress bars
- AUC-ROC value
- "Models Evaluated: 7" badge with expandable details showing all 7 models compared

#### Section 4 — Oral Health Trends (full width):
**Line chart — Oral Health Trends (last 6 months)**
- X-axis: months
- Three lines: High Risk (red), Medium Risk (yellow), Low Risk (green)
- Area fill under each line (semi-transparent)
- Tooltip showing counts per month

#### Section 5 — Predictive Insights Panel:
- Top risk factors identified (horizontal ranked bar chart)
- Recommended interventions list with priority badges
- Students requiring immediate attention (top 5 list with risk score)

Mobile: Stack all charts vertically

---

### 10. **Follow-up Alerts** (`/follow-up`)
**Access**: Dentist, Dental Aide

**Header — 4 KPI cards:**
- Total Pending (count)
- Overdue (red, count)
- Due This Week (yellow, count)
- Resolved This Month (green, count)

**Alert List:**
- Patient name, alert type badge, due date, priority badge, status badge
- Filter by priority, type, status, school
- Actions: Schedule appointment, Mark contacted, Mark resolved, Add notes
- Bulk actions: Select multiple, bulk SMS, bulk schedule, export

Mobile: Card view with swipe actions

---

### 11. **Reports** (`/reports`)
**Access**: Dentist, School Admin, Barangay Health Office

#### Report Generator Panel (top):
- Report type dropdown
- Date range picker (start/end)
- School filter (All Schools / individual school)
- Grade level filter
- Age bracket filter (0–5, 6–14, 15–19)
- Generate Report button (blue)
- Export buttons: PDF, Excel, CSV

#### Generated Report Display:

**Summary KPI row — 4 cards:**
- Total Students Screened (count)
- Orally Fit (count + %)
- Treatments Completed (count)
- Pending Follow-ups (count)

**Charts section — 3 charts:**

**Chart 1 (full width): Stacked bar chart — Monthly Oral Health Services**
- X-axis: months (Jan–Dec or filtered range)
- Stacked bars per month: Screenings (blue), Treatments (green), Extractions (red), Fluoride Applications (cyan)
- Legend below

**Chart 2 (left half): Pie chart — Oral Health Status Distribution**
- Slices: Orally Fit (green), Needs Treatment (red), Under Treatment (blue), Needs Follow-up (yellow)
- Percentage labels on slices
- Legend with counts

**Chart 3 (right half): Grouped bar chart — School Comparison**
- X-axis: Bagong Tanyag Integrated, Annex A, South Daang Hari
- Bars: Total Screened (blue), Orally Fit (green), High Risk (red)

**Data Table (below charts):**
- Detailed breakdown by grade level or age bracket
- Columns: Category, Screened, Orally Fit, Dental Caries, Gingivitis, Treated, Pending

**DMF/dmf Index Summary:**
- Average DMF score per school (horizontal bar chart)
- Trend vs previous period (↑ or ↓ with color)

**Print-friendly format:**
- Official header with Barangay Tanyag logo
- "FLORAL Dental Health Record Management System"
- Report period, date generated
- Signature line for dentist

Mobile: Simplified view, charts stack vertically

---

### 12. **Account Management** (`/accounts`)
**Access**: System Admin only

- User list table: Name, Email, Role badge, School, Status badge, Last Login, Actions
- Create/Edit user modal with role and school assignment
- Role Permissions Matrix — visual table showing what each role can access
- Search, filter by role/status
- Bulk actions: Import from Excel, bulk deactivate

Mobile: Card view for users

---

### 13. **Audit Trail** (`/audit`)
**Access**: System Admin only

**Header — 4 KPI cards:**
- Total Actions Today (count)
- Failed Login Attempts (red if > 3)
- Critical Actions (deletions, role changes)
- Active Sessions (count)

**Activity log table:**
- Timestamp, User, Role, Action badge, Module, Description, IP Address, Status badge
- Filter by date, user, action, module, status
- Export CSV/PDF

**Activity trend mini chart (above table):**
- Small sparkline showing action volume per hour today

Mobile: Essential columns only, expandable row for full details

---

## Navigation & Layout

### Responsive Sidebar Navigation
- **Desktop (≥ 1280px)**: Full sidebar, icons + labels, 256px width
- **Desktop (1024px–1279px)**: Collapsed sidebar, icons only, 80px width, tooltip on hover
- **Mobile (< 1024px)**: Hidden sidebar, hamburger menu, slide-out overlay

### Navigation Items by Role:
| Item | Dentist | Dental Aide | School Admin | BHO | Sys Admin |
|---|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Patients | ✅ | ✅ | ❌ | ❌ | ❌ |
| Dental Charts | ✅ | ✅ | ❌ | ❌ | ❌ |
| Appointments | ✅ | ✅ | ✅ | ❌ | ❌ |
| RPC Tracking | ✅ | ✅ | ❌ | ❌ | ❌ |
| AI Analytics | ✅ | ❌ | ❌ | ❌ | ❌ |
| Follow-up | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reports | ✅ | ❌ | ✅ | ✅ | ❌ |
| Accounts | ❌ | ❌ | ❌ | ❌ | ✅ |
| Audit Trail | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## UI/UX Guidelines

### KPI Cards (used in all dashboards)
- White background, subtle border, rounded-lg, p-6
- Top row: icon (colored, 24px) left + label right
- Middle: large bold number (text-3xl font-bold)
- Bottom: trend indicator (↑ green / ↓ red) + small description text
- Optional: inline mini sparkline or progress bar

### Charts (Recharts)
- All charts use the brand color palette
- Tooltips enabled on all charts (CustomTooltip component)
- Responsive container wrapping all charts
- Legend below each chart (not inside)
- Empty state: illustration + "No data available for this period"
- Loading state: skeleton placeholder matching chart height

### Form Elements
- Consistent input styling with borders and focus states
- Required field indicators (*)
- Validation error messages in red below field
- Success toast on form submit

### Buttons
- Primary: Blue (`#1E40AF`) background, white text
- Secondary: White background, blue border, blue text
- Danger: Red background, white text
- Disabled: Gray background, gray text, cursor-not-allowed

### Cards
- White background, border-gray-200 border or shadow-sm
- Padding p-6, rounded-lg

### Tables
- Header: gray-50 background, bold text, border-b
- Row hover: gray-50 background
- Mobile: Convert to card layout

### Modals
- Centered, dark overlay (bg-black bg-opacity-50)
- White content, rounded-xl, max-w-lg or max-w-2xl
- Close button top-right (X icon)
- Scrollable if content is long

### Badges / Pills
- Risk levels: red-100/red-800, yellow-100/yellow-800, green-100/green-800
- Status: color-coded per status type
- Role: blue-100/blue-800

---

## Data Models

### User
```typescript
{
  id: string;
  name: string;
  email: string;
  role: 'dentist' | 'dental_aide' | 'school_admin' | 'barangay_health' | 'system_admin';
  school?: 'Bagong Tanyag Integrated School' | 'Bagong Tanyag Elementary School Annex A' | 'South Daang Hari Elementary School Main';
  status: 'active' | 'inactive';
  lastLogin?: string;
}
```

### Patient (Student)
```typescript
{
  id: string;
  lastName: string;
  firstName: string;
  middleName?: string;
  birthdate: string;
  age: number;
  gender: 'Male' | 'Female';
  grade: string;
  section: string;
  school: 'Bagong Tanyag Integrated School' | 'Bagong Tanyag Elementary School Annex A' | 'South Daang Hari Elementary School Main';
  guardianName: string;
  guardianContact: string; // 09XX-XXX-XXXX format
  address: string;
  philhealthNumber?: string;
  fourPsNhts?: boolean;
  lastVisit?: string;
  oralStatus: 'Needs Treatment' | 'Under Treatment' | 'Needs Follow-up' | 'Orally Fit';
  riskLevel: 'High' | 'Medium' | 'Low';
  consentGiven: boolean;
  consentDate?: string;
}
```

### Medical History (one per student per year)
```typescript
{
  id: string;
  patientId: string;
  yearRecorded: number;
  dateExamined?: string;
  allergies?: string;
  hypertensionCva: boolean;
  diabetesMellitus: boolean;
  bloodDisorders: boolean;
  cardiovascularDisease: boolean;
  thyroidDisorders: boolean;
  hepatitisType?: string;
  malignancy?: string;
  prevHospitalMedical?: string;
  prevHospitalSurgical?: string;
  bloodTransfusion?: string;
  tattoo: boolean;
  others?: string;
}
```

### Dental Chart
```typescript
{
  id: string;
  patientId: string;
  dentistId: string;
  yearNumber: number;
  dateCharted: string;
  dmfIndex?: number;
  teeth: {
    [toothNumber: string]: {
      conditionCode: '√' | 'D' | 'd' | 'M' | 'm' | 'F' | 'f' | 'DX' | 'dx' | 'Un' | 'un' | 'S' | 's' | 'JC' | 'jc' | 'P' | 'p';
      treatmentCode?: 'FV' | 'PFS' | 'PF' | 'TF' | 'X' | 'SDF';
      dentitionType: 'P' | 'T'; // Permanent or Temporary
    };
  };
  status: 'Complete' | 'Incomplete' | 'Pending Review';
}
```

### Treatment Log (IPTR Visit)
```typescript
{
  id: string;
  patientId: string;
  dentistId: string;
  visitDate: string;
  weightKg?: number;
  temperatureCelsius?: number;
  bloodPressure?: string; // "120/80"
  chiefComplaint?: string;
  diagnosis?: string;
  treatmentDone?: string;
  remarks?: string;
  patientSigned: boolean;
  guardianSigned: boolean;
}
```

### RPC Record
```typescript
{
  id: string;
  patientId: string;
  dentistId: string;
  visitNumber: 1 | 2;
  visitDate?: string;
  treatmentType: string;
  nextSchedule?: string;
  completionStatus: 'Completed' | 'Pending' | 'Missed';
}
```

### Risk Stratification
```typescript
{
  id: string;
  patientId: string;
  assessedDate: string;
  riskLevel: 'High' | 'Medium' | 'Low';
  confidenceScore: number; // 0.00–1.00
  recommendedProcedure?: string;
  validatedBy?: string;
  validationStatus: 'Pending' | 'Validated' | 'Overridden';
}
```

### Appointment
```typescript
{
  id: string;
  patientId: string;
  dentistId: string;
  date: string;
  time: string;
  type: 'Initial Screening' | 'Treatment' | 'Follow-up' | 'Emergency' | 'Bayanihan Event';
  status: 'Scheduled' | 'Confirmed' | 'In Progress' | 'Completed' | 'Cancelled' | 'No Show';
  duration: number;
  notes?: string;
  parentalSupervisionRequired: boolean;
}
```

### Audit Log
```typescript
{
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: string;
  action: 'Create' | 'Read' | 'Update' | 'Delete' | 'Login' | 'Logout' | 'Export';
  module: string;
  description: string;
  ipAddress: string;
  status: 'Success' | 'Failed';
}
```

---

## Authentication & Context

### Auth Context
- React Context for authentication state
- Store current user info and role
- Login/logout functions
- Protected route wrapper
- Auto-redirect to login if not authenticated
- Role-based route access enforcement

---

## Mock Data Requirements

Create realistic Filipino names and data:
- Use common Filipino first/last names (e.g., Santos, Reyes, Cruz, Garcia, Dela Cruz)
- **Schools must be exactly:**
  - Bagong Tanyag Integrated School
  - Bagong Tanyag Elementary School Annex A
  - South Daang Hari Elementary School Main
- Use Taguig City addresses (Purok 1, 11, 13 — Barangay Tanyag)
- Philippine phone format: 09XX-XXX-XXXX
- 25–30 mock patients distributed across 3 schools
- 10–15 appointments
- 5–10 RPC records (mix of statuses)
- 5–10 follow-up alerts
- 5–10 risk stratification records (mix of High/Medium/Low)
- Sample dental charts with DOH condition codes (D, M, F, DX, √)
- Mock audit log entries (last 7 days)

---

## Success Criteria

1. ✅ Fully responsive (desktop, tablet, mobile)
2. ✅ Role-based authentication with 5 user types
3. ✅ All screens including RPC Tracking (14 total)
4. ✅ Working navigation with role-based visibility
5. ✅ Role-specific dashboards with Recharts visualizations
6. ✅ Interactive dental charting with DOH IPTR codes
7. ✅ Appointment scheduling with Bayanihan Event mode
8. ✅ RPC Tracking with 2-visit monitoring and overdue alerts
9. ✅ AI Analytics with risk validation workflow
10. ✅ Report generation with charts and export
11. ✅ Audit trail for RA 10173 compliance
12. ✅ Barangay Tanyag color scheme consistently applied
13. ✅ All dashboards use charts/graphs — no plain text summaries
14. ✅ DOH IPTR-accurate medical history and dental charting fields

---

## Future Enhancements (Out of Scope for Prototype)

- Real backend API integration (Node.js/Express)
- Real MongoDB Atlas database
- Actual SMS integration (Semaphore/Twilio)
- Real-time notifications (WebSockets)
- File upload for X-rays and consent form images
- Advanced ML model training and retraining
- Multi-language support (Filipino/English)
- **PWA offline mode with IndexedDB sync** *(planned for full system — out of scope for prototype only)*
- Barcode scanning for student IDs
- DepEd system integration
- E-signature for consent forms

---

**End of Specification**

*This document serves as the complete blueprint for the FLORAL Dental Health Record Management System prototype. All school names, user roles, dental codes, and data models have been aligned with the Group 404 capstone manuscript and client consultation records.*