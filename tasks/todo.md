# Make the app mobile-friendly

Full plan: `/home/sun50/.claude/plans/quiet-beaming-otter.md`

## Tasks
- [x] Drawer state + auto-open right drawer on cell select (`App.tsx`)
- [x] Root container → `flex flex-col lg:flex-row`, backdrop overlay
- [x] Left `<aside>` → off-canvas drawer (`lg:` reverts to static)
- [x] Right `<aside>` → off-canvas drawer (`lg:` reverts to static)
- [x] Toolbar: wrap on mobile, add drawer-toggle buttons, hide "Fit: %" below `lg`
- [x] Status bar: allow wrapping on mobile
- [x] Touch pan (single-finger) on cell photo, non-passive `touchmove`/`touchend` listeners
- [x] Touch pinch-to-zoom (two-finger) on cell photo
- [x] Crop modal: fit small viewports (`max-h`, responsive Cropper height)
- [x] `index.css`: `touch-action: manipulation` on interactive elements
- [ ] Verify mobile viewport via chrome-devtools — **not possible**, no Chrome/Chromium binary in this WSL sandbox (`mcp__chrome-devtools__new_page` failed: "Could not connect to Chrome"; `which chromium/google-chrome` empty). Not attempted a Playwright browser install since that's an invasive download the user didn't ask for.
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` passes (single-file `dist/index.html`, 2.52 MB)

## Review

**Changes** (`src/App.tsx`, `src/index.css`)
- Root layout: `flex h-screen` → `flex flex-col lg:flex-row h-screen relative overflow-hidden`. On `<lg` the two `<aside>` panels are `fixed` (out of flow) so `<main>` naturally becomes full-width/height; at `lg:` they go back to `static` — the original 3-column desktop layout is untouched via `lg:` overrides throughout.
- Left/right sidebars are now off-canvas drawers on mobile: `w-[85vw] max-w-[…px]`, slide via `translate-x` + `transition-transform`, `leftOpen`/`rightOpen` state, a click-catching backdrop, and an `✕` close button in each (`lg:hidden`). Selecting a cell (`selectedCellId` changes) auto-opens the right drawer so the Cell Editor is immediately visible on mobile.
- Toolbar (`App.tsx:887`) and status bar (`App.tsx:1040`) allow wrapping (`flex-wrap`) and variable height on mobile instead of a fixed pixel height; added ☰ (open settings drawer) and 🖼 (open library/editor drawer) icon buttons, both `lg:hidden`; "Fit: %" indicator hidden below `lg`.
- Touch support for the core cell-photo gesture, which previously had **zero** touch handling (mouse-only `onMouseDown`/window `mousemove`/`mouseup`, and `onWheel`): added `onTouchStart` on the photo wrapper plus a new `useEffect` with native (non-passive) `window` listeners for `touchmove`/`touchend`/`touchcancel`, mirroring the existing mouse-drag effect. One finger pans (reuses the existing `dragState` ref/shape); two fingers pinch-zoom (`pinchState` ref, distance ratio, same 0.4–5 clamp as wheel-zoom). Listeners are native/non-passive so `preventDefault()` reliably stops the page from scrolling mid-gesture — React's `onTouchMove` prop can't do that reliably.
- Crop modal: outer card gets `max-h-[92vh] overflow-y-auto`, backdrop padding shrinks on mobile (`p-3 sm:p-6`), and the Cropper's fixed `h-[520px]` becomes `h-[45vh] sm:h-[520px]` so it fits short phone viewports instead of overflowing.
- `index.css`: added `touch-action: manipulation` on buttons/links/range inputs to remove the mobile tap delay and stray double-tap-zoom.

**Verified**
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds, still emits a single self-contained `dist/index.html`.
- Manual diff review for structural correctness (balanced JSX, `lg:` overrides present on every mobile-only class, shared refs/state wired consistently between the new touch effect and the existing mouse effect).

**Not verified (couldn't be, in this environment)**
- No visual/interactive check in an actual mobile viewport — this sandbox has no Chrome/Chromium binary, so the `chrome-devtools` MCP tools couldn't attach (`new_page` → "Could not connect to Chrome"), and none of `google-chrome`/`chromium`/`chromium-browser` are installed. Didn't install Playwright's browser (large download) unasked.
- Dev server is running at `http://localhost:5173/` — please check on an actual phone or with your browser's device toolbar (resize below ~1024px width to see the drawer behavior; try a cell with a photo to test one-finger pan / two-finger pinch on a touchscreen).

**Follow-ups worth knowing about**
- Touch targets in the Transform/Adjust panels (rotation, flip, filter reset buttons) weren't resized — they're ~30–36px, a bit under the 44px touch-target guideline, but functional. Left alone to keep the diff minimal per the approved plan.
- HTML5 drag-and-drop (library photo → cell) is still desktop-only; mobile already has a working fallback (tap a library thumbnail to assign it to the selected/first-empty cell), so this wasn't touched.

## Round 2 — user-reported issues after trying it on a real phone

1. **No visible feedback on tap.** Root cause: Tailwind v4 wraps every `hover:` utility in `@media (hover: hover)` (confirmed by grepping the built CSS — `@media(hover:hover){...}`), so on a touchscreen (`hover: none`) none of the `hover:` classes ever apply — not a "missing feature", the hover states were never reachable on mobile at all. Worse, `group-hover:opacity-100` on the library thumbnail overlay (delete ✕ button + dimensions) meant that overlay was **permanently invisible and untappable on mobile** — a real functional bug, not just a missing-affordance issue.
2. **Dragging a photo scrolls the whole page instead of repositioning it.** Root cause: the photo wrapper div had touch listeners, but no `touch-action: none`. Without that CSS property, mobile browsers can start native scrolling on the nearest scrollable ancestor before/alongside the JS `preventDefault()` call in the touchmove listener — the two were racing.

**Fixes**
- `src/index.css`: `html { -webkit-tap-highlight-color: transparent }` + a global `button:not(:disabled):active { transform: scale(.96); opacity: .85; transition: ... }` — every button now gets a consistent, immediate press state on tap, with no per-button JSX edits needed. Verified compiled into `dist/index.html`.
- `src/App.tsx` (`LibraryGrid`): the thumbnail overlay is now `opacity-100 sm:opacity-0 sm:group-hover:opacity-100` — always visible (delete button reachable) below the `sm` breakpoint, hover-reveal preserved on desktop. Added `active:opacity-70 active:scale-[0.98]` on the thumbnail `<img>` itself (not a `<button>`, so outside the global CSS rule).
- `src/App.tsx`: added `touch-none` (`touch-action: none`) to the cell's photo-wrapper div (the one with `onTouchStart`/`onMouseDown`/`onWheel`), so the browser never hands the gesture to native scrolling in the first place — our JS pan/pinch handlers own it exclusively. Verified compiled into `dist/index.html` as `touch-action:none`.

**Verified:** `npx tsc --noEmit` clean, `npm run build` succeeds, grepped the built CSS to confirm `touch-action:none`, the `:active` rule, and `-webkit-tap-highlight-color:transparent` all made it into the bundle. Still no real browser in this sandbox to click-test interactively — please re-check on your phone.
