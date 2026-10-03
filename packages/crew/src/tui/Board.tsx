// Board view with vertical-only scrolling per column.
// Columns stay in a single horizontal band and fill the available width.
// Each column scrolls its own cards vertically; focus moves within the
// visible window. On very narrow terminals where 7 readable columns won't
// fit, we show a hint instead of wrapping/corrupting the layout.
import { Box, Text } from "ink";
import { STATUSES, type Task } from "../tasks";
import { matches } from "./data";
import { computeWindow } from "./ScrollView";
import { theme } from "./theme";

const pad = (n: number): string => String(n).padStart(2, "0");
const CARD_HEIGHT = 4; // id + title + @owner + top/bottom border rows
const MIN_COL_WIDTH = 14;
const GAP = 1;
const STATUSES_COUNT = STATUSES.length;

export function boardColumns(tasks: Task[], query: string): Task[][] {
  return STATUSES.map((s) => tasks.filter((t) => t.status === s && matches(query, t.id, t.title, t.claimed_by)));
}

export function Board({
  columns,
  col,
  row,
  width,
  height,
}: {
  columns: Task[][];
  col: number;
  row: number;
  width: number;
  height: number;
}): React.JSX.Element {
  const totalGap = (STATUSES_COUNT - 1) * GAP;
  const minNeeded = STATUSES_COUNT * MIN_COL_WIDTH + totalGap;
  if (width < minNeeded) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center" height={height}>
        <Text color={theme.dim}>Board needs {minNeeded} columns; this terminal is {width} wide.</Text>
        <Text color={theme.faint}>Widen the window or use Tab to switch to Events/Logs.</Text>
      </Box>
    );
  }
  // Distribute leftover space evenly so columns fill the band precisely.
  const base = Math.floor((width - totalGap) / STATUSES_COUNT);
  const remainder = (width - totalGap) % STATUSES_COUNT;
  const colWidth = (i: number): number => base + (i < remainder ? 1 : 0);
  const usable = Math.max(4, height - 1); // header row

  return (
    <Box flexDirection="row" flexGrow={1} columnGap={1} height={height} flexShrink={0}>
      {STATUSES.map((s, i) => {
        const cards = columns[i] ?? [];
        const focused = i === col;
        const win = computeWindow({ available: usable, count: cards.length, focusIndex: row, itemHeight: () => CARD_HEIGHT });
        return (
          <Box key={s} flexDirection="column" width={colWidth(i)} flexShrink={0} height={height}>
            <Box justifyContent="space-between" flexShrink={0} height={1}>
              <Text color={focused ? theme.text : theme.dim} bold={focused} wrap="truncate-end">
                {s.toUpperCase()}
              </Text>
              <Text color={theme.dim}>{pad(cards.length)}</Text>
            </Box>
            <Box flexDirection="column" flexGrow={1} flexShrink={0} height={usable}>
              {cards.slice(win.start, win.end).map((t, idx) => {
                const r = win.start + idx;
                const hot = focused && r === row;
                return (
                <Box
                    key={t.id}
                    flexDirection="column"
                    flexShrink={0}
                    borderStyle="single"
                    borderColor={hot ? theme.accent : theme.faint}
                    backgroundColor={theme.columnBg}
                    paddingX={1}
                    height={CARD_HEIGHT}
                    marginTop={idx === 0 ? 0 : 1}
                  >
                    <Text color={theme.accent} wrap="truncate-end">
                      {hot ? "▸ " : "  "}{t.id}
                    </Text>
                    <Text wrap="truncate-end">{t.title}</Text>
                    <Text color={theme.dim} wrap="truncate-end">{t.claimed_by ? `@${t.claimed_by}` : " "}</Text>
                  </Box>
                );
              })}
            </Box>
            {win.end < cards.length ? (
              <Text color={theme.faint} wrap="truncate-end">
                … {cards.length - win.end} below
              </Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
