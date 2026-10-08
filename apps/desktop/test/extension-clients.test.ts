import { afterEach, describe, expect, it, vi } from 'vitest';
import { INJECTION_LIMITS } from '@dolphy-app/extension-api';
import type { ClientContext } from '@dolphy-app/extension-api';
import {
  clientDto,
  createTestClients,
  moduleOf,
  textComponent,
} from './support/client-fakes.ts';
import { flush } from './support/extensions-fakes.ts';

const URL_A = 'dolphy-ext://acme.a/client.mjs';
const URL_B = 'dolphy-ext://acme.b/client.mjs';

const COLORS = { primary: '#123456' };

afterEach(() => {
  vi.restoreAllMocks();
});

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('реестр клиентских частей: загрузка', () => {
  it('импортирует client.mjs, вызывает client(c) и собирает вклады по порядку id расширения', async () => {
    const seen: string[] = [];
    const { registry, imported } = createTestClients(
      {
        [URL_B]: moduleOf((c) => {
          seen.push(c.extensionId);
          c.addPanel({
            id: 'acme.b.panel',
            title: 'B',
            component: textComponent('b'),
          });
        }),
        [URL_A]: moduleOf((c) => {
          seen.push(c.extensionId);
          c.addPanel({
            id: 'acme.a.panel',
            title: { en: 'A', ru: 'А' },
            icon: 'book',
            when: "route == 'courses'",
            header: false,
            component: textComponent('a'),
          });
          c.addInjection({
            id: 'acme.a.plan',
            target: '[data-ext-anchor="dailyPlan"]',
            component: textComponent('injection'),
          });
          c.addAnswerView('acme.a.quiz', textComponent('view'));
          c.addMarkdownRenderer('math', textComponent('math'));
          c.addTheme({
            id: 'acme.a',
            label: 'Night',
            dark: true,
            colors: COLORS,
          });
          c.addCommand({ id: 'acme.a.go', title: 'Go', run: () => {} });
        }),
      },
      [clientDto('acme.b'), clientDto('acme.a', 'r1')],
    );
    expect(registry.states.value.get('acme.a')?.status).toBe('loading');
    await flush();

    expect(imported.sort()).toEqual([`${URL_A}?v=r1`, URL_B]);
    expect(seen.sort()).toEqual(['acme.a', 'acme.b']);
    expect(registry.panels.value.map(({ id }) => id)).toEqual([
      'acme.a.panel',
      'acme.b.panel',
    ]);
    expect(registry.panels.value[0]).toMatchObject({
      extensionId: 'acme.a',
      icon: 'book',
      when: "route == 'courses'",
      header: false,
    });
    expect(registry.panels.value[1]).toMatchObject({
      icon: 'puzzle',
      header: true,
    });
    expect(registry.injections.value).toMatchObject([
      {
        extensionId: 'acme.a',
        id: 'acme.a.plan',
        target: '[data-ext-anchor="dailyPlan"]',
        position: 'append',
      },
    ]);
    expect(registry.answerViews.value.map(({ type }) => type)).toEqual([
      'acme.a.quiz',
    ]);
    expect(
      registry.markdownRenderers.value.map(({ language }) => language),
    ).toEqual(['math']);
    expect(registry.themes.value[0]).toMatchObject({
      id: 'acme.a',
      dark: true,
      variables: {},
    });
    expect(registry.commands.value[0]).toMatchObject({
      id: 'acme.a.go',
      palette: true,
      keybindings: [],
      when: null,
    });
    expect(registry.states.value.get('acme.a')).toEqual({
      status: 'loaded',
      error: null,
    });
  });

  it('асинхронный client(c) виден только после завершения', async () => {
    let finish: () => void = () => {};
    const { registry } = createTestClients(
      {
        [URL_A]: moduleOf(async (c) => {
          c.addPanel({
            id: 'acme.a.p',
            title: 'P',
            component: textComponent('p'),
          });
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        }),
      },
      [clientDto('acme.a')],
    );
    await flush();
    expect(registry.panels.value).toEqual([]);
    expect(registry.states.value.get('acme.a')?.status).toBe('loading');
    finish();
    await flush();
    expect(registry.panels.value).toHaveLength(1);
  });
});

