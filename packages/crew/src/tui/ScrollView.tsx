// Scrollable viewport for tall content (board, events, logs, projects).
// Ink's flex layout can't express "max-height N, scroll if taller", so we
// render children inside a fixed-height Box and clip with a window over the
// data. focusIndex is the item the user is on; itemHeights should be a function
// returning rows per item. Returns the window [start, end) and the focused
// item's screen offset so callers don't have to know about Yoga overflow.
import { Box, type BoxProps } from "ink";

export function computeWindow({
  available,
  count,
  focusIndex,
  itemHeight,
}: {
  available: number;
  count: number;
  focusIndex: number;
  itemHeight: (i: number) => number;
}): { start: number; end: number; offset: number } {
  if (available <= 0 || count === 0) return { start: 0, end: 0, offset: 0 };
  // Greedy fit: keep the focused item in view.
  let start = 0;
  let end = 0;
  let used = 0;
  let focusStartRows = 0;
  for (let i = 0; i < count; i++) {
    const h = itemHeight(i);
    if (i < focusIndex) focusStartRows += h;
    if (i < start) continue;
    if (used + h > available) break;
    used += h;
    end = i + 1;
  }
  // If focus is below the window, scroll down.
  while (focusIndex >= end) {
    used -= itemHeight(start);
    start++;
    end = start;
    used = 0;
    for (let i = start; i < count; i++) {
      const h = itemHeight(i);
      if (used + h > available) break;
      used += h;
      end = i + 1;
      if (end > focusIndex) break;
    }
  }
  // If focus is above the window, scroll up.
  while (focusIndex < start) {
    start = Math.max(0, start - 1);
    end = start;
    used = 0;
    for (let i = start; i < count; i++) {
      const h = itemHeight(i);
      if (used + h > available) break;
      used += h;
      end = i + 1;
    }
  }
  return { start, end, offset: focusStartRows };
}

export function ScrollBox({
  height,
  children,
}: {
  height: number;
  children: React.ReactNode;
} & BoxProps): React.JSX.Element {
  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      {children}
    </Box>
  );
}
