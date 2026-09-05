// Height in px of the fixed status strip pinned to the very top of the app
// (Root.tsx) — online/offline state plus the school currently being viewed.
//
// It is `position: fixed`, so it is out of flow and everything that pins itself
// to the top of the viewport has to start BELOW it or it renders underneath:
// the sidebar rail, the mobile header, the SyncStatus icon, and the IPTR
// screen's sticky toolbar + tab strip all offset by this value. Shared as one
// constant so those five call sites cannot drift apart.
// 24px is exactly 1/4 inch: CSS defines 1in = 96px regardless of the physical
// display, so this is the literal quarter-inch the strip was asked for. The
// pills inside are sized to nearly fill it (19px of the 24px) rather than
// floating in a tall bar — the earlier 64px and 128px versions failed because
// the container grew without the contents, and then both grew at once.
export const TOPBAR_H = 24;