describe('реестр клиентских частей: изоляция ошибок', () => {
  it('сбой client(c) откатывает частичную регистрацию и не трогает остальных', async () => {
    const log = quiet();
    const { registry } = createTestClients(
      {
        [URL_A]: moduleOf((c) => {
          c.addPanel({
            id: 'acme.a.p',
            title: 'P',
            component: textComponent('p'),
          });
          throw new Error('boom');
        }),
        [URL_B]: moduleOf((c) => {
          c.addPanel({
            id: 'acme.b.p',
            title: 'P',
            component: textComponent('p'),
          });
        }),
      },
      [clientDto('acme.a'), clientDto('acme.b')],
    );
    await flush();
    expect(registry.panels.value.map(({ id }) => id)).toEqual(['acme.b.p']);
    expect(registry.states.value.get('acme.a')).toEqual({
      status: 'failed',
      error: 'boom',
    });
    expect(registry.states.value.get('acme.b')?.status).toBe('loaded');
    expect(log).toHaveBeenCalledOnce();
  });

  it('ошибка импорта и модуль без экспорта client — состояние failed', async () => {
    quiet();
    const { registry } = createTestClients(
      { [URL_A]: new Error('no such file'), [URL_B]: { default: 1 } },
      [clientDto('acme.a'), clientDto('acme.b')],
    );
    await flush();
    expect(registry.states.value.get('acme.a')?.error).toBe('no such file');
    expect(registry.states.value.get('acme.b')?.error).toContain(
      "no 'client' export",
    );
  });

  it('очистка, возвращённая частично зарегистрировавшимся client, вызывается при откате', async () => {
    quiet();
    const cleanup = vi.fn();
    const { registry } = createTestClients(
      {
        [URL_A]: moduleOf(async (c) => {
          c.addPanel({
            id: 'acme.a.p',
            title: 'P',
            component: textComponent('p'),
          });
          await Promise.resolve();
          c.addPanel({
            id: 'acme.a.p',
            title: 'duplicate',
            component: textComponent('p'),
          });
          return cleanup;
        }),
      },
      [clientDto('acme.a')],
    );
    await flush();
    expect(registry.panels.value).toEqual([]);
    expect(registry.states.value.get('acme.a')?.error).toContain(
      "panel 'acme.a.p' is already registered",
    );
    expect(cleanup).not.toHaveBeenCalled();
  });
});

