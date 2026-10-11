import { useNavigate } from 'react-router';
import { useAuth, ALL_SCHOOLS } from '../context/AuthContext';
import { getSchoolColor } from '../utils/schoolColors';
import { School, ChevronRight, LogOut, MapPin, Layers } from 'lucide-react';

const SCHOOL_META: Record<string, { shortName: string; address: string; levels: string }> = {
  'Bagong Tanyag Integrated School': {
    shortName: 'Bagong Tanyag Integrated School',
    address: 'Bagong Tanyag, Taguig City',
    levels: 'Kinder – Grade 10',
  },
  'Bagong Tanyag Elementary School Annex A': {
    shortName: 'Bagong Tanyag Elementary Annex A',
    address: 'Bagong Tanyag, Taguig City',
    levels: 'Grade 1 – Grade 6',
  },
  'South Daang Hari Elementary School Main': {
    shortName: 'S. Daang Hari Elementary',
    address: 'South Daang Hari, Taguig City',
    levels: 'Grade 1 – Grade 6',
  },
};

const roleLabels: Record<string, string> = {
  dentist: 'Dentist',
  dental_aide: 'Dental Aide',
  school_admin: 'School Admin',
  bho_staff: 'Barangay Health Office Staff',
  system_admin: 'System Admin',
};

const roleBadgeColors: Record<string, string> = {
  dentist: 'bg-blue-100 text-blue-800',
  dental_aide: 'bg-teal-100 text-teal-800',
  school_admin: 'bg-orange-100 text-orange-800',
  bho_staff: 'bg-purple-100 text-purple-800',
  system_admin: 'bg-red-100 text-red-800',
};

export const SchoolSelect = () => {
  const { user, setSelectedSchool, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const handleSelectSchool = (school: string | null) => {
    setSelectedSchool(school);
    navigate('/');
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#E31E24] rounded-full flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-sm">BT</span>
            </div>
            <div>
              <div className="text-lg font-bold text-[#1E40AF]">FLORAL</div>
              <div className="text-xs text-muted-foreground -mt-0.5">Dental Health Record Management System</div>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-danger-surface rounded-lg transition-colors">
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl">
          {/* Welcome */}
          <div className="text-center mb-10">
            <p className="text-muted-foreground text-sm mb-1">Welcome back,</p>
            <h1 className="text-2xl font-bold text-foreground">{user.name}</h1>
            <span className={`inline-block mt-2 px-3 py-1 text-xs rounded-full font-medium ${roleBadgeColors[user.role] || 'bg-gray-100 text-foreground'}`}>
              {roleLabels[user.role] || user.role}
            </span>
            <p className="text-muted-foreground text-sm mt-4">
              Select a school to continue
            </p>
          </div>

          {/* School Cards */}
          {user.schools.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8 text-center">
              <School className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
              <h2 className="font-semibold text-yellow-800 mb-1">No School Assigned</h2>
              <p className="text-yellow-700 text-sm">Please contact the System Administrator to assign you to a school.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* ⚠ ALL SCHOOLS, restored (Sprint 180). Sprint 67 made this a
                  real option in the old sidebar dropdown; her Switch School
                  page replaced that dropdown and lists only the three schools,
                  so adopting it removed the cross-school view entirely — while
                  a dozen screens still branch on it. FhsisReport prints the
                  words "All schools" on a filed return, DentalChartNav shows it
                  as the kicker, and a day note saved with no school is defined
                  as the barangay-wide one.

                  It is also what the BHO STAFF ROLE IS FOR: "consolidated
                  reports across all schools" (CLAUDE.md). Without this they can
                  only ever see one school at a time.

                  ⚠ Shown only to users who actually hold every school. A
                  school_admin pinned to one must not be offered a view across
                  all three, and `user.schools` is already that list. */}
              {/* ⚠ The sentinel is ALL_SCHOOLS ('__ALL__'), not null and not ''.
                  `schoolChoiceMade` is `schoolChoice !== null`, so null means
                  "has not chosen yet" and RootLayout bounces back here; '' is
                  not a school name, so `schools.includes('')` fails on the next
                  load and the choice evaporates. The context maps '__ALL__' to
                  a null `selectedSchool`, which is what every screen reads. */}
              {user.schools.length > 1 && (
                <button
                  onClick={() => handleSelectSchool(ALL_SCHOOLS)}
                  className="group w-full text-left bg-white rounded-2xl border-2 border-border p-6 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5"
                >
                  <div className="w-full h-1.5 rounded-full mb-5 bg-primary" />
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary-surface">
                      <Layers className="w-6 h-6 text-primary" />
                    </div>
                  </div>
                  <h2 className="font-bold text-foreground mb-1">All schools</h2>
                  <p className="text-sm text-muted-foreground">
                    Every school at once — the view the consolidated DOH reports are filed from.
                  </p>
                </button>
              )}
              {user.schools.map(school => {
                const sc = getSchoolColor(school);
                const meta = SCHOOL_META[school];
                return (
                  <button
                    key={school}
                    onClick={() => handleSelectSchool(school)}
                    style={{ borderColor: sc.border }}
                    className="group w-full text-left bg-white rounded-2xl border-2 p-6 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5"
                  >
                    {/* School color bar */}
                    <div style={{ backgroundColor: sc.solid }} className="w-full h-1.5 rounded-full mb-5" />

                    {/* Icon + name */}
                    <div className="flex items-start justify-between mb-4">
                      <div style={{ backgroundColor: sc.light }} className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0">
                        <School style={{ color: sc.solid }} className="w-6 h-6" />
                      </div>
                      <ChevronRight style={{ color: sc.solid }} className="w-5 h-5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>

                    <div style={{ color: sc.text }} className="font-bold text-base leading-tight mb-1">
                      {meta?.shortName || school}
                    </div>

                    <div className="flex items-center gap-1 text-muted-foreground text-xs mt-2">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span>{meta?.address}</span>
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <span style={{ backgroundColor: sc.light, color: sc.text }} className="text-xs font-medium px-2 py-1 rounded-full">
                        {meta?.levels}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground mt-8">
            {user.schools.length} school{user.schools.length !== 1 ? 's' : ''} assigned to your account
          </p>
        </div>
      </div>
    </div>
  );
};
