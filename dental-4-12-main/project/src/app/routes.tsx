import { createBrowserRouter, useParams } from "react-router";
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
import { AccountManagement } from "./components/AccountManagement";
import { AuditTrail } from "./components/AuditTrail";
import { SchoolManagement } from './components/SchoolManagement';
import { ArchiveManagement } from './components/ArchiveManagement';
import { Notifications } from './components/Notifications';
import { UpdateSchoolYear } from './components/UpdateSchoolYear';

const DentalChartKeyed = () => { const { id } = useParams(); return <DentalChart key={id} />; };

export const router = createBrowserRouter([
  { path: "/login", Component: Login },
  { path: "/reset-password", Component: ResetPassword },
  { path: "/select-school", Component: SchoolSelect },
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: Dashboard },
      { path: "patients", Component: PatientList },
      { path: "students/update-school-year", Component: UpdateSchoolYear },
      { path: "dental-charts", Component: DentalChartNav },
      { path: "dental-chart/:id", Component: DentalChartKeyed },
      { path: "treatment-records", Component: TreatmentRecords },

      { path: "appointments", Component: Appointments },
      { path: "rpc", Component: RPCTracking },
      { path: "ai-analytics", Component: AIAnalytics },
      { path: "reports", Component: Reports },
      { path: "accounts", Component: AccountManagement },
      { path: "schools", Component: SchoolManagement },
      { path: "archive", Component: ArchiveManagement },
      { path: "audit", Component: AuditTrail },
      { path: "notifications", Component: Notifications },
    ],
  },
]);