describe('реестр клиентских частей: проверка регистраций', () => {
  const failing = async (register: (c: ClientContext) => void) => {
    quiet();
    const { registry } = createTestClients({ [URL_A]: moduleOf(register) }, [
      clientDto('acme.a'),
    ]);
    await flush();
    return registry.states.value.get('acme.a')?.error ?? null;
  };

  it('id вклада должен совпадать с id расширения или начинаться с него', async () => {
    expect(
      await failing((c) =>
        c.addPanel({ id: 'evil.p', title: 'P', component: textComponent('p') }),
      ),
    ).toContain("must be 'acme.a' or start with 'acme.a.'");
  });

  it('панель: header только булев', async () => {
    expect(
      await failing((c) =>
        c.addPanel({
          id: 'acme.a.p',
          title: 'P',
          header: 'no' as never,
          component: textComponent('p'),
        }),
      ),
    ).toContain('panel.header');
  });

  it('тема: встроенный id, чужие ключи цветов и неверный цвет отвергаются', async () => {
    expect(
      await failing((c) =>
        c.addTheme({
          id: 'acme.a',
          label: 'T',
          dark: false,
          colors: { nope: '#123456' },
        }),
      ),
    ).toContain('keys must be among');
    expect(
      await failing((c) =>
        c.addTheme({
          id: 'acme.a',
          label: 'T',
          dark: false,
          colors: { primary: 'red' },
        }),
      ),
    ).toContain('#rrggbb');
  });

  it('вставка: цель непустая и не длиннее лимита, позиция из списка, id не повторяется', async () => {
    const component = textComponent('x');
    expect(
      await failing((c) => c.addInjection({ id: 'a', target: '', component })),
    ).toContain('injection.target');
    expect(
      await failing((c) =>
        c.addInjection({
          id: 'a',
          target: 'a'.repeat(INJECTION_LIMITS.selectorLength + 1),
          component,
        }),
      ),
    ).toContain('injection.target');
    expect(
      await failing((c) =>
        c.addInjection({
          id: 'a',
          target: 'body',
          position: 'inside' as 'before',
          component,
        }),
      ),
    ).toContain('injection.position');
    expect(
      await failing((c) => {
        c.addInjection({ id: 'a', target: 'body', component });
        c.addInjection({ id: 'a', target: 'main', component });
      }),
    ).toContain("injection 'a' is already registered");
  });

  it('язык рендерера и повтор вида ответа проверяются', async () => {
    expect(
      await failing((c) =>
        c.addMarkdownRenderer('Bad Lang', textComponent('x')),
      ),
    ).toContain('invalid language');
    expect(
      await failing((c) => {
        c.addAnswerView('acme.a.t', textComponent('x'));
        c.addAnswerView('acme.a.t', textComponent('y'));
      }),
    ).toContain("answer view 'acme.a.t' is already registered");
  });

  it('команда: привязка, печатающая текст, нуждается в условии; id серверной команды занят', async () => {
    expect(
      await failing((c) =>
        c.addCommand({
          id: 'acme.a.go',
          title: 'Go',
          keybindings: [{ key: 'K' }],
          run: () => {},
        }),
      ),
    ).toContain('inputFocus');
    quiet();
    const { registry } = createTestClients(
      {
        [URL_A]: moduleOf((c) =>
          c.addCommand({ id: 'acme.a.go', title: 'Go', run: () => {} }),
        ),
      },
      [clientDto('acme.a')],
      {
        commands: [
          {
            id: 'acme.a.go',
            extensionId: 'acme.a',
            title: 'Go',
            description: null,
            category: null,
            keybindings: [],
            palette: true,
            when: null,
            icon: 'puzzle',
          },
        ],
      },
    );
    await flush();
    expect(registry.states.value.get('acme.a')?.error).toContain(
      'already registered by the server part',
    );
  });

  it('привязка клиентской команды приводится к виду с null по платформам', async () => {
    const { registry } = createTestClients(
      {
        [URL_A]: moduleOf((c) =>
          c.addCommand({
            id: 'acme.a.go',
            title: 'Go',
            keybindings: [
              { key: 'Mod+Shift+L', mac: 'Cmd+Shift+L', when: '!inputFocus' },
            ],
            run: () => {},
          }),
        ),
      },
      [clientDto('acme.a')],
    );
    await flush();
    expect(registry.commands.value[0]?.keybindings).toEqual([
      {
        key: 'Mod+Shift+L',
        mac: 'Cmd+Shift+L',
        windows: null,
        linux: null,
        when: '!inputFocus',
      },
    ]);
  });
});

