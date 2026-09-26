# Board

The board is a view over the notes in `crew/tasks/`. Open it with the command **Wrangler: Open board** (Cmd/Ctrl+P, then search "board"), or run `crew task list` in a terminal.

Columns: Inbox, Ready, Claimed, Verify, Review, Done, Blocked. A task with no acceptance criteria stays in Inbox -- give it at least one with **New task** and it becomes Ready for an agent to claim.

**New task**, on the board or from the command palette (**Wrangler: Create task**), goes through the same `crew task new` command a terminal would run -- it's not a lesser or separate path. A task made this way is just as valid as one made from the CLI.

Don't edit task notes by hand. Use the board or the `crew` CLI so crew stays the single writer -- a hand edit to a task file isn't tracked as an event and can be silently overwritten by the next crew command that touches it.
