// crew tui entry point. Called from bin/crew.ts like serve/session: the project is
// already resolved, so this owns the Ink render and the poll loop lives in App.
// Ink restores the terminal on exit (q or Ctrl+C).
import { render } from "ink";
import { type Crew, CrewError } from "../core";
import { App } from "./App";

export async function runTui(c: Crew | null): Promise<void> {
  // Ink drives the TUI through stdin in raw mode, which only a real terminal
  // supports -- piped stdin would die in a raw-mode stack trace instead.
  if (!process.stdin.isTTY) {
    throw new CrewError("crew tui needs an interactive terminal. Run it directly in a terminal, not through a pipe.");
  }
  const app = render(<App initial={c} />);
  await app.waitUntilExit();
}
