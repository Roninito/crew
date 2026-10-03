// Shared colors for crew tui, matching the reference mockup: near-black background,
// a red/orange accent for live indicators, task ids and the primary action,
// white/grey text tiers for emphasis levels.
export const theme = {
  accent: "#FF5C39",
  live: "#FF3B30",
  ok: "#7AC74F",
  warn: "#E5C07B",
  text: "#FFFFFF",
  dim: "#9A9AA0",
  faint: "#55555C",
  focusBg: "#2A2A30",
  columnBg: "#141417",
} as const;

export const stateColor = (state: string): string => {
  switch (state) {
    case "running":
      return theme.ok;
    case "sleeping":
      return theme.warn;
    case "blocked":
      return theme.live;
    case "disabled":
      return theme.faint;
    default:
      return theme.dim;
  }
};

export const stateDot = (state: string): string => {
  switch (state) {
    case "running":
      return "●";
    case "sleeping":
      return "◐";
    case "blocked":
      return "●";
    case "disabled":
      return "○";
    default:
      return "○";
  }
};
