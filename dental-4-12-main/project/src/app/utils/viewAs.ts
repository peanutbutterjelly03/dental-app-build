// "View as" (2026-10-01): lets the System Admin preview the app as another
// role without switching accounts. Asked for by the collaborator because
// testing meant logging in and out constantly; built INSTEAD of removing
// role-based access, which the user was advised against.
//
// ⚠ A PREVIEW, NOT AN IMPERSONATION. Only the SCREENS change. The server still
// knows you are the System Admin, and api/client.ts refuses every save while a
// preview is active, so nothing can be written "as the dentist" (the audit
// trail would record the admin, and a non-dentist signing off a risk result is
// exactly what CLAUDE.md forbids). To test SAVING as a role, sign in as it.
//
// Never on the live site: available on local dev and on Vercel preview
// deployments only, decided by hostname so no environment variable can be
// forgotten.

export const PRODUCTION_HOST = 'dental-app-build.vercel.app';

export const VIEW_AS_AVAILABLE: boolean =
  import.meta.env.DEV || (typeof window !== 'undefined' && window.location.hostname !== PRODUCTION_HOST);

export const VIEW_AS_KEY = 'floral-view-as';
