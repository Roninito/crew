// Minimal 5-field cron matcher: minute hour day-of-month month day-of-week.
// Supports *, */n, a-b, a-b/n and comma lists.
function fieldMatches(expr: string, value: number, min: number, max: number): boolean {
  return expr.split(",").some((part) => {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    let lo = min;
    let hi = max;
    if (range && range !== "*") {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = b !== undefined ? Number(b) : stepStr ? max : lo;
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || !step) return false;
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

export function cronMatches(expr: string, d: Date): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  return (
    fieldMatches(f[0]!, d.getMinutes(), 0, 59) &&
    fieldMatches(f[1]!, d.getHours(), 0, 23) &&
    fieldMatches(f[2]!, d.getDate(), 1, 31) &&
    fieldMatches(f[3]!, d.getMonth() + 1, 1, 12) &&
    fieldMatches(f[4]!, d.getDay(), 0, 6)
  );
}
