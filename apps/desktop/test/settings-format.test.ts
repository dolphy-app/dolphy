import { describe, expect, it } from 'vitest';
import { formatBytes, formatUptime } from '@/pages/settings/lib/format.ts';

const unit =
  (locale: string, name: string, display: 'short' | 'narrow') =>
  (value: number, maximumFractionDigits = 0) =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: name,
      unitDisplay: display,
      maximumFractionDigits,
    }).format(value);

describe.each(['ru', 'en'])('formatBytes (%s)', (locale) => {
  it('stays in bytes below 1000', () => {
    expect(formatBytes(999, locale)).toBe(unit(locale, 'byte', 'short')(999));
  });

  it('switches to kilobytes at 1000 with one decimal under 10', () => {
    const kb = unit(locale, 'kilobyte', 'short');
    expect(formatBytes(1000, locale)).toBe(kb(1, 1));
    expect(formatBytes(1500, locale)).toBe(kb(1.5, 1));
  });

  it('drops decimals from 10 and up', () => {
    const mb = unit(locale, 'megabyte', 'short');
    expect(formatBytes(12_400_000, locale)).toBe(mb(12));
  });

  it('caps at gigabytes', () => {
    const gb = unit(locale, 'gigabyte', 'short');
    expect(formatBytes(5_000_000_000_000, locale)).toBe(gb(5000));
  });
});

describe.each(['ru', 'en'])('formatUptime (%s)', (locale) => {
  const ms = (d: number, h: number, m: number, s: number) =>
    (((d * 24 + h) * 60 + m) * 60 + s) * 1000;
  const part = (name: string, value: number) =>
    unit(locale, name, 'narrow')(value);

  it('formats zero as zero seconds', () => {
    expect(formatUptime(0, locale)).toBe(part('second', 0));
    expect(formatUptime(999, locale)).toBe(part('second', 0));
  });

  it('shows a single part when the rest is zero', () => {
    expect(formatUptime(ms(0, 0, 0, 45), locale)).toBe(part('second', 45));
  });

  it('keeps the two most significant non-zero parts', () => {
    expect(formatUptime(ms(0, 2, 5, 30), locale)).toBe(
      `${part('hour', 2)} ${part('minute', 5)}`,
    );
    expect(formatUptime(ms(3, 4, 5, 6), locale)).toBe(
      `${part('day', 3)} ${part('hour', 4)}`,
    );
  });

  it('skips zero parts in between', () => {
    expect(formatUptime(ms(1, 0, 0, 7), locale)).toBe(
      `${part('day', 1)} ${part('second', 7)}`,
    );
  });
});
