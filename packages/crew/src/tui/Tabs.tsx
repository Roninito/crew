// Tab strip over the main pane: numbered 02-04 like the mockup (01 is the
// agent sidebar). The open-questions count rides on Events (no fictional pane).
import { Box, Text } from "ink";
import type { Snapshot } from "./data";
import { theme } from "./theme";

export const TABS = ["Board", "Events", "Logs"] as const;
export type Tab = (typeof TABS)[number];

const pad = (n: number): string => String(n).padStart(2, "0");

export function Tabs({ snap, active }: { snap: Snapshot; active: number }): React.JSX.Element {
  const openQ = snap.questions.filter((q) => q.status === "open").length;
  const counts = [snap.tasks.length, openQ + snap.events.length, snap.logLines.length];
  return (
    <Box paddingX={1} columnGap={3} flexShrink={0}>
      {TABS.map((t, i) => (
        <Text key={t} color={i === active ? theme.text : theme.faint} bold={i === active} underline={i === active}>
          0{i + 2} // {t.toUpperCase()}{" "}
          <Text color={i === active ? theme.accent : theme.faint}>{pad(counts[i] ?? 0)}</Text>
        </Text>
      ))}
    </Box>
  );
}
