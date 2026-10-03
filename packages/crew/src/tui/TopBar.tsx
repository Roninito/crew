// Top status bar, matching the reference mockup: CREW wordmark, live status,
// clock uptime, agent count, queue summary, and a solid + NEW TASK button.
// Queue labels mirror the mockup's simplified columns: OPEN = inbox+ready
// (unstarted), VERIFYING = verify. Labels dim, values bright.
import { Box, Text } from "ink";
import type { Snapshot } from "./data";
import { theme } from "./theme";

function uptime(started?: string): string {
  if (!started) return "";
  const ms = Date.now() - Date.parse(started);
  if (Number.isNaN(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

export function TopBar({ snap, projectId }: { snap: Snapshot; projectId?: string | null }): React.JSX.Element {
  const s = snap.status;
  const running = s.agents.filter((a) => a.state === "running").length;
  const open = (s.tasks.inbox ?? 0) + (s.tasks.ready ?? 0);
  const verifying = s.tasks.verify ?? 0;
  const up = uptime(s.server.started);
  return (
    <Box borderStyle="single" borderColor={theme.faint} paddingX={1} flexShrink={0}>
      <Text bold>CREW</Text>
      <Text color={theme.dim}>{"  │  "}</Text>
      {projectId ? (
        <Text bold color={theme.accent}>
          {projectId}
        </Text>
      ) : (
        <Text color={theme.dim}>ALL PROJECTS</Text>
      )}
      <Text color={theme.dim}>{"  │  "}</Text>
      {s.server.running ? (
        <Text color={theme.live}>● </Text>
      ) : (
        <Text color={theme.faint}>○ </Text>
      )}
      <Text color={theme.dim}>STATUS </Text>
      {s.server.running ? <Text>ONLINE</Text> : <Text color={theme.dim}>OFFLINE</Text>}
      {up ? (
        <>
          <Text color={theme.dim}>{"   "}UPTIME </Text>
          <Text>{up}</Text>
        </>
      ) : null}
      <Text color={theme.dim}>{"   "}AGENTS </Text>
      <Text>
        {running}/{s.agents.length} ACTIVE
      </Text>
      <Text color={theme.dim}>{"   "}QUEUE </Text>
      <Text>
        {open} OPEN
      </Text>
      <Text color={theme.dim}>{" · "}</Text>
      <Text>
        {verifying} VERIFYING
      </Text>
      <Box flexGrow={1} />
      <Text backgroundColor={theme.accent} color="#141417" bold>
        {" + NEW TASK "}
      </Text>
    </Box>
  );
}
