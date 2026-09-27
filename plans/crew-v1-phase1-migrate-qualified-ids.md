# crew v1, phase 1 — crew migrate (Piped Piper, for real) + qualified IDs

**Status: phase 1 complete.** Qualified IDs shipped as v0.14.0. Piped Piper was migrated for real on 2026-09-27: `crew migrate` stopped its live v0 server, registered it as `project-piped-piper`, dropped `api.port` from its `crew.md`, kept its token. A real machine service (`crew serve`, no `--vault`, backgrounded — not installed as a launchd service) has been dispatching it since, confirmed via real activity (agent sessions, blackboard posts, tasks moving through verify, a `task.blocked`→`planner.request` cycle) and confirmed visually in the Wrangler sidebar after an Obsidian reload — normal, attached, no fallback server spawned. Phase 2 (event propagation) is next, scoped per the correction below.

## Shipped so far

- **Phase 1 ("one service")**: `crew init`, the project registry (`~/.crew/projects.md`), the multi-project machine service (`crew serve` with no `--vault`), `crew projects`/`project add|pause|resume|remove`, `crew service install`. Wrangler wired to call `crew init`.
- **This phase**: `crew migrate <path>` (brings an existing v0 vault into the registry, stops its live server, drops the service-unit file, splits `crew.md`'s settings) and Wrangler attach mode (attaches to a healthy machine service for any vault, auto-migrates an existing un-registered vault, "stop" means pause, new All crews view). Both shipped as v0.13.0. The user's live production vault stayed untouched throughout, verified after each release.

Both proven end to end by `scripts/smoke-test.sh`'s new sections. Wrangler's own Obsidian-side flows have no automated harness in this repo and were verified by direct reasoning about the code plus the already-proven HTTP contract, not by running Obsidian.

## Why qualified IDs, session tokens, and grants — reasoned from what's actually true today

The user asked to reason through this before planning it further, rather than just sequencing it. Here's the honest picture.

**There is currently exactly one channel into the machine service: the human.** Wrangler and a terminal both hold the one machine token and call `/p/<id>/*` or `/cmd`. Nothing else calls the service at all. Specifically:

- `runner.ts`'s `launch()` — the function that starts every agent session, in *either* v0 or machine mode — spawns `crew session <agent> <wakefile>` with `env: { ...process.env, CREW_VAULT: c.vault }`. No token, nothing project-scoped beyond the env var.
- `bin/crew.ts`'s `resolveProject()` checks `--vault`/`CREW_VAULT` *first*, and it always wins outright. So an agent session in a migrated, machine-dispatched project still runs every `crew` command exactly like v0 does: direct file access, zero HTTP, zero network dependency. This was a deliberate simplification made in Phase 1 ("file-tailing already makes it correct") and it's still true after migrate + attach mode.
- Net effect: there is no live path today by which one project's agent could read or touch another project's files — not because anything stops it, but because agents don't talk to the service at all yet, in any project, migrated or not.

So, concretely, what each piece is *for*:

- **Qualified IDs** (`moba:T-0142`) are pure addressing: how anything outside a project names something inside it. They mean nothing until two things need to refer to each other across a project boundary.
- **Session tokens** are how the service would learn *who* is asking (which project, which agent) instead of trusting a claimed name. They matter the moment more than one kind of caller can reach the service — which requires *first* routing agent sessions through it via `CREW_TOKEN` at all. That routing change is bigger and riskier than the auth check itself: it turns every agent session in a migrated project from "touches files directly, no network dependency" into "depends on the shared service being reachable over HTTP." (Flagged as the single biggest risk in the earlier design pass, for exactly this reason.)
- **Grants** are the actual authorization rule (`art` can post to `moba`'s inbox; `studio` can read `brain`), checked against a session token's identity. Meaningless without an identity to check (tokens) or a way to name the target (qualified IDs).

All three exist to serve **one** capability: letting an agent in project A safely ask project B for something, or watch B's events, without a human manually relaying it. That's the only real thing they unlock. Until that's wanted, all three are inert scaffolding.

**Is that capability wanted right now?** Looking at what actually exists:
- Project Piped Piper: still pure v0, not migrated, single-project, no sibling project to talk to.
- This repo (crew's own source): not itself a crew-managed project.
- Second Brain: deferred, and would start as a fresh, independent project — nothing says today that it needs to talk to Piped Piper, or vice versa.

There's no live use case pulling for cross-project coordination yet. That doesn't make it wrong to build — the user may want it built ahead of need, or may already anticipate Second Brain and Piped Piper needing to hand work to each other later — but it's worth saying plainly: **right now this is speculative infrastructure, not a fix for a felt problem.**

**By contrast, the dashboard needs none of this.** Its Projects, Review, Live, and Machine views run entirely off `/projects`, per-project `/status`/`/review`, `/stream`, and `/health` — all of which exist today, for any number of migrated projects, with zero dependency on qualified IDs, tokens, or grants. Only its Links view (showing grants, cross-project requests) is gated on grants existing. The dashboard is useful the moment there's more than one registered project to look at — which is true right now.

## Decision — phased, and narrower than the full design below suggests

This went through two corrections, both worth keeping straight:

1. First: qualified IDs alone, then broadened to "add token and grants to this plan. its all required" — at that point a full implementation-ready design was produced for session tokens + grants (kept below, in "Phase 2 design reference," since it's genuinely useful groundwork, not thrown away).
2. Then, on reflection: **split into two phases, and phase 2 is lighter than that design.** "Session tokens and Grants aren't needed yet ... we may not need this functionality. I really wanted the event propagation but not all the protections and definitely not considering having project A's calling to project B -- but giving agents the ability [to hear] events in other projects to wake certain agents in their own project. We can work on this when we move to phase two."

So, concretely:

- **Phase 1 (this pass, build now):** `crew migrate` on the real Piped Piper vault (validating everything already shipped), plus qualified IDs (cheap, self-contained, no auth implication either way).
- **Phase 2 (deferred, not designed in detail yet, revisit later):** cross-project **event propagation only** -- an agent in one project can subscribe to another registered project's events and wake locally on them. Explicitly **without**: session tokens, grants-as-permission-checks, or cross-project task requests (one project asking another to do work, with origin-stamping and the extra verify-escalation rule). The full session-tokens/grants design below was produced before this correction landed -- keep it as reference for *if* phase 2 ever needs the fuller authorization model, but the actual phase 2 build should start from a much lighter design: likely no tokens at all, since nothing crosses a trust boundary that needs a permission check when it's just "wake on an event I can already see" -- whoever can edit an agent.md's `subscribes` field already has full file access to that project.

## Phase 1 — what gets built now

### Qualified IDs (CLI edge only, no tokens, no enforcement)

Since there's no cross-project *action* yet (no grants), the useful slice is purely ergonomic: let a human on the terminal reference another registered project's item directly, without `--project`, from anywhere. Concretely:

- `registry.ts`: `splitQualified(id): { project: string; local: string } | null` — splits on the first `:`. Task/job ids (`T-0001`, `J-0001`) and agent/project ids (`[a-z0-9-]+`) never contain one, so this is unambiguous on its own; requiring the `project` half to match a *registered* id (checked by the caller) rules out any remaining false positive.
- `bin/crew.ts`: before resolving a project, scan the command's positional args (skipping the command word itself) for the first one that splits into a *registered* project id -- e.g. `crew claim art:T-0311`, `crew task show art:T-0311`, `crew trace art:T-0311`. If found, that project id joins `--project`/`CREW_PROJECT` in `resolveProject`'s priority order (same tier as `--project`, per the original doc: "`--project <id>`, or a qualified ID in the arguments"). The matched arg itself gets its `art:` prefix stripped before the cleaned argv reaches `run()`, so the target project only ever sees its own local id -- exactly like today, no local file or command needs to know qualified ids exist.
- Event stream tagging (`{...ev, project: id}`) already exists from Phase 1 -- nothing new needed there.

`/cmd`'s HTTP body already takes an explicit `project` field (what Wrangler uses); qualified-id parsing in argv is a CLI-terminal convenience layered on top, not a wire-format change.

### Migrate Piped Piper for real

Once qualified IDs ship (typecheck + smoke green, released) — the first time anything in this whole effort touches the live vault beyond swapping in a new binary/plugin build:

1. Run `crew migrate "<Piped Piper path>"` for real. Per `migrate.ts`: stops the vault's current `crew serve --vault` (it's currently running, started by Wrangler), checks for a `scripts/service.sh` unit (none is expected to exist for this vault — confirm, don't assume), registers it, drops `api.port` from its real `crew.md`, keeps its token.
2. Start a real machine service so something actually dispatches it afterward — a plain foreground/background `crew serve` (no `--vault`), the same nohup pattern already used all session for the per-vault server. **Not** `crew service install` (a persistent launchd agent) — that's a further, separate commitment distinct from "migrate it so we know it works."
3. Reconnect Wrangler (already running v0.13.0+, attach-mode logic already shipped) and confirm: no per-vault child spawned, `crew status --project <id>` (or the sidebar) shows the same agents/tasks/spend as before, a wake still works end-to-end. No session tokens exist yet in this phase, so this is exactly the same v0-agent-session behavior as before — the only thing that changed is who's dispatching it.
4. Rollback if anything looks wrong: `crew project pause <id>` (or stop the machine service) and go back to `crew serve --vault <path>` directly — the vault's files are never rewritten by anything here except the one `api.port` line, which doesn't itself block v0 mode once the project isn't *active* in the registry.

## Verification (phase 1)

1. `bun run typecheck` (both packages).
2. `bun run smoke` — full existing suite unchanged, proving v0 and machine-mode paths are provably untouched.
3. New qualified-id assertions: `crew claim art:T-0311`-style resolution against the existing two-project fixture (`proja`/`projb`), confirming it resolves to the right project and the stripped local id reaches the right task/agent; a positional arg that merely *contains* a colon but doesn't match a registered project id is left completely alone.
4. Migrate Piped Piper: manual, on the real vault, following the steps above. No smoke-test equivalent for this one — it's real production infrastructure, already covered mechanically by the throwaway-vault migrate scenario in `scripts/smoke-test.sh`.

## Phase 2 (deferred) — event propagation, lighter than the design below

**Actual phase 2 scope, per the correction**: an agent in one registered project can subscribe to another registered project's events and wake locally — nothing more. No session tokens, no grants-as-permission-checks, no cross-project task requests. The likely shape, sketched lightly (not build-ready — design this properly when phase 2 is actually picked up):

- Qualified `subscribes` entries (`art:asset.ready`) in an agent's `agent.md`, parsed with the same `splitQualified` from phase 1.
- A cross-project fan-out inside the machine service (roughly the `wakeExternal`/`onCrossEvent` shape from the design below), but with **no grant check gating it** — if both projects are registered and the subscribing agent declares the qualified subscribe, that's sufficient. Configuring an agent's `subscribes` field already requires full file access to that project, so there's no new trust boundary being crossed by allowing the wake itself.
- A `link.event` written into the subscribing project's own log, same as below, so its trace stays complete without reading the other project's files directly.
- Everything else in the design below — session tokens, `service.ts`'s tiered auth, the `CREW_TOKEN` HTTP-routing fork in `bin/crew.ts`, `Grant`-typed permissions, cross-project task requests with origin-stamping, the extra verify-escalation rule, multi-hop `trace()` — **stays out** unless a real need for cross-project *action* (not just visibility) shows up later.

### Design reference from before the correction (kept, not being built)

A full implementation-ready design for session tokens + grants was produced before this scope correction landed. It's real, careful work and may be useful if phase 2 ever does need the fuller authorization model — kept here for that possibility, not as the current plan.

#### Session tokens

The precondition for grants: the service needs to know *who* is asking (which project, which agent) before it can check whether that's allowed. Today literally nothing but the human/Wrangler ever calls the service -- `launch()` (which starts every agent session, in v0 *or* machine mode) just sets `CREW_VAULT` in the spawned session's env, and `resolveProject()`'s `--vault`/`CREW_VAULT` branch always wins, so every agent session today still does pure direct-file access, zero network. This block is what changes that, for machine-dispatched projects only -- v0 (`serve(c)`) never mints a token, so anything staying on `--vault` mode is untouched forever, by construction, not by convention.

- **`packages/crew/src/tokens.ts` (new)**: `SessionToken = {token, project, agent, kind: "session"|"job", expires}`. In-memory `Map`, lives only inside the running `serveMachine()` process. `mintToken(project, agent, kind, ttlMs)`, `resolveToken(token)`, `revokeToken(token)`, `revokeAllForProject(project)` (see judgment call below).
- **`runner.ts`'s `launch()`** gains an optional token/project pair, supplied by a new `ProjectRuntimeOpts.mintToken?: (agent: string) => string` that only `serveMachine()`'s `load()` populates (`serve(c)`'s v0 call site supplies nothing, so v0 is unaffected). The spawned session's env gains `CREW_TOKEN`/`CREW_PROJECT` only when a token was actually minted.
- **`jobs.ts`**: `Job` gains `originToken?: string | null` and `originProject?: string | null`, captured in `jobRun` from `process.env.CREW_TOKEN`/`CREW_PROJECT` (i.e. whatever session queued the job) and persisted onto the job record, since `jobExec` runs the actual script in a *separate* spawned process later where the original env doesn't survive -- `jobExec` re-injects them from the job record.
- **`service.ts`'s auth becomes tiered** instead of one flat check: the machine token (from `MachineConfig.api.token`) keeps today's "can touch anything" behavior, unchanged. A session token is scoped to exactly one project -- valid only against `/p/<that-project>/*` and `/cmd` when the target project matches (or, for the cross-project case, when a grant covers it -- see Grants below). `/health` stays open. `/projects` and the aggregate `/status` stay **machine-token-only** (a session token has no reason to see the whole machine's project list).
- **`bin/crew.ts`**: when `process.env.CREW_TOKEN` is set, argv routes through `POST /cmd` on the service instead of local `run(c, argv)` -- the actual enforcement point. Finds the service's port by reading `~/.crew/.state/pid.json` directly (no `Crew` object needed). This fork sits *before* `resolveProject`, and explicitly does **not** apply to the internal `session`/`job exec` re-invocations (already special-cased earlier in `main()`, always local).
- **Why this is safe for everything not migrated**: `CREW_TOKEN` is only ever set by `serveMachine()`'s own dispatch loop. A human's terminal never has it. CI never has it. Any project that stays on `--vault` mode never has it, forever, because `serve(c)`'s call to `createProjectRuntime` never supplies a minter. The only way a project's agent sessions start depending on the service being reachable over HTTP is for that specific project to be migrated *and* the machine service to be what's dispatching it -- exactly the two things the user is about to do deliberately to Piped Piper, as the actual validation being asked for.

#### Grants

- **`registry.ts`**: `Grant = {from, to, events?: string[] | "*", tasks?: "none"|"inbox"|"ready", post?: boolean, read?: boolean, created, by}`, replacing the reserved-but-untyped `Registry.grants: unknown[]`. Direction convention, pinned down explicitly: `crew grant art moba` means **art is granting access to moba** -- so a lookup for "can moba do X to art" is `findGrant("art", "moba")`.
- **`packages/crew/src/grants.ts` (new)**: `findGrant`, `grantAllowsEvent`/`grantAllowsTask`/`grantAllowsRead` predicates, `grantAdd`/`grantRevoke` (merge-patch semantics, one row per `from`/`to` pair, under `withRegistryLock`), `grantsCmd`. CLI: `crew grant <from> <to> [--events a,b|*] [--tasks inbox|ready] [--post] [--read]`, `crew grants`, `crew grant revoke <from> <to>`.
- **Cross-project event fan-out** -- the genuinely new architecture, since today's per-project tick loop has zero cross-project awareness: `ProjectRuntime` gains `wakeExternal` (the existing private wake-queue function, exposed). `ProjectRuntimeOpts` gains `onCrossEvent?: (ev) => void`, fired from inside `onEvent` alongside the existing self-wake logic. New **`packages/crew/src/grants-dispatch.ts`**, holding the `Map<projectId, ProjectRuntime>` view `serveMachine()` already owns: for each event from project P, checks every other project Q's grant from P and its agents' *qualified* subscribes (`art:asset.ready`, parsed via the same `splitQualified` qualified-IDs already introduced), wakes matching agents via `wakeExternal`, and writes a `link.event` into Q's own log via the plain `emit(Q.c, ...)` -- no new primitive needed there.
- **Cross-project task requests**: an agent in `moba`, running under a `moba`-scoped session token, calls `crew task new --project art ...`. Routes through `bin/crew.ts`'s HTTP fork to `POST /cmd {project:"art", ...}`. `service.ts` resolves the token, sees `session.project !== target`, checks `findGrant("art","moba")` covers `tasks`, and -- critically -- builds a small `ctx` (`{project, originProject, originTask, grantTasksTier}`) **from the authenticated token itself, never from client-supplied argv**, and passes it through a new optional third parameter on `commands.ts`'s `run(c, argv, ctx?)` down into `taskNew`. The new task in `art` gets `origin: "moba:T-0142"` stamped server-side, and its status is capped to the grant's `tasks` tier (an `"inbox"`-only grant can never produce an immediately-workable task cross-project, regardless of `--accept`). When that task reaches `done`, the same `grants-dispatch.ts` layer notices (watching for a `task.updated`→`done` transition on a task with a non-null `origin`) and emits a plain, unqualified `link.task.done` into `moba`'s *own* log -- `moba`'s existing tick loop picks it up locally, no new wake primitive needed for that half.
- **`agents.ts`'s `lintAgent`**: a qualified `subscribes` entry now gets checked -- unregistered target project, or no grant covering it, is a lint **error** (not a warning), since an agent that looks configured but structurally can never fire is actively misleading.
- **`verify.ts`**: `t.protected` keeps its existing, unconditional, un-touched-by-any-of-this escalation rule. `trace()` becomes multi-hop -- follows a task's `origin` backward and any `link.event`/`link.task.done` rows forward into other projects' own event logs (each hop re-resolved to its own `Crew`), gated by a `read` grant when hopping under a session token's authority (a human's own local `trace()` already has file access to anywhere they can `--project` into, so isn't re-gated). Terminates via a visited-set plus a hard hop cap, so a circular read-grant pair can't loop forever.

**Confirmed**: `verify.ts`'s `policyFor()` additionally forces human sign-off on a cross-project-originated task's *first* verify pass (`t.origin` set, `!t.verified_by`), regardless of that task type's earned-trust tier -- independent of, and in addition to, the existing unconditional `protected` rule. Only the first pass; once a human has signed off once, later resubmissions of that same task (e.g. after a rejection) go back through the normal earned-trust tier for its type.

**Decided judgment calls, kept for reference** (documented, not re-asked, only relevant if this design gets revived): job-token revocation is TTL-based (a job runs in a separate OS process, so there's no cheap direct-revoke hook; `grants-dispatch` best-effort revokes on `job.succeeded`/`failed`/`timeout`, TTL is the backstop) -- `crew project pause`/`remove` would also call `revokeAllForProject` so a paused/removed project's live tokens die immediately, not just on expiry; the cross-project `/cmd` allowlist is exactly `task.new` and `post` (matching the `Grant` type's own fields -- `emit` deliberately excluded, a bigger surface than anything modeled); grant checks live centrally in `service.ts`'s `/cmd` gate, not re-checked inside individual commands, for one auditable boundary; a `read` grant only gates a session token's `trace()` hop, never a human's own local trace; `link.task.done` delivery back to the requester is unconditional (hearing the outcome of your own request isn't a new trust boundary); `originTask`'s provenance is trusted from the caller's own already-authenticated project without an extra re-validation query (low stakes, can harden later); a job queued via the raw machine token still gets a project-scoped `CREW_TOKEN` minted for it (strictly less powerful than the machine token, harmless).

## Deferred (unchanged)

- Session tokens, grants-as-permission-checks, cross-project task requests, and everything else in the "Design reference" section above beyond plain event propagation -- superseded by the phase-2 correction, kept only as reference.
- Porting rbots' Second Brain agents into a new crew inside the Second Brain vault, using `crew init` + Wrangler's attach flow as a real-world test case — plus adding crew's own built-in agents (verifier, planner, scout, devops, watcher) there too.
- Renaming the per-project folder from `crew/` to `.crew/` so it's hidden in Finder/Obsidian's file explorer.
- Machine-wide lock/budget/session-cap enforcement.
- `/mcp` endpoint.
