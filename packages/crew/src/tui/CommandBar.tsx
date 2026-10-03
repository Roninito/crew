// Bottom command bar: search prompt on the left, keybinding hints right-aligned,
// mockup style. While searching the prompt becomes the live filter input.
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { theme } from "./theme";

export type Notice = { ok: boolean; text: string };

export function CommandBar({
  searching,
  query,
  onQuery,
  onDone,
  notice,
  hints,
  prompt = "search tasks, agents, events",
}: {
  searching: boolean;
  query: string;
  onQuery: (q: string) => void;
  onDone: () => void;
  notice: Notice | null;
  hints: string;
  prompt?: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {notice ? (
        <Box paddingX={1}>
          <Text color={notice.ok ? theme.ok : theme.live} wrap="truncate-end">
            {notice.text.split("\n")[0]}
          </Text>
        </Box>
      ) : null}
      <Box borderStyle="single" borderColor={theme.faint} paddingX={1} justifyContent="space-between" columnGap={2} flexShrink={0}>
        {searching ? (
          <Box>
            <Text color={theme.accent} bold>
              {": "}
            </Text>
            <TextInput value={query} onChange={onQuery} onSubmit={onDone} placeholder={prompt} />
          </Box>
        ) : (
          <Box>
            <Text color={theme.accent} bold>
              :
            </Text>
            <Text color={theme.dim}>{"  "}{prompt}</Text>
          </Box>
        )}
        <Text color={theme.dim} wrap="truncate-end">
          {hints}
        </Text>
      </Box>
    </Box>
  );
}
