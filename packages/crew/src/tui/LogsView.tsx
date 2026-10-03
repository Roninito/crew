// Logs tab with vertical scrolling.
// Newest lines at the bottom; ↑ scrolls back, ↓ follows the tail.
import { Box, Text } from "ink";
import { matches, type Snapshot } from "./data";
import { computeWindow } from "./ScrollView";
import { theme } from "./theme";

export function filteredLogs(snap: Snapshot, query: string): { agent: string; line: string }[] {
  const lines = snap.logLines.slice(-200);
  return lines.filter((l) => matches(query, l.agent, l.line));
}

export function LogsView({ lines, focus, height }: { lines: { agent: string; line: string }[]; focus: number; height: number }): React.JSX.Element {
  if (!lines.length) return <Text color={theme.faint}>No log entries in the last day.</Text>;
  const win = computeWindow({ available: height, count: lines.length, focusIndex: focus, itemHeight: () => 1 });
  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      {lines.slice(win.start, win.end).map((l, i) => {
        const idx = win.start + i;
        const hot = idx === focus;
        return (
          <Text key={`${idx}`} color={hot ? theme.text : theme.dim} bold={hot} wrap="truncate-end">
            {hot ? "▸ " : "  "}
            {l.agent}: {l.line}
          </Text>
        );
      })}
      {win.end < lines.length ? (
        <Text color={theme.faint}>… {lines.length - win.end} below</Text>
      ) : null}
    </Box>
  );
}
