// All-projects overview with vertical scrolling when project cards overflow.
import { Box, Text } from "ink";
import type { ProjectOverview } from "./data";
import { computeWindow } from "./ScrollView";
import { theme } from "./theme";

const ITEM_HEIGHT = 6; // top line + 2 summary lines + 2 box borders + margin

function needsYou(p: ProjectOverview): number | null {
  if (!p.snap) return null;
  const s = p.snap.status;
  return s.review + (s.tasks.blocked ?? 0) + s.questions;
}

function taskSummary(p: ProjectOverview): string {
  if (!p.snap) return "";
  const counts = p.snap.status.tasks;
  const parts = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`);
  return parts.length ? parts.join(" · ") : "no tasks";
}

export function ProjectsView({ items, focus, height }: { items: ProjectOverview[]; focus: number; height: number }): React.JSX.Element {
  if (!items.length) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text color={theme.accent}>01 // PROJECTS</Text>
        <Text color={theme.dim}>No registered projects. Run "crew init" or "crew migrate &lt;path&gt;" to add one.</Text>
      </Box>
    );
  }
  const win = computeWindow({ available: Math.max(4, height - 1), count: items.length, focusIndex: focus, itemHeight: () => ITEM_HEIGHT });
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} height={height}>
      <Text color={theme.accent}>
        01 // PROJECTS <Text color={theme.dim}>{String(items.length).padStart(2, "0")}</Text>
      </Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={0}>
        {items.slice(win.start, win.end).map((p, i) => {
          const idx = win.start + i;
          const hot = idx === focus;
          if (!p.snap) {
            return (
              <Box key={p.entry.id} flexDirection="column" marginTop={1} flexShrink={0}>
                <Text color={hot ? theme.accent : theme.text} bold={hot} wrap="truncate-end">
                  {hot ? "▸ " : "  "}
                  {p.entry.id}
                </Text>
                <Text color={theme.live} wrap="truncate-end">
                  {"    "}couldn't load: {p.error}
                </Text>
              </Box>
            );
          }
          const s = p.snap.status;
          const running = s.agents.filter((a) => a.state === "running").length;
          const openQ = p.snap.questions.filter((q) => q.status === "open").length;
          const need = needsYou(p) ?? 0;
          return (
            <Box
              key={p.entry.id}
              flexDirection="column"
              marginTop={1}
              flexShrink={0}
              borderStyle="single"
              borderColor={hot ? theme.accent : theme.faint}
              paddingX={1}
              height={ITEM_HEIGHT - 1} // marginTop accounts for the last row
            >
              <Box columnGap={2} flexShrink={0}>
                <Text color={hot ? theme.accent : theme.text} bold wrap="truncate-end">
                  {hot ? "▸ " : "  "}
                  {p.entry.id}
                </Text>
                {s.server.running ? <Text color={theme.live}>● live</Text> : <Text color={theme.faint}>○ down</Text>}
                <Text color={theme.dim} wrap="truncate-end">
                  {p.entry.kind} · {p.entry.path}
                </Text>
              </Box>
              <Box columnGap={2} flexShrink={0}>
                <Text wrap="truncate-end">agents {running}/{s.agents.length}</Text>
                <Text color={theme.dim} wrap="truncate-end">{taskSummary(p)}</Text>
              </Box>
              <Box columnGap={2} flexShrink={0}>
                <Text color={need > 0 ? theme.accent : theme.dim} wrap="truncate-end">
                  needs you {need} ({s.review} review · {openQ} questions)
                </Text>
                <Text color={theme.dim}>${s.spend.toFixed(2)}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      {win.end < items.length ? (
        <Text color={theme.faint}>… {items.length - win.end} below</Text>
      ) : null}
    </Box>
  );
}
