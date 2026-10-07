import { describe, expect, it, vi } from 'vitest';
import type {
  CommandResultDto,
  ContributionsDto,
  ExtensionCommandFailureReason,
} from '@dolphy-app/engine-contract';
import { EngineCallError } from '@dolphy-app/engine-rpc/client';
import { describeCommandFailure } from '@/features/extension-commands/lib/failure.ts';
import { createNotices } from '@/features/extension-commands/model/notices.ts';
import {
  createPanelProps,
  panelKey,
} from '@/features/extension-commands/model/panel-props.ts';
import {
  CommandRejected,
  createCommandRunner,
} from '@/features/extension-commands/model/runner.ts';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';

const withExtension = (
  panels: string[] = ['acme.cmd.main'],
): ContributionsDto => ({
  ...NO_CONTRIBUTIONS,
  commands: ['acme.cmd.run', 'acme.cmd.hidden'].map((id) => ({
    id,
    extensionId: 'acme.cmd',
    title: id,
    description: null,
    category: null,
    keybinding: null,
    keybindings: [],
    when: null,
    palette: id === 'acme.cmd.run',
    icon: 'puzzle',
  })),
  panels: panels.map((id) => ({
    id,
    extensionId: 'acme.cmd',
    title: id,
    icon: 'puzzle',
    when: null,
    rendererUrl: 'dolphy-ext://acme.cmd/panel.mjs',
    origin: 'user',
    revision: 'r1',
  })),
});

const failure = (
  reason: ExtensionCommandFailureReason,
  message = 'engine said',
) =>
  new EngineCallError({
    code: 'EXTENSION_COMMAND_FAILED',
    message,
    retryable: reason === 'timeout' || reason === 'host-down',
    details: { extensionId: 'acme.cmd', commandId: 'acme.cmd.run', reason },
  });

const setup = (
  result: CommandResultDto | Error = { kind: 'none' },
  contributions: ContributionsDto = withExtension(),
) => {
  const state = { contributions };
  const invokeCommand = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const notices = createNotices();
  const panelProps = createPanelProps();
  const openPanel = vi.fn();
  const runner = createCommandRunner({
    engine: { invokeCommand },
    contributions: () => state.contributions,
    notices,
    panelProps,
    openPanel,
  });
  return { runner, invokeCommand, notices, panelProps, openPanel, state };
};

describe('describeCommandFailure', () => {
  it.each([
    ['unknown-command', 'changed'],
    ['disabled', 'changed'],
    ['replaced', 'changed'],
    ['timeout', 'timeout'],
    ['activation-timeout', 'activationTimeout'],
    ['host-down', 'hostDown'],
    ['invalid-result', 'invalidResult'],
    ['handler-failed', 'failed'],
  ] as const)('причина %s → %s', (reason, kind) => {
    expect(describeCommandFailure(failure(reason, 'text'))).toEqual({
      kind,
      message: 'text',
    });
  });

  it('чужие ошибки и коды движка — failed с текстом как данные', () => {
    expect(describeCommandFailure(new Error('x'))).toEqual({
      kind: 'failed',
      message: 'x',
    });
    expect(
      describeCommandFailure(
        new EngineCallError({
          code: 'INTERNAL',
          message: 'm',
          retryable: true,
        }),
      ),
    ).toEqual({ kind: 'failed', message: 'm' });
    expect(describeCommandFailure('строка')).toEqual({
      kind: 'failed',
      message: 'строка',
    });
  });
});

describe('исполнитель команд: эффекты результата', () => {
  it('notify: текст уходит в уведомление приложения как есть, значения нет', async () => {
    const { runner, notices } = setup({
      kind: 'notify',
      text: '<b>серия</b> 3',
    });
    await expect(
      runner.run('acme.cmd', 'acme.cmd.run', undefined, 'palette'),
    ).resolves.toBeUndefined();
    expect(notices.current.value?.notice).toEqual({
      kind: 'notify',
      text: '<b>серия</b> 3',
    });
  });

  it('openPanel: свойства сохраняются по ключу панели, переход выполняется', async () => {
    const { runner, panelProps, openPanel } = setup({
      kind: 'openPanel',
      panelId: 'acme.cmd.main',
      props: { from: 'command' },
    });
    await runner.run('acme.cmd', 'acme.cmd.run', undefined, 'palette');
    expect(panelProps.get(panelKey('acme.cmd', 'acme.cmd.main'))).toEqual({
      from: 'command',
    });
    expect(openPanel).toHaveBeenCalledExactlyOnceWith({
      extensionId: 'acme.cmd',
      panelId: 'acme.cmd.main',
    });
  });

  it('openPanel на панель, пропавшую между выбором и выполнением, — «расширение изменилось», без перехода', async () => {
    const { runner, notices, openPanel, panelProps } = setup({
      kind: 'openPanel',
      panelId: 'acme.cmd.gone',
    });
    await runner.run('acme.cmd', 'acme.cmd.run', undefined, 'palette');
    expect(openPanel).not.toHaveBeenCalled();
    expect(
      panelProps.get(panelKey('acme.cmd', 'acme.cmd.gone')),
    ).toBeUndefined();
    expect(notices.current.value?.notice).toEqual({
      kind: 'failure',
      failure: { kind: 'changed', message: '' },
    });
  });

  it('openPanel на панель чужого расширения не выполняется', async () => {
    const other = withExtension();
    const { runner, openPanel, state } = setup(
      { kind: 'openPanel', panelId: 'acme.cmd.main' },
      other,
    );
    state.contributions = {
      ...other,
      panels: other.panels.map((panel) => ({
        ...panel,
        extensionId: 'acme.other',
      })),
    };
    await runner.run('acme.cmd', 'acme.cmd.run', undefined, 'palette');
    expect(openPanel).not.toHaveBeenCalled();
  });

  it('data: значение возвращается вызывающему (панели), уведомления нет', async () => {
    const { runner, notices } = setup({ kind: 'data', value: { streak: 4 } });
    await expect(
      runner.run('acme.cmd', 'acme.cmd.hidden', { day: 1 }, 'panel'),
    ).resolves.toEqual({ streak: 4 });
    expect(notices.current.value).toBeNull();
  });

  it('none: без значения и без уведомления; аргументы доходят до движка', async () => {
    const { runner, notices, invokeCommand } = setup({ kind: 'none' });
    await expect(
      runner.run('acme.cmd', 'acme.cmd.run', { a: 1 }, 'palette'),
    ).resolves.toBeUndefined();
    expect(notices.current.value).toBeNull();
    expect(invokeCommand).toHaveBeenCalledWith('acme.cmd', 'acme.cmd.run', {
      a: 1,
    });
  });

  it('эффекты panel-вызова исполняются так же, как у палитры', async () => {
    const { runner, notices, openPanel } = setup({
      kind: 'notify',
      text: 'pong',
    });
    await runner.run('acme.cmd', 'acme.cmd.hidden', undefined, 'panel');
    expect(notices.current.value?.notice).toEqual({
      kind: 'notify',
      text: 'pong',
    });
    expect(openPanel).not.toHaveBeenCalled();
  });
});

