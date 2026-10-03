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

This specification document serves as the complete blueprint for the FLORAL Dental Health Record Management System prototype. All school names, user roles, dental codes, and data models have been aligned with the Group 404 capstone manuscript and client consultation records.

*(Document continues with full details for all other screens, data models, and implementation guidelines as per the imported specification)*
