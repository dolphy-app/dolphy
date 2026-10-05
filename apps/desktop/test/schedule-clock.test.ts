import { describe, expect, it } from 'vitest';
import { createOffsetClock } from '../electron/host/schedule-clock.ts';
import { scheduleClockOf } from '../electron/main/schedule-clock.ts';

describe('scheduleClockOf', () => {
  it('в несобранном приложении берёт период и файл смещения часов из окружения', () => {
    expect(
      scheduleClockOf(
        {
          DOLPHY_SCHEDULE_TICK_MS: '100',
          DOLPHY_CLOCK_OFFSET_FILE: '/tmp/clock-offset',
        },
        false,
      ),
    ).toEqual({
      scheduleTickMs: 100,
      scheduleClockOffsetFile: '/tmp/clock-offset',
    });
    expect(scheduleClockOf({ DOLPHY_SCHEDULE_TICK_MS: '250' }, false)).toEqual({
      scheduleTickMs: 250,
    });
    expect(scheduleClockOf({}, false)).toEqual({});
  });

  it('в собранном приложении ничего не действует', () => {
    expect(
      scheduleClockOf(
        {
          DOLPHY_SCHEDULE_TICK_MS: '100',
          DOLPHY_CLOCK_OFFSET_FILE: '/tmp/clock-offset',
        },
        true,
      ),
    ).toEqual({});
  });

  it.each(['', 'abc', '1.5', '1e3', '12px', ' 100'])(
    'неверный период %j игнорируется',
    (value) => {
      expect(
        scheduleClockOf({ DOLPHY_SCHEDULE_TICK_MS: value }, false),
      ).toEqual({});
    },
  );

  it('пустой путь к файлу игнорируется', () => {
    expect(scheduleClockOf({ DOLPHY_CLOCK_OFFSET_FILE: '' }, false)).toEqual(
      {},
    );
  });

  it('период короче 10 мс игнорируется: опрашивать чаще незачем', () => {
    expect(scheduleClockOf({ DOLPHY_SCHEDULE_TICK_MS: '9' }, false)).toEqual(
      {},
    );
    expect(scheduleClockOf({ DOLPHY_SCHEDULE_TICK_MS: '10' }, false)).toEqual({
      scheduleTickMs: 10,
    });
  });
});

describe('createOffsetClock', () => {
  const clockOver = (files: Map<string, string>, now: () => number) =>
    createOffsetClock('/clock', {
      now,
      read: (file) => {
        const text = files.get(file);
        if (text === undefined) throw new Error('ENOENT');
        return text;
      },
    });

  it('системное время плюс смещение из файла, которое может быть отрицательным; файл перечитывается при каждом вызове', () => {
    const files = new Map([['/clock', '5000\n']]);
    let now = 1_000_000;
    const clock = clockOver(files, () => now);
    expect(clock()).toBe(1_005_000);
    now += 250;
    expect(clock()).toBe(1_005_250);
    files.set('/clock', '-3600000');
    expect(clock()).toBe(now - 3_600_000);
  });

  it('файла ещё нет — часы системные; его появление сдвигает их', () => {
    const files = new Map<string, string>();
    const clock = clockOver(files, () => 42);
    expect(clock()).toBe(42);
    files.set('/clock', '100');
    expect(clock()).toBe(142);
  });

  it.each(['', 'abc', '1.5', '1e3', '12px'])(
    'в файле %j не число: действует прежнее смещение',
    (text) => {
      const files = new Map([['/clock', '700']]);
      const clock = clockOver(files, () => 0);
      expect(clock()).toBe(700);
      files.set('/clock', text);
      expect(clock()).toBe(700);
    },
  );

  it('файл пропал: действует прежнее смещение', () => {
    const files = new Map([['/clock', '700']]);
    const clock = clockOver(files, () => 0);
    expect(clock()).toBe(700);
    files.delete('/clock');
    expect(clock()).toBe(700);
  });
});
