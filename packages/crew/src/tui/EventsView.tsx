// Events tab with vertical scrolling when rows overflow.
// Open questions pinned at the top, then recent events newest-first.
import { Box, Text } from "ink";
import type { Snapshot } from "./data";
import { matches } from "./data";
import { computeWindow } from "./ScrollView";
import { theme } from "./theme";

export type EventRow =
  | { kind: "question"; id: string; label: string; sub: string }
  | { kind: "event"; id: string; label: string; sub: string };

export function eventRows(snap: Snapshot, query: string): EventRow[] {
  const rows: EventRow[] = [];
  for (const q of snap.questions.filter((q) => q.status === "open")) {
    if (!matches(query, q.id, q.topic, q.agent)) continue;
    rows.push({ kind: "question", id: q.id, label: `? ${q.id} ${q.topic}`, sub: `asked by ${q.agent} · Enter to reply` });
  }
  const evs = [...snap.events].reverse();
  for (const e of evs) {
    if (!matches(query, e.type, e.by, e.task, e.agent)) continue;
    rows.push({
      kind: "event",
      id: e.id,
      label: `${e.ts.slice(11, 19)} ${e.type} ${e.by}${e.task ? ` [[${e.task}]]` : ""}`,
      sub: e.data ? JSON.stringify(e.data).slice(0, 100) : "",
    });
  }
  return rows;
}

const ROW_HEIGHT = (r: EventRow): number => (r.sub ? 2 : 1);

export function EventsView({ rows, focus, height }: { rows: EventRow[]; focus: number; height: number }): React.JSX.Element {
  if (!rows.length) return <Text color={theme.faint}>No events or open questions.</Text>;
  const win = computeWindow({ available: height, count: rows.length, focusIndex: focus, itemHeight: (i) => ROW_HEIGHT(rows[i]!) });
  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      {rows.slice(win.start, win.end).map((r, i) => {
        const idx = win.start + i;
        const hot = idx === focus;
        return (
          <Box key={`${r.kind}-${r.id}`} flexDirection="column" flexShrink={0}>
            <Text color={hot ? theme.accent : r.kind === "question" ? theme.warn : theme.text} bold={hot} wrap="truncate-end">
              {hot ? "▸ " : "  "}
              {r.label}
            </Text>
            {r.sub ? (
              <Text color={theme.faint} wrap="truncate-end">
                {"    "}
                {r.sub}
              </Text>
            ) : null}
          </Box>
        );
      })}
      {win.end < rows.length ? (
        <Text color={theme.faint} wrap="truncate-end">… {rows.length - win.end} below</Text>
      ) : null}
    </Box>
  );
}
