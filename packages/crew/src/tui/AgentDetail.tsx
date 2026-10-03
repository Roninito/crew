// Agent detail pane: frontmatter summary, raw agent.md body, memory.md, and
// recent logs. Editing is intentionally CLI-side (crew agent edit / crew agent
// memory) because a full-screen editor inside the raw-mode TUI is unsafe.
import { Box, Text } from "ink";
import { useMemo } from "react";
import type { AgentDetail } from "./data";
import { computeWindow } from "./ScrollView";
import { theme } from "./theme";

const LINE_HEIGHT = 1;

export function AgentDetailView({
  detail,
  height,
  section,
  focusLine,
}: {
  detail: AgentDetail;
  height: number;
  section: number;
  focusLine: number;
}): React.JSX.Element {
  const d = detail.def;
  const summary = useMemo(
    () => [
      `${detail.name.toUpperCase()} · ${d.enabled ? "enabled" : "disabled"}`,
      `runner  ${d.runner} · model ${d.model ?? "-"}`,
      `role    ${d.role ?? "-"}`,
      `can     ${(d.can ?? []).join(", ") || "-"}`,
      `schedule ${d.schedule ?? "-"}`,
      `subs    ${(d.subscribes ?? []).join(", ") || "-"}`,
      `budget  ${d.budget?.daily_usd != null ? `$${d.budget.daily_usd}/day` : "-"}`,
      `wiki    ${(d.wiki ?? []).join(", ") || "-"}`,
    ],
    [detail, d],
  );

  const bodyLines = useMemo(() => detail.raw.split("\n").slice(0, 200), [detail.raw]);
  const memoryLines = useMemo(() => detail.memory.split("\n").slice(0, 200), [detail.memory]);
  const logLines = useMemo(() => detail.logLines.map((l) => `${l.agent}: ${l.line}`).slice(0, 200), [detail.logLines]);

  const sections: { title: string; lines: string[] }[] = [
    { title: "DEFINITION", lines: bodyLines },
    { title: "MEMORY", lines: memoryLines },
    { title: "LOGS", lines: logLines },
  ];

  const current = sections[section] ?? sections[0]!;
  const total = current.lines.length;

  const win = computeWindow({
    available: Math.max(4, height - 5), // header rows + section tabs + margins
    count: total,
    focusIndex: focusLine,
    itemHeight: () => LINE_HEIGHT,
  });

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor={theme.accent} paddingX={1} height={height}>
      <Box flexShrink={0}>
        <Text bold>
          <Text color={theme.accent}>{detail.name.toUpperCase()}</Text>
          <Text> · agent detail</Text>
        </Text>
      </Box>
      <Box flexDirection="column" flexShrink={0} marginTop={1}>
        {summary.map((s, i) => (
          <Text key={i} color={theme.dim} wrap="truncate-end">
            {s}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} columnGap={3} flexShrink={0}>
        {sections.map((s, i) => (
          <Text key={s.title} bold={i === section} color={i === section ? theme.accent : theme.faint}>
            {i === section ? "▸ " : "  "}
            {s.title}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {current.lines.slice(win.start, win.end).map((line, i) => {
          const idx = win.start + i;
          const hot = idx === focusLine;
          return (
            <Text key={`${section}-${idx}`} color={hot ? theme.text : theme.dim} bold={hot} wrap="truncate-end">
              {hot ? "▸ " : "  "}
              {line || " "}
            </Text>
          );
        })}
        {win.end < total ? <Text color={theme.faint}>… {total - win.end} below</Text> : null}
      </Box>
    </Box>
  );
}
