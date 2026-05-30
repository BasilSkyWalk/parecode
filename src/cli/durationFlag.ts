const UNIT_MS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  s: 1000,
};

export function parseDurationFlag(value: string): number | null {
  const match = value.match(/^(\d+)(d|h|m|s)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  return Date.now() - n * UNIT_MS[unit];
}
