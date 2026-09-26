# Working on crew

Guidance for coding agents (Claude Code, Copilot CLI) working in this repo.

- The spec is `docs/SPEC.md`. Read the relevant section before changing behavior, and update the spec in the same change when behavior changes.
- Bun and TypeScript strict everywhere. Python only for job helpers and job scripts. Bash only for file and folder setup scripts with simple arguments.
- Every CLI command goes through `packages/crew/src/commands.ts` so the CLI and HTTP API behave the same. Add new commands there and to `HELP`.
- Commands that change shared state run under `withMutex`. Never nest `withMutex`, and never hold it during long work (jobs, audits, agent sessions).
- Shared state is files under `crew/` in the vault. Machine-only state goes in `crew/.state/`. Don't add a database.
- Every state change emits an event with `emit()`. Events carry the task ID when there is one, so traces stay complete.
- User-facing messages are plain sentences that say what happened and what to do next.
- Before finishing: `bun run typecheck` and `bun run smoke` must pass. Add a smoke test step for new crew CLI behavior.
- Wrangler's own logic that doesn't need the `obsidian` module lives in `packages/wrangler/src/lib.ts`, covered by `bun run test:wrangler` (plain `bun:test`, no Obsidian mocking). Add cases there for new pure logic; things that genuinely need `this.app` stay in `main.ts` and are exercised by hand in a real vault.
