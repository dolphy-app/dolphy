import { describe, expect, it } from 'vitest';
import { messageOf, registrarOf, run } from './registrar-harness.ts';

const ID = 'acme.surf';

const command = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.run`,
  title: 'Run',
  run,
  ...patch,
});

const register = (...entries: Record<string, unknown>[]) => {
  const harness = registrarOf(ID);
  for (const entry of entries) harness.s.registerCommand(entry as never);
  return harness;
};

const rejection = (entry: Record<string, unknown>): string =>
  messageOf(() => register(entry));

describe('registerCommand: нормализация', () => {
  it('полная запись: palette по умолчанию true, значок puzzle, пропущенные поля — null', () => {
    const { registrar } = register(
      command({
        description: 'Do it',
        category: { en: 'Streak', ru: 'Серия' },
        keybindings: [
          { key: 'Mod+Shift+O', mac: 'Mod+Alt+O' },
          { key: 'Mod+Shift+P', when: "route == 'courses'" },
        ],
        when: 'course.active',
      }),
      command({ id: `${ID}.other`, icon: 'fire', palette: false }),
    );

    expect(registrar.snapshot().commands).toEqual([
      {
        id: `${ID}.run`,
        title: 'Run',
        description: 'Do it',
        category: { en: 'Streak', ru: 'Серия' },
        palette: true,
        icon: 'puzzle',
        keybindings: [
          {
            key: 'Mod+Shift+O',
            mac: 'Mod+Alt+O',
            windows: null,
            linux: null,
            when: null,
          },
          {
            key: 'Mod+Shift+P',
            mac: null,
            windows: null,
            linux: null,
            when: "route == 'courses'",
          },
        ],
        when: 'course.active',
      },
      {
        id: `${ID}.other`,
        title: 'Run',
        description: null,
        category: null,
        palette: false,
        icon: 'fire',
        keybindings: [],
        when: null,
      },
    ]);
  });

  it('id равен id расширения или лежит под ним', () => {
    expect(() =>
      register(command({ id: ID }), command({ id: `${ID}.deep.name` })),
    ).not.toThrow();
  });

  it('обработчик остаётся в хосте и не попадает в снимок', () => {
    const { registrar } = register(command());

    expect(registrar.handlers.commands.get(`${ID}.run`)?.handler).toBe(run);
    expect(JSON.stringify(registrar.snapshot())).not.toContain('function');
  });

  it('Disposable убирает команду из снимка и обработчиков; id освобождается', () => {
    const { registrar, s } = register();
    const handle = s.registerCommand(command() as never);
    handle.dispose();

    expect(registrar.snapshot().commands).toEqual([]);
    expect(registrar.handlers.commands.has(`${ID}.run`)).toBe(false);
    expect(() => s.registerCommand(command() as never)).not.toThrow();
  });

  it('устаревший Disposable не убирает команду, зарегистрированную заново', () => {
    const { registrar, s } = register();
    const first = s.registerCommand(command() as never);
    first.dispose();
    s.registerCommand(command() as never);

    first.dispose();

    expect(registrar.snapshot().commands).toHaveLength(1);
  });
});

describe('registerCommand: отклонения', () => {
  it.each([
    [
      'id вне пространства расширения',
      command({ id: 'other.run' }),
      "id must be 'acme.surf'",
    ],
    ['пустое название', command({ title: '' }), 'title'],
    ['название 61 знак', command({ title: 'x'.repeat(61) }), 'title'],
    ['категория 41 знак', command({ category: 'x'.repeat(41) }), 'category'],
    [
      'описание 201 знак',
      command({ description: 'x'.repeat(201) }),
      'description',
    ],
    ['palette не булево', command({ palette: 'no' }), 'palette'],
    ['значок вне списка', command({ icon: 'rocket' }), 'icon'],
    ['значок mdi', command({ icon: 'mdi-fire' }), 'icon'],
    ['лишний ключ', command({ keybinding: 'Mod+K' }), 'keybinding'],
    ['нет обработчика', command({ run: undefined }), 'run'],
    ['обработчик не функция', command({ run: 'x' }), 'run'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(rejection(entry)).toContain(fragment);
  });

  it('сообщение называет вид и id команды', () => {
    expect(rejection(command({ title: '' }))).toMatch(
      /^command 'acme\.surf\.run': /,
    );
  });

  it('границы допустимы: название 60 знаков, категория 40, описание 200', () => {
    expect(() =>
      register(
        command({
          title: 'x'.repeat(60),
          category: 'x'.repeat(40),
          description: 'x'.repeat(200),
        }),
      ),
    ).not.toThrow();
  });

  it('повтор id', () => {
    expect(messageOf(() => register(command(), command()))).toContain(
      `duplicate command '${ID}.run'`,
    );
  });

  it('не более 64 команд на расширение; освободившееся место снова доступно', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_value, index) =>
        command({ id: `${ID}.c${index}` }),
      );
    const { s } = register(...many(64));

    expect(messageOf(() => s.registerCommand(command() as never))).toContain(
      'at most 64 commands',
    );
  });

  it('освобождённое Disposable место в пределе снова доступно', () => {
    const { s } = register();
    const handles = Array.from({ length: 64 }, (_value, index) =>
      s.registerCommand(command({ id: `${ID}.c${index}` }) as never),
    );
    handles[0]?.dispose();

    expect(() => s.registerCommand(command() as never)).not.toThrow();
  });
});

describe('registerCommand: привязки клавиш', () => {
  it('принимает записи с ключами платформ и when', () => {
    const { registrar } = register(
      command({
        keybindings: [
          { key: 'Mod+K Mod+S' },
          { key: 'Mod+Shift+P', windows: 'Ctrl+Alt+P', when: "page == 'x'" },
          { key: 'Escape', when: '!inputFocus && paletteOpen' },
        ],
      }),
    );

    expect(registrar.snapshot().commands[0]?.keybindings).toHaveLength(3);
  });

  it('одинаковый ключ с разными when допустим', () => {
    expect(() =>
      register(
        command({
          keybindings: [
            { key: 'Mod+K', when: "route == 'courses'" },
            { key: 'Mod+K', when: "route == 'home'" },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    [
      'ключ неверен на одной платформе',
      { keybindings: [{ key: 'Mod+Ctrl+K' }] },
      'keybindings.0.key: invalid key (repeated-modifier)',
    ],
    [
      'ключ платформы неверен',
      { keybindings: [{ key: 'Mod+K', mac: 'Mod+Cmd+K' }] },
      'keybindings.0.mac: invalid key',
    ],
    [
      'печатающая клавиша без when',
      { keybindings: [{ key: 'Shift+A' }] },
      'keybindings.0.when: a key that types text',
    ],
    [
      'печатающая клавиша при when, активном в поле ввода',
      { keybindings: [{ key: 'A', when: 'inputFocus' }] },
      'a key that types text',
    ],
    [
      'неверный when привязки',
      { keybindings: [{ key: 'Mod+K', when: 'page ==' }] },
      'keybindings.0.when: invalid "when"',
    ],
    [
      'больше 4 записей',
      {
        keybindings: ['1', '2', '3', '4', '5'].map((key) => ({
          key: `Mod+${key}`,
        })),
      },
      'keybindings',
    ],
    [
      'привязка при palette: false',
      { keybindings: [{ key: 'Mod+K' }], palette: false },
      'palette: keybindings need palette: true',
    ],
    [
      'повтор (key, when) в команде',
      {
        keybindings: [
          { key: 'Mod+K', when: "route == 'home'" },
          { key: 'Mod+K', when: "route == 'home'" },
        ],
      },
      'keybindings.1.key: duplicate binding',
    ],
    [
      'лишний ключ записи',
      { keybindings: [{ key: 'Mod+K', command: 'x' }] },
      'command',
    ],
    ['пустой ключ', { keybindings: [{ key: '' }] }, 'key'],
  ])('отклоняет: %s', (_name, patch, fragment) => {
    expect(rejection(command(patch))).toContain(fragment);
  });
});

describe('registerCommand: условие when', () => {
  it('принимает условие и сохраняет текст как есть', () => {
    const text = "route == 'courses' && !session.active";
    const { registrar } = register(command({ when: text }));

    expect(registrar.snapshot().commands[0]?.when).toBe(text);
  });

  it.each([
    ['неизвестный ключ', "foo == 'x'", "unknown key 'foo'", 'at 0'],
    ['ключ другого реестра', 'inputFocus', "unknown key 'inputFocus'", 'at 0'],
    ['неизвестное значение', "route == 'home'", "unknown value 'home'", 'at 9'],
    [
      'несовпадение типа',
      "course.active == 'yes'",
      "'course.active' is a boolean",
      'at 17',
    ],
    ['синтаксис', 'route ==', 'end of the condition', 'at 8'],
    ['одиночный &', 'course.active & session.active', "character '&'", 'at 14'],
  ])('отклоняет: %s, сообщение с позицией', (_name, when, cause, position) => {
    const message = rejection(command({ when }));

    expect(message).toContain('when: invalid "when"');
    expect(message).toContain(cause);
    expect(message).toContain(position);
  });

  it('длина условия: 200 знаков допустимы, 201 — ошибка', () => {
    const fits = `course.active${' '.repeat(187)}`;
    expect(fits).toHaveLength(200);

    expect(() => register(command({ when: fits }))).not.toThrow();
    expect(rejection(command({ when: `${fits} ` }))).toContain('when');
  });

  it('пустое условие — ошибка', () => {
    expect(rejection(command({ when: '' }))).toContain('when');
  });

  it('команда с palette: false может иметь условие', () => {
    expect(() =>
      register(command({ palette: false, when: 'course.active' })),
    ).not.toThrow();
  });
});
