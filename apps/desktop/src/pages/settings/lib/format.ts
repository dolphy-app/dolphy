const MS_IN_SECOND = 1000;
const SECONDS_IN_MINUTE = 60;
const MINUTES_IN_HOUR = 60;
const HOURS_IN_DAY = 24;

// Decimal (SI) steps: Intl's `kilobyte`/`megabyte`/`gigabyte` labels are
// SI units, so the divisor has to match them (binary KiB has no Intl unit).
const BYTE_STEP = 1000;
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

export const formatBytes = (bytes: number, locale: string) => {
  let value = bytes;
  let unit = 0;
  while (value >= BYTE_STEP && unit < BYTE_UNITS.length - 1) {
    value /= BYTE_STEP;
    unit++;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: BYTE_UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 || value >= 10 ? 0 : 1,
  }).format(value);
};

const formatUnit = (value: number, unit: string, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  }).format(value);

/** Две старшие ненулевые единицы из дней, часов, минут и секунд. */
export const formatUptime = (uptimeMs: number, locale: string) => {
  const totalSeconds = Math.floor(uptimeMs / MS_IN_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_IN_MINUTE);
  const hours = Math.floor(minutes / MINUTES_IN_HOUR);
  const days = Math.floor(hours / HOURS_IN_DAY);
  const parts: Array<[number, string]> = [
    [days, 'day'],
    [hours % HOURS_IN_DAY, 'hour'],
    [minutes % MINUTES_IN_HOUR, 'minute'],
    [totalSeconds % SECONDS_IN_MINUTE, 'second'],
  ];
  const significant = parts.filter(([value]) => value > 0).slice(0, 2);
  if (significant.length === 0) return formatUnit(0, 'second', locale);
  return significant
    .map(([value, unit]) => formatUnit(value, unit, locale))
    .join(' ');
};
