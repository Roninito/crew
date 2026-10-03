// Left sidebar: numbered AGENTS section with status dots and a
// role·runner sub-line per agent, then the "Protected zones" list.
// Fixed width so the main pane always has a predictable remainder.
// The list is now navigable: the focused agent is highlighted, and
// callers open a detail view on Enter.
import { Box, Text } from "ink";
import type { Snapshot } from "./data";
import { stateColor, stateDot, theme } from "./theme";

export function Sidebar({
  snap,
  focus,
}: {
  snap: Snapshot;
  focus: number;
}): React.JSX.Element {
  const agents = snap.status.agents;
  return (
    <Box flexDirection="column" width={22} flexShrink={0} paddingRight={1}>
      <Text color={theme.accent}>01 // AGENTS</Text>
      <Box flexDirection="column" marginTop={1}>
        {agents.length === 0 ? (
          <Text color={theme.faint}>(none)</Text>
        ) : (
          agents.map((a, idx) => {
            const hot = idx === focus;
            return (
              <Box key={a.name} flexDirection="column" marginTop={1} flexShrink={0}>
                <Box flexShrink={0}>
                  <Text color={stateColor(a.state)}>{stateDot(a.state)} </Text>
                  <Text bold color={hot ? theme.accent : theme.text} wrap="truncate-end">
                    {hot ? "▸ " : "  "}
                    {a.name.toUpperCase()}
                  </Text>
                </Box>
                <Text color={theme.dim} wrap="truncate-end">
                  {"  "}
                  {[a.can[0], a.runner].filter(Boolean).join(" · ")}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
      <Box marginTop={2} flexShrink={0}>
        <Text color={theme.dim}>PROTECTED ZONES</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {snap.protectedZones.length === 0 ? (
          <Text color={theme.faint}>— (none)</Text>
        ) : (
          snap.protectedZones.map((z) => (
            <Text key={z} color={theme.dim} wrap="truncate-end">
              — {z}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
