import { NOTIFIED_ROLES } from '../hooks/useNotifications';

// Who may open each screen (Sprint 163, SEC-34). ONE table read by both the
// sidebar (Root.tsx `allTabs`) and the page guard (RootLayout.tsx), so a screen
// hidden from the menu is also refused when its URL is typed in. Before this,
// the sidebar only HID links: a School Admin could open /dental-chart/<id>.
//
// Keyed by the route's FIRST path segment, so sub-pages inherit their screen's
// rule (students/scan and students/scan/review fall under /students).
const ALL = ['dentist', 'dental_aide', 'school_admin', 'bho_staff', 'system_admin'];
const CLINICAL = ['dentist', 'dental_aide', 'system_admin'];
const ADMIN = ['system_admin'];

export const ROUTE_ROLES: Record<string, string[]> = {
  '/': ALL,
  '/appointments': CLINICAL,
  '/patients': CLINICAL,
  '/students': CLINICAL,
  '/dental-charts': CLINICAL,
  '/dental-chart': CLINICAL,
  '/treatment-records': CLINICAL,
  // Risk sign-off is dentist-only (SEC-35); the System Admin may view.
  '/ai-analytics': ['dentist', 'system_admin'],
  '/rpc': CLINICAL,
  '/reports': ALL,
  '/schools': ADMIN,
  '/accounts': ADMIN,
  '/archive': ADMIN,
  '/audit': ADMIN,
  '/notifications': NOTIFIED_ROLES,
};

/** Whether `role` may open `pathname`. A path with no entry is allowed: it is
 *  either a screen outside the signed-in layout or one the router 404s anyway. */
export function canOpen(pathname: string, role: string | undefined): boolean {
  const key = '/' + (pathname.split('/')[1] ?? '');
  const roles = ROUTE_ROLES[key];
  return !roles || (!!role && roles.includes(role));
}
