function parseMinuteOfDay(value, fallback) {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(String(value ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

export function isWithinQuietHours(now = new Date(), quietHours = {}) {
  if (quietHours?.enabled === false) return false;

  const start = parseMinuteOfDay(quietHours?.start, 23 * 60);
  const end = parseMinuteOfDay(quietHours?.end, 8 * 60);
  if (start === end) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

export function reduceProbabilityOvernight(probability, now = new Date()) {
  const value = Number(probability);
  if (!Number.isFinite(value)) return 0;

  const clamped = Math.min(1, Math.max(0, value));
  return now.getHours() < 8 ? clamped * 0.3 : clamped;
}
