import { describe, expect, it } from 'vitest';
import {
  EXTENSION_NOTIFICATION_LIMITS,
  NotificationRateLimitError,
  PermissionError,
  defineExtension,
} from '../src/index.ts';
import { createMemoryNotifications, loadCommands } from '../src/testing.ts';

const { titleLength, bodyLength, perMinute, perHour } =
  EXTENSION_NOTIFICATION_LIMITS;

describe('createMemoryNotifications', () => {
  it('keeps what the app would show: sanitized text, one-line title', async () => {
    const notifications = createMemoryNotifications();
    expect(
      await notifications.show({
        title: ' Hi\u0000\nthere ',
        body: 'a\r\nb\u202E\tc',
      }),
    ).toBe(true);
    expect(notifications.shown).toEqual([
      { title: 'Hi there', body: 'a\nb c' },
    ]);
  });

  it('rejects an invalid title or body like the engine: limits count characters', async () => {
    const notifications = createMemoryNotifications();
    await expect(
      notifications.show({ title: '😀'.repeat(titleLength), body: '' }),
    ).resolves.toBe(true);
    await expect(
      notifications.show({ title: 'a'.repeat(titleLength + 1), body: '' }),
    ).rejects.toThrow('title');
    await expect(
      notifications.show({ title: 'T', body: 'b'.repeat(bodyLength + 1) }),
    ).rejects.toThrow('body');
    await expect(notifications.show({ title: ' ', body: '' })).rejects.toThrow(
      'title',
    );
    expect(notifications.shown).toHaveLength(1);
  });

  it('throws NotificationRateLimitError over the minute and hour windows, then recovers', async () => {
    let now = 0;
    const notifications = createMemoryNotifications({ now: () => now });
    for (let i = 0; i < perMinute; i += 1) {
      await notifications.show({ title: `n${i}`, body: '' });
    }
    const error = await notifications
      .show({ title: 'over', body: '' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotificationRateLimitError);
    expect(error).toMatchObject({ window: 'minute', limit: perMinute });
    now += 60_000;
    for (let i = 0; i < perHour - perMinute; i += 1) {
      await notifications.show({ title: `m${i}`, body: '' });
      now += 61_000;
    }
    await expect(
      notifications.show({ title: 'over', body: '' }),
    ).rejects.toMatchObject({ window: 'hour', limit: perHour });
    now += 3_600_000;
    await expect(notifications.show({ title: 'ok', body: '' })).resolves.toBe(
      true,
    );
  });

  it('resolves false without using the limit when switched off or unsupported', async () => {
    const notifications = createMemoryNotifications({ enabled: false });
    for (let i = 0; i < perMinute + 2; i += 1) {
      expect(await notifications.show({ title: 't', body: '' })).toBe(false);
    }
    notifications.setEnabled(true);
    notifications.setSupported(false);
    expect(await notifications.show({ title: 't', body: '' })).toBe(false);
    notifications.setSupported(true);
    expect(await notifications.show({ title: 't', body: '' })).toBe(true);
    expect(notifications.shown).toHaveLength(1);
  });

  it('permitted: false rejects with PermissionError(notifications)', async () => {
    const notifications = createMemoryNotifications({ permitted: false });
    await expect(
      notifications.show({ title: 't', body: '' }),
    ).rejects.toBeInstanceOf(PermissionError);
    await expect(
      notifications.show({ title: 't', body: '' }),
    ).rejects.toMatchObject({ permission: 'notifications' });
  });

  it('loaders hand the extension ctx.notifications', async () => {
    const notifications = createMemoryNotifications();
    const loaded = await loadCommands(
      defineExtension({
        activate(ctx) {
          ctx.commands.register('x.ping', async () => {
            await ctx.notifications.show({ title: 'Ping', body: 'pong' });
          });
        },
      }),
      { notifications },
    );
    await loaded.run('x.ping');
    expect(notifications.shown).toEqual([{ title: 'Ping', body: 'pong' }]);
    await loaded.dispose();
  });
});
