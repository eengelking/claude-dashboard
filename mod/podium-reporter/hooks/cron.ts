// When a cron expression next fires, in the machine's local time (the zone Claude Code reads it in).
// Five fields: minute hour day-of-month month day-of-week, each `*`, a number, a range `a-b`, a list, or
// a step `*/n` or `a-b/n`. Returns null for anything it cannot read, so a schedule it does not understand
// shows no time instead of a wrong one.

function field(text: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[4] ? Number(m[4]) : 1;
    if (step < 1) return null;
    const lo = m[1] ? min : Number(m[2]);
    const hi = m[1] ? max : m[3] ? Number(m[3]) : m[4] ? max : lo;
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function nextCronAt(schedule: string, from: number): number | null {
  const f = schedule.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = field(f[0]!, 0, 59);
  const hour = field(f[1]!, 0, 23);
  const dom = field(f[2]!, 1, 31);
  const month = field(f[3]!, 1, 12);
  const dowRaw = field(f[4]!, 0, 7);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  const dow = new Set([...dowRaw].map((d) => d % 7));
  // Like cron, a day matches when either day field matches if both are restricted.
  const domAny = f[2] === '*';
  const dowAny = f[4] === '*';
  const t = new Date(from);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dayOk = domAny && dowAny ? true : domAny ? dow.has(t.getDay()) : dowAny ? dom.has(t.getDate()) : dom.has(t.getDate()) || dow.has(t.getDay());
    if (month.has(t.getMonth() + 1) && dayOk && hour.has(t.getHours()) && minute.has(t.getMinutes())) return t.getTime();
    t.setMinutes(t.getMinutes() + 1);
  }
  return null;
}
