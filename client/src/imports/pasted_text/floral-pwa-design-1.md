Design a progressive web application called Floral for a school dental clinic management system in the Philippines. The app is used by dentists, dental aides, school administrators, and a system admin. Use a clean, professional medical aesthetic with a green and white color scheme, sidebar navigation, and card-based layouts.
General UI:

Sidebar navigation on the left with the Floral logo at the top
Top bar showing current user name, role, and school name
Responsive layout suitable for desktop and tablet
Language: English

Design these screens:
1. Login Screen

Email and password fields
Role is auto-detected from account
"Forgot password" link

2. Dashboard (Dentist view)

Summary cards: Total Students Monitored, Students Needing Follow-up, Upcoming Appointments Today, Overdue Fluoride Treatments
Bar chart: Oral health conditions breakdown (caries, gingivitis, calculus, etc.)
List: Top 5 high-priority students from AI stratification
Quick action buttons: Add Patient, Create Appointment, Generate Report

3. Patient Record - Student List

Searchable, filterable table of students (name, grade, school, last visit, oral status)
Filter by school, grade level, oral condition, risk level
Button to add new patient

4. Patient Record - Individual Student Profile

Student info card: name, age, sex, grade, school, PhilHealth/4Ps ID, contact, photo placeholder
Tabs: Medical History, Dietary & Social Habits, Oral Health Condition, Consent Form
Medical history checklist (allergies, hypertension, diabetes, etc.)
Oral health condition tags (orally fit, caries, gingivitis, etc.)
AI risk badge: High / Medium / Low with recommended action
Button: View Dental Chart, View Treatment Log, Schedule Appointment

5. Digital Dental Chart

Interactive tooth diagram showing upper and lower teeth (permanent and temporary dentition)
Each tooth is clickable and can be marked with condition codes: Sound/Sealed, Decayed, Missing, Filled, Indicated for Extraction, Unerupted, Supernumerary, Jacket Crown, Pontic
Treatment codes panel: FV (Fluoride Varnish), PFS (Pit and Fissure Sealant), PF (Permanent Filling), TF (Temporary Filling), X (Extraction), SDF (Silver Diamine Fluoride)
Year selector to view chart per school year
Color coding per condition
Dentist signature field at bottom

6. Treatment Log

Table: Date, Chief Complaint, Diagnosis, Treatment Done, Dentist, Remarks
Add new treatment log entry form

7. Appointment Scheduling

Monthly calendar view with appointment slots
List view: upcoming, past appointments
Create appointment form: student name, type (Checkup, Fluoride, Extraction, Cleaning, Sealant, Filling), date, time, dentist, school, notes
Bayanihan Event mode: create a mass dental event with multiple dentist slots and bulk student assignment
Status tags: Scheduled, Completed, Missed

8. AI Analytics - Prioritized Treatment List

Table of students ranked by risk level: High (red), Medium (yellow), Low (green)
Columns: Student Name, Grade, School, Oral Condition, Recommended Procedure, Risk Level, Last Visit
Filter by school, grade, risk level
Each row has a "Validate" button for the dentist to confirm or override the AI recommendation
Summary cards at top: Total High Risk, Total Medium Risk, Total Low Risk

9. Follow-up Alerts

List of students overdue for fluoride treatment (beyond 6 months)
List of students with missed appointments
SMS notification button per student
Bulk SMS option

10. Report Generation

Select report type: Monthly Oral Health Report, Appointment Summary, Fluoride Coverage Report
Select school and date range
Preview panel
Export buttons: PDF and Excel

11. Dashboard (School Admin view)

Summary cards for their school only: total students, oral fitness rate, fluoride coverage rate, upcoming appointments
Bar chart: monthly procedure volume
Quick access: View Reports, View Appointments

12. Dashboard (Barangay Health Office view)

Aggregated data across all 3 schools
Comparison charts per school
Export dashboard as PDF

13. Audit Trail (System Admin)

Log table: Timestamp, User, Action, Module, Details
Filter by user, date, module

14. Account Management (System Admin)

Table of user accounts: Name, Role, School, Status (Active/Inactive)
Create account form: name, email, role, assigned school
Deactivate/reactivate account button

Role-based navigation:

Dentist sees: Dashboard, Patients, Dental Chart, Appointments, AI Analytics, Follow-up Alerts, Reports
Dental Aide sees: Dashboard, Patients, Dental Chart, Appointments, Follow-up Alerts
School Admin sees: Dashboard, Appointments, Reports
Barangay Health Office sees: Dashboard, Reports
System Admin sees: Account Management, Audit Trail