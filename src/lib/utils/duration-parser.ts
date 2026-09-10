import prettyMs from 'pretty-ms';

const UNIT_TO_MS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
  mo: 2_592_000_000,
  month: 2_592_000_000,
  months: 2_592_000_000,
  y: 31_536_000_000,
  yr: 31_536_000_000,
  yrs: 31_536_000_000,
  year: 31_536_000_000,
  years: 31_536_000_000
};

const DURATION_PATTERN =
  /(?<value>\d{1,7})\s*(?<unit>years?|yrs?|y|months?|mos?|mo|weeks?|w|days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)/gi;

export interface ParsedDuration {
  milliseconds: number;
  pretty: string;
}

export function parseDuration(input: string | null | undefined): ParsedDuration | null {
  if (!input) return null;
  const sanitized = input
    .toLowerCase()
    .replace(/[,]/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) return null;

  const normalized = sanitized.replace(/(?<=\d)(?=[a-z])/gi, ' ');

  let total = 0;
  let match: RegExpExecArray | null;
  const consumed: Array<{ value: number; unit: string }> = [];

  const pattern = new RegExp(DURATION_PATTERN);
  while ((match = pattern.exec(normalized)) !== null) {
    const rawValueText = match.groups?.value;
    const unitText = match.groups?.unit;
    if (!rawValueText || !unitText) continue;
    const rawValue = Number(rawValueText);
    const unitKey = unitText.toLowerCase();
    const multiplier = UNIT_TO_MS[unitKey];
    if (!multiplier) continue;
    total += rawValue * multiplier;
    consumed.push({ value: rawValue, unit: unitKey });
  }

  if (total <= 0 || consumed.length === 0) {
    return null;
  }

  const remainder = normalized.replace(DURATION_PATTERN, ' ').replace(/\s+/g, '').trim();
  if (remainder.length > 0) {
    return null;
  }

  return { milliseconds: total, pretty: prettyMs(total, { verbose: true }) };
}
