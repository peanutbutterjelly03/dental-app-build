import type { ComponentType } from "react";
import { createBrowserRouter, useParams } from "react-router";
import { OnlineOnly } from "./components/OnlineOnly";
import { RootLayout } from "./components/RootLayout";
import { Login } from "./components/Login";
import { ResetPassword } from "./components/ResetPassword";
import { SchoolSelect } from "./components/SchoolSelect";
import { Dashboard } from "./components/Dashboard";
import { PatientList } from "./components/PatientList";
import { DentalChart } from "./components/DentalChart";
import { DentalChartNav } from "./components/DentalChartNav";
import { TreatmentRecords } from "./components/TreatmentRecords";
import { Appointments } from "./components/Appointments";
import { RPCTracking } from "./components/RPCTracking";
import { AIAnalytics } from "./components/AIAnalytics";
import { Reports } from "./components/Reports";
import { Notifications } from "./components/Notifications";
import { AccountManagement } from "./components/AccountManagement";
import { AuditTrail } from "./components/AuditTrail";
import { SchoolManagement } from './components/SchoolManagement';
import { ArchiveManagement } from './components/ArchiveManagement';
import { UpdateSchoolYear } from './components/UpdateSchoolYear';
import { ScanStudentForm } from './components/ScanStudentForm';
import { VerifyStudentForm } from './components/VerifyStudentForm';
import { BulkScanReview } from './components/BulkScanReview';

// Pages that need the server. Dental Charts, the Dental Chart and Treatment are the
// offline modules (students are queued there beforehand), so they are the only routes NOT wrapped.
const needsConnection = (Page: ComponentType): ComponentType => () => <OnlineOnly><Page /></OnlineOnly>;

const DentalChartKeyed = () => { const { id } = useParams(); return <DentalChart key={id} />; };

export const router = createBrowserRouter([
  { path: "/login", Component: Login },
  { path: "/reset-password", Component: ResetPassword },
  { path: "/select-school", Component: SchoolSelect },
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: needsConnection(Dashboard) },
      { path: "patients", Component: needsConnection(PatientList) },
      { path: "students/update-school-year", Component: needsConnection(UpdateSchoolYear) },
      { path: "students/scan", Component: needsConnection(ScanStudentForm) },
      { path: "students/scan/review", Component: needsConnection(VerifyStudentForm) },
      { path: "students/scan/bulk", Component: needsConnection(BulkScanReview) },
      { path: "dental-charts", Component: DentalChartNav },
      { path: "dental-chart/:id", Component: DentalChartKeyed },
      { path: "treatment-records", Component: TreatmentRecords },

      { path: "appointments", Component: needsConnection(Appointments) },
      { path: "rpc", Component: needsConnection(RPCTracking) },
      { path: "ai-analytics", Component: needsConnection(AIAnalytics) },
      { path: "reports", Component: needsConnection(Reports) },
      { path: "notifications", Component: needsConnection(Notifications) },
      { path: "accounts", Component: needsConnection(AccountManagement) },
      { path: "schools", Component: needsConnection(SchoolManagement) },
      { path: "archive", Component: needsConnection(ArchiveManagement) },
      { path: "audit", Component: needsConnection(AuditTrail) },
    ],
  },
]);
