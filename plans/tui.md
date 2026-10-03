# `crew tui` -- a full-screen terminal dashboard

## Context

The user wants a real terminal UI, launched with `crew tui`, visually matching a reference mockup
(`~/Downloads/Crew — TUI Dashboard.pdf`): a top status bar (live indicator, uptime, agent count,
queue summary, "+ NEW TASK"), a left sidebar (agent list with status dots, a "Protected zones"
list), a tabbed main area (Board / Events / Logs), a kanban board with cards, and a bottom command
bar (`:` search input + keybinding hints). Confirmed: build it with **Ink** (React for terminals)
rather than hand-rolled ANSI, and make it **fully interactive** from the start (new task, approve/
reject, reply to questions), not a read-only viewer first.

This is a new category of thing in this codebase -- the first interactive, full-screen, keyboard-
driven process crew ships (`serve`/`session` are long-running but non-interactive; everything else
is one-shot). It's also the first use of React/JSX anywhere in the monorepo (Wrangler's UI is
plain DOM). And crew ships as a single compiled binary per platform
(`bun build --compile --target=bun-<platform>`, cross-compiled for 5 targets in CI) -- Ink's layout
engine (`yoga-layout`) has to survive that, which is a real, unverified risk, not a formality.

## Step 0 -- verify Ink survives the compiled, cross-compiled binary (gates everything else)

Before building any real component: add `ink` + `react` to `packages/crew/package.json`, add
`"jsx": "react-jsx"` to `packages/crew/tsconfig.json`, write a 10-line "hello world" Ink component,
wire a temporary `crew tui` stub to render it, then run the *exact* release command
(`bun build --compile --target=bun-darwin-arm64 ./bin/crew.ts --outfile /tmp/crew-spike`) and
execute the standalone binary -- confirm it actually renders, not just that `bun run` from source
works. Also try `--target=bun-linux-x64` from this macOS machine (the riskiest case: cross-
compiling *for* a different OS), since that's exactly what CI's release build already does for
every tagged release.

**If it works:** proceed with the real build below. **If it doesn't:** fall back to hand-rolled
ANSI (box-drawing characters + raw escape codes, zero dependencies) for the same layout -- more
code, but guaranteed to survive the compiled binary since it's pure Bun/TS. This decision gets made
from real evidence at this step, not guessed now.

## Architecture (assuming the spike passes)

**No HTTP, no token, no network** -- `crew tui` is a trusted local CLI process, exactly like
`crew status` or any other command. It resolves its project with the *same* `resolveProject()`
already in `bin/crew.ts` (same tiered `--vault`/`--project`/qualified-id/cwd-walk resolution every
other command uses), then reads and writes through the *same* functions the HTTP server and every
other command already call -- no new data-access layer, no duplicated business logic:

- `statusData(c)` (`runner.ts`) -- agents, task counts, review/questions/jobs counts, spend.
- `listTasks(c)` (`tasks.ts`) -- real cards for the board (id, title, status, needs, claimed_by).
- `listQuestions(c)` (`questions.ts`) -- open questions, shown pinned at the top of the Events tab
  (the mockup predates `crew question`; folding it into Events rather than inventing a fifth tab
  keeps the layout close to the reference without a fictional extra pane).
- `readEvents(c, sinceMs)` (`core.ts`) -- Events tab.
- `logs(c, args, out)` (`comms.ts`) -- called directly in-process the way `bin/crew.ts` already
  does for every command; its `out.json` is already the clean `{agent, line}[]` shape -- Logs tab.
- `run(c, argv)` (`commands.ts`) -- every write action (`task new`, `claim`, `verdict ... approve/
  reject`, `question answer`) goes through this, in-process, exactly like `bin/crew.ts`'s normal
  dispatch and the HTTP `/cmd` route both already do. Same single source of truth, third caller.
- `c.config().protected` -- the "Protected zones" sidebar list.
- Live updates: poll these on an interval (~1.5s, close to the server's own 1s tick) and update
  React state -- no WebSocket needed for a local process with direct file access.

**Board columns use crew's real 7 statuses** (inbox/ready/claimed/verify/review/done/blocked), not
the mockup's simplified 4 (OPEN/CLAIMED/VERIFYING/DONE) -- `blocked` is operationally important
(crew.question/task.uncoverable/watcher all feed it) and dropping it to match the mockup pixel-for-
pixel would lose real signal. Columns that are empty just show "0" and no cards, same visual
language as the mockup's counts.

**New directory `packages/crew/src/tui/`:**
- `index.ts` -- `export function runTui(c: Crew): Promise<void>`, called from `bin/crew.ts`.
  Enters Ink's alt-screen render, owns the poll loop, restores the terminal on exit.
- `App.tsx` -- root layout (flexbox via Ink's `<Box>`): TopBar, then a row of Sidebar + main pane,
  then CommandBar. Owns state: active tab, focused index per view, open detail/form, search query,
  polled data.
- `TopBar.tsx`, `Sidebar.tsx`, `Tabs.tsx`, `Board.tsx`, `EventsView.tsx`, `LogsView.tsx`,
  `TaskDetail.tsx` (Approve/Reject when `status=review`, Agree/Disagree when sampled, Claim when
  `ready`), `NewTaskForm.tsx`, `CommandBar.tsx`.
- `theme.ts` -- shared colors matching the reference: near-black background, a red/orange accent
  for live indicators, task ids and the primary action, white/grey text tiers for emphasis levels.

**Keybindings:** `↑↓`/`j k` navigate the focused list; `←→` move between board
columns; `Tab` cycles Board/Events/Logs; `Enter` opens the focused item's detail (or reply, for a
pinned question); `n` opens New Task; `:` opens the command/search bar (filters the current view by
substring); `Esc` closes a detail/form/search; `q` or `Ctrl+C` quits and restores the terminal.

## Other changes

- `bin/crew.ts`: special-case `tui` the same way `serve`/`session` already are (long-running,
  not a one-shot `run()` call) -- resolve the project, call `runTui(c)`.
- `commands.ts`'s `HELP` text: one line for `tui` under Control.
- `packages/crew/package.json`: add `ink`, `react` (+ their types) as real dependencies -- the
  first in this package; `tsconfig.json` gains `"jsx": "react-jsx"`.
- `docs/SPEC.md` / `README.md`: a short paragraph on `crew tui`, noting it's local-only (direct
  file + in-process `run()`, no HTTP/token) and board columns match crew's real statuses.
- `scripts/smoke-test.sh`: a minimal check -- launch `crew tui` against the throwaway vault with
  `q` piped to stdin shortly after start, assert it exits 0 within a timeout (same
  process-lifecycle style as the existing "compiled binary: server starts..." checks) -- proves
  the compiled binary actually boots the TUI without crashing, not full interaction coverage.

## Verification

1. Step 0's spike, on real compiled binaries (darwin-arm64 at minimum, linux-x64 cross-compiled)
   -- must pass before the rest is built.
2. `bun run typecheck` (now exercising JSX) and `bun run smoke` (including the new TUI boot check).
3. Manual, on the real Piped Piper and Second Brain projects: `crew tui --project
   project-piped-piper`, confirm the board shows real tasks, approve/reject a review item, answer
   an open question, create a task, and confirm each write actually lands (same task/question files
   change, same as every other write path this session has been verified against).
4. Ship as a real `packages/crew` change -- full release/deploy cycle (bump wrangler version since
   the binary ships alongside it, tag, release, deploy `bin/crew` + plugin to both live vaults,
   restart the machine service), same as every other crew-core change this session.
