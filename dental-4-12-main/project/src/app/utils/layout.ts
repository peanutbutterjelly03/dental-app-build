// Height in px of the fixed status strip pinned to the very top of the app
// (Root.tsx) — online/offline state plus the school currently being viewed.
//
// It is `position: fixed`, so it is out of flow and everything that pins itself
// to the top of the viewport has to start BELOW it or it renders underneath:
// the sidebar rail, the mobile header, the SyncStatus icon, and the IPTR
// screen's sticky toolbar + tab strip all offset by this value. Shared as one
// constant so those five call sites cannot drift apart.
export const TOPBAR_H = 28;