describe('реестр клиентских частей: смена и снятие', () => {
  it('Disposable снимает вклад, повторный dispose безопасен', async () => {
    let theme: { dispose(): void | Promise<void> } | undefined;
    const { registry } = createTestClients(
      {
        [URL_A]: moduleOf((c) => {
          theme = c.addTheme({
            id: 'acme.a',
            label: 'T',
            dark: false,
            colors: COLORS,
          });
        }),
      },
      [clientDto('acme.a')],
    );
    await flush();
    expect(registry.themes.value).toHaveLength(1);
    await theme?.dispose();
    await theme?.dispose();
    expect(registry.themes.value).toEqual([]);
  });

  it('удалённое или отключённое расширение: вклады сняты, очистка вызвана; вернулось — загружено заново', async () => {
    const cleanup = vi.fn();
    const { registry, setClients, imported } = createTestClients(
      {
        [URL_A]: moduleOf((c) => {
          c.addPanel({
            id: 'acme.a.p',
            title: 'P',
            component: textComponent('p'),
          });
          return cleanup;
        }),
      },
      [clientDto('acme.a')],
    );
    await flush();
    expect(registry.panels.value).toHaveLength(1);

    await setClients([]);
    expect(registry.panels.value).toEqual([]);
    expect(registry.states.value.has('acme.a')).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();

    await setClients([clientDto('acme.a')]);
    expect(registry.panels.value).toHaveLength(1);
    expect(imported).toHaveLength(2);
  });

  it('очистка в виде Disposable вызывается, её сбой уходит в журнал и не мешает остальным', async () => {
    const log = quiet();
    const dispose = vi.fn(() => {
      throw new Error('cleanup broke');
    });
    const { setClients, registry } = createTestClients(
      {
        [URL_A]: moduleOf(() => ({ dispose })),
        [URL_B]: moduleOf((c) =>
          c.addPanel({
            id: 'acme.b.p',
            title: 'P',
            component: textComponent('p'),
          }),
        ),
      },
      [clientDto('acme.a'), clientDto('acme.b')],
    );
    await flush();
    await setClients([clientDto('acme.b')]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
    expect(registry.panels.value).toHaveLength(1);
  });

  it('новая ревизия: модуль берётся по новому адресу, вклады заменяются разом, прежняя очистка вызывается после', async () => {
    const order: string[] = [];
    const { registry, setClients, imported } = createTestClients(
      {
        [URL_A]: moduleOf((c) => {
          const instance =
            order.filter((entry) => entry.startsWith('run')).length + 1;
          order.push(`run ${instance}`);
          c.addPanel({
            id: 'acme.a.p',
            title: `P${instance}`,
            component: textComponent('p'),
          });
          return () => {
            order.push(`cleanup ${instance}`);
          };
        }),
      },
      [clientDto('acme.a', 'r1')],
    );
    await flush();
    const first = registry.panels.value[0];
    expect(first?.title).toBe('P1');

    await setClients([clientDto('acme.a', 'r1')]);
    expect(imported).toHaveLength(1);

    await setClients([clientDto('acme.a', 'r2')]);
    expect(imported.at(-1)).toBe(`${URL_A}?v=r2`);
    expect(registry.panels.value).toHaveLength(1);
    expect(registry.panels.value[0]?.title).toBe('P2');
    expect(registry.panels.value[0]?.key).not.toBe(first?.key);
    expect(order).toEqual(['run 1', 'run 2', 'cleanup 1']);
  });

  it('сбой новой ревизии снимает и прежние вклады: расширение failed', async () => {
    quiet();
    let broken = false;
    const { registry, setClients } = createTestClients(
      {
        [URL_A]: moduleOf((c) => {
          if (broken) throw new Error('new revision broke');
          c.addPanel({
            id: 'acme.a.p',
            title: 'P',
            component: textComponent('p'),
          });
        }),
      },
      [clientDto('acme.a', 'r1')],
    );
    await flush();
    broken = true;
    await setClients([clientDto('acme.a', 'r2')]);
    expect(registry.panels.value).toEqual([]);
    expect(registry.states.value.get('acme.a')?.error).toBe(
      'new revision broke',
    );
  });

  it('reload после сбоя импортирует модуль по новому адресу', async () => {
    quiet();
    const { registry, imported } = createTestClients(
      { [URL_A]: new Error('offline') },
      [clientDto('acme.a')],
    );
    await flush();
    registry.reload('acme.a');
    await flush();
    expect(imported).toEqual([URL_A, `${URL_A}?retry=1`]);
  });

  it('загрузка, устаревшая к моменту ответа (расширение удалено), не вызывает client', async () => {
    let release: (module: unknown) => void = () => {};
    const clientRan = vi.fn();
    const { registry, setClients } = createTestClients(
      {
        [URL_A]: new Promise<unknown>((resolve) => {
          release = resolve;
        }),
      },
      [clientDto('acme.a')],
    );
    await flush();
    await setClients([]);
    release(moduleOf(clientRan));
    await flush();
    expect(clientRan).not.toHaveBeenCalled();
    expect(registry.states.value.has('acme.a')).toBe(false);
  });

  it('dispose снимает всё и выгружает', async () => {
    const cleanup = vi.fn();
    const { registry } = createTestClients(
      {
        [URL_A]: moduleOf((c) => {
          c.addInjection({
            id: 'a',
            target: 'body',
            component: textComponent('s'),
          });
          return cleanup;
        }),
      },
      [clientDto('acme.a')],
    );
    await flush();
    registry.dispose();
    await flush();
    expect(registry.injections.value).toEqual([]);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
