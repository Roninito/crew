# Motion audit + plan: Wrangler views

Commit: 8387a7e
Scope: `packages/wrangler/src/main.ts`, `packages/wrangler/styles.css`

## Recon

- Stack: plain DOM via Obsidian's `createEl`/`createDiv`, no motion library, no CSS-in-JS.
- Motion today: **none.** `styles.css` has zero `transition`, `animation`, or `@keyframes`. Buttons and links get whatever Obsidian's own core CSS supplies; nothing in Wrangler's own rules animates.
- Structural fact that drives every finding below: every view's `render()` calls `el.empty()` then rebuilds its entire DOM from scratch, on a timer (`refreshSeconds`, default 5, minimum 2 enforced in settings) and on every live WebSocket event (debounced 400ms). This is not a one-time mount -- it repeats for as long as the view is open.
- Frequency map: the periodic re-render fires dozens of times per session (every 2-5s while a view is open). Button clicks (Run now, Approve, Claim, etc.) are occasional, human-paced. There are no popovers, dropdowns, or command-palette-style high-frequency actions in Wrangler's own views.

## Audit

| # | Severity | Category | Location | Finding | Fix summary |
|---|---|---|---|---|---|
| 1 | HIGH | Missed opportunity / cohesion | `styles.css` (whole file) | No signature motion anywhere; agent/task state is legible (per the file's own comment, "never color alone") but static -- nothing signals "this is live and being watched." | Add a continuous, state-driven pulse to the agent/job status dot (new markup, see design plan below). Loop period 1.6s, well under the 2s-minimum refresh interval, so it reads as a heartbeat rather than restarting visibly when the view rebuilds. |
| 2 | HIGH | Purpose & frequency | All `<button>` elements (`btn()` helper, `main.ts`) | Buttons have no press feedback; combined with full-DOM rebuilds on a timer, a user can't always tell a click registered before the next refresh repaints the row. | `transform: scale(0.97)` on `:active`, 100ms, no easing needed at this duration. Applies globally via one rule on `.crew-view button, .modal button`. |
| 3 | MEDIUM | Physicality | `.crew-card` (board), `.crew-agent` (sidebar) | Interactive rows (draggable cards, clickable agent cards) have no hover response beyond the cursor changing. | `transform: translateY(-1px)` + shadow on `:hover`, 150ms ease-out. Transform/opacity only, GPU-composited. |
| 4 | LOW | Cohesion | New token needs | No easing/duration tokens exist to hold these values consistent as more get added later. | Add `--crew-ease`, `--crew-ease-move`, `--crew-dur-fast`, `--crew-dur-base` custom properties in `styles.css` and reference them everywhere instead of inlining values twice. |
| 5 | N/A (exempt, documented) | Purpose & frequency | Every view's `render()` | The periodic full-rebuild (2-5s) and the WebSocket-triggered refresh are NOT candidates for enter/appear animation on individual rows -- that would replay a fade/slide on unchanged content every few seconds, which is exactly the "actions repeated 100+x/day get no animation" case, just time-triggered instead of click-triggered. This is a deliberate exclusion, not an oversight: don't add per-card enter transitions without first adding real diffing (only re-render what changed), which is out of scope here. | No fix -- documented so a future pass doesn't "helpfully" add fade-ins to every re-render. |
| 6 | N/A (exempt, documented) | Purpose & frequency | Status bar text (`renderStatusBar`) | Same reasoning as #5: the status bar's summary line changes on the same refresh cadence. Cross-fading it on every tick would be a clock that flashes every second. Leave the text swap instant; only the new status dot (a separate, continuously-looping element, unaffected by text changes) gets motion. | No fix. |
| 7 | LOW | Accessibility | New motion (dot pulse, hover lift, press scale) | None of the new motion exists yet, so there's nothing to retrofit, but it must ship correct from the start. | Wrap all new `transition`/`animation` rules in `@media (prefers-reduced-motion: no-preference)`; reduced-motion users get the color/state change with no movement. |

**Missed opportunities (additive, not corrective):**
- Job status changes (`queued` -> `running` -> `succeeded`/`failed`) have no visual acknowledgment beyond the text updating on next refresh. Out of scope for this pass (would need per-row diffing to animate correctly per finding #5's exemption); worth a future plan once re-render is incremental.
- The Review inbox has no indication of *new* items arriving vs. items that were already there. Same blocker as above.

## Verification

- `bun run build` in `packages/wrangler` (bundles `styles.css` is separate -- confirm Obsidian loads it; no build step touches CSS).
- Manual feel-check in Obsidian: open the crew sidebar with a couple of agents in different states, confirm the dot reads as "alive" without being distracting at arm's length; click a few buttons and confirm the press-scale is felt, not seen; drag a board card and confirm hover-lift doesn't fight the native drag ghost.
- Toggle System Settings > Accessibility > Reduce motion (macOS) and confirm the dot stops pulsing (state still visible via color + shape) and hover lift/press-scale no longer move.
