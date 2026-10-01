import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { canOpen } from '../utils/routeRoles';
import { Root } from './Root';
import { SessionLock } from './SessionLock';
import { ViewAsControl } from './ViewAsControl';

export const RootLayout = () => {
  const { user, loading, schoolChoiceMade, testingMode } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Sprint 163 (SEC-34): a screen the sidebar hides is also refused by URL.
  const allowed = !user || canOpen(pathname, user.role);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/login');
    } else if (!schoolChoiceMade) {
      navigate('/select-school');
    } else if (!allowed) {
      navigate('/', { replace: true });
    }
  }, [user, loading, schoolChoiceMade, allowed, navigate]);

  // Keyed on the CHOICE, not the value: "all schools" is a legitimate
  // selection that leaves selectedSchool null, and gating on null would bounce
  // the user straight back to the picker. A refused screen renders nothing for
  // the instant before the redirect, so it never flashes.
  if (loading || !user || !schoolChoiceMade || !allowed) return null;

  // SessionLock sits beside the app, not inside a screen, so the idle timer
  // runs everywhere a signed-in user can be.
  return (
    <>
      {/* Testing mode (OPEN_ACCESS_TESTING on the server): impossible to miss,
          so it is not left on by accident before defense or real use. */}
      {testingMode && (
        <div role="status" className="fixed top-0 left-1/2 z-[260] -translate-x-1/2 rounded-b-lg bg-amber-500 px-4 py-1 text-center text-xs font-semibold text-white shadow">
          Testing mode: role limits are off. Turn this off before real use.
        </div>
      )}
      <Root />
      <ViewAsControl />
      <SessionLock />
    </>
  );
};