describe('исполнитель команд: ошибки', () => {
  it('палитра: сбой становится уведомлением, а не исключением', async () => {
    const { runner, notices } = setup(failure('handler-failed', 'нет данных'));
    await expect(
      runner.run('acme.cmd', 'acme.cmd.run', undefined, 'palette'),
    ).resolves.toBeUndefined();
    expect(notices.current.value?.notice).toEqual({
      kind: 'failure',
      failure: { kind: 'failed', message: 'нет данных' },
    });
  });

  it.each([
    ['timeout', 'timeout'],
    ['host-down', 'hostDown'],
    ['replaced', 'changed'],
    ['disabled', 'changed'],
    ['unknown-command', 'changed'],
  ] as const)('палитра: причина %s → уведомление %s', async (reason, kind) => {
    const { runner, notices } = setup(failure(reason));
    await runner.run('acme.cmd', 'acme.cmd.run', undefined, 'palette');
    expect(notices.current.value?.notice).toMatchObject({
      kind: 'failure',
      failure: { kind },
    });
  });

  it('панель: сбой — отклонённый промис с текстом, уведомления нет', async () => {
    const { runner, notices } = setup(failure('handler-failed', 'нет данных'));
    const rejected = await runner
      .run('acme.cmd', 'acme.cmd.hidden', undefined, 'panel')
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(CommandRejected);
    expect((rejected as CommandRejected).message).toBe('нет данных');
    expect(notices.current.value).toBeNull();
  });

  it('команда, пропавшая из вкладов между выбором и выполнением: движок не вызывается, «расширение изменилось»', async () => {
    const { runner, notices, invokeCommand, state } = setup();
    state.contributions = NO_CONTRIBUTIONS;
    await runner.run('acme.cmd', 'acme.cmd.run', undefined, 'palette');
    expect(invokeCommand).not.toHaveBeenCalled();
    expect(notices.current.value?.notice).toEqual({
      kind: 'failure',
      failure: { kind: 'changed', message: '' },
    });
  });

  it('то же для панели: отказ без вызова движка', async () => {
    const { runner, invokeCommand, state } = setup();
    state.contributions = NO_CONTRIBUTIONS;
    await expect(
      runner.run('acme.cmd', 'acme.cmd.hidden', undefined, 'panel'),
    ).rejects.toBeInstanceOf(CommandRejected);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it('команда другого расширения с тем же id не считается объявленной', async () => {
    const { runner, invokeCommand } = setup();
    await runner.run('acme.other', 'acme.cmd.run', undefined, 'palette');
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

describe('хранилище уведомлений', () => {
  it('новое уведомление заменяет прежнее и получает новый номер, даже с тем же текстом', () => {
    const notices = createNotices();
    notices.push({ kind: 'notify', text: 'one' });
    const first = notices.current.value;
    notices.push({ kind: 'notify', text: 'one' });
    expect(notices.current.value?.id).toBeGreaterThan(first?.id ?? 0);
  });

  it('dismiss убирает только то уведомление, номер которого передан', () => {
    const notices = createNotices();
    notices.push({ kind: 'notify', text: 'old' });
    const old = notices.current.value?.id ?? 0;
    notices.push({ kind: 'notify', text: 'new' });
    notices.dismiss(old);
    expect(notices.current.value?.notice).toEqual({
      kind: 'notify',
      text: 'new',
    });
    notices.dismiss(notices.current.value?.id ?? 0);
    expect(notices.current.value).toBeNull();
  });
});

describe('свойства панели', () => {
  it('set/get/clear по ключу; обновление реактивно для наблюдателя', () => {
    const props = createPanelProps();
    const key = panelKey('acme.cmd', 'acme.cmd.main');
    expect(props.get(key)).toBeUndefined();
    props.set(key, { a: 1 });
    expect(props.get(key)).toEqual({ a: 1 });
    props.set(key, { a: 2 });
    expect(props.get(key)).toEqual({ a: 2 });
    props.clear(key);
    expect(props.get(key)).toBeUndefined();
  });
});
