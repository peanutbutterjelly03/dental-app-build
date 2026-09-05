// Height in px of the fixed status strip pinned to the very top of the app
// (Root.tsx) — online/offline state plus the school currently being viewed.
//
// It is `position: fixed`, so it is out of flow and everything that pins itself
// to the top of the viewport has to start BELOW it or it renders underneath:
// the sidebar rail, the mobile header, the SyncStatus icon, and the IPTR
// screen's sticky toolbar + tab strip all offset by this value. Shared as one
// constant so those five call sites cannot drift apart.
// 48px is exactly 1/2 inch: CSS defines 1in = 96px regardless of the physical
// display, so this is the literal half-inch the strip was asked for.
//
// This is the CONTAINER dial only. The pills inside are settled at 13px/19px
// and are NOT to be rescaled with it — the 64px and 128px rounds overshot
// precisely because the type was doubled alongside the height, which
// compounds. Change the one that was named.
export const TOPBAR_H = 48;
