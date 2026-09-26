# Wrangler animation plans

| # | Plan | Status |
|---|---|---|
| 001 | [status-console-motion](001-status-console-motion.md) | Done -- executed in the same pass as the ToolwrightTheme visual redesign |

No dependencies between plans yet; this is the first one. Next candidate, noted but out of scope for 001: incremental (diffed) re-rendering per view, which would unblock animating individual row changes (job status transitions, new Review items) without violating the "don't animate high-frequency repaint" rule documented in 001's finding #5.
