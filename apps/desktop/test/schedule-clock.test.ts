import { describe, expect, it } from 'vitest';
import { scheduleClockOf } from '../electron/main/schedule-clock.ts';

describe('scheduleClockOf', () => {
  it('в несобранном приложении берёт период и смещение часов из окружения; смещение может быть отрицательным', () => {
    expect(
      scheduleClockOf(
        { DOLPHY_SCHEDULE_TICK_MS: '100', DOLPHY_CLOCK_OFFSET_MS: '-3600000' },
        false,
      ),
    ).toEqual({ scheduleTickMs: 100, scheduleClockOffsetMs: -3_600_000 });
    expect(scheduleClockOf({ DOLPHY_SCHEDULE_TICK_MS: '250' }, false)).toEqual({
      scheduleTickMs: 250,
    });
    expect(scheduleClockOf({}, false)).toEqual({});
  });

  it('в собранном приложении ничего не действует', () => {
    expect(
      scheduleClockOf(
        { DOLPHY_SCHEDULE_TICK_MS: '100', DOLPHY_CLOCK_OFFSET_MS: '5' },
        true,
      ),
    ).toEqual({});
  });

  it.each(['', 'abc', '1.5', '1e3', '12px', ' 100'])(
    'неверное значение %j игнорируется',
    (value) => {
      expect(
        scheduleClockOf(
          { DOLPHY_SCHEDULE_TICK_MS: value, DOLPHY_CLOCK_OFFSET_MS: value },
          false,
        ),
      ).toEqual({});
    },
  );

  it('период короче 10 мс игнорируется: опрашивать чаще незачем', () => {
    expect(scheduleClockOf({ DOLPHY_SCHEDULE_TICK_MS: '9' }, false)).toEqual(
      {},
    );
    expect(scheduleClockOf({ DOLPHY_SCHEDULE_TICK_MS: '10' }, false)).toEqual({
      scheduleTickMs: 10,
    });
  });
});
