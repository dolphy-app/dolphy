import { describe, expect, it } from 'vitest';
import { messageOf, registrarOf } from './registrar-harness.ts';

const ID = 'acme.pt';

const setting = (patch: Record<string, unknown> = {}) => ({
  id: `${ID}.volume`,
  type: 'number',
  label: 'Volume',
  default: 5,
  min: 0,
  max: 10,
  ...patch,
});

const register = (...defs: unknown[]) => {
  const harness = registrarOf(ID);
  harness.s.registerSettings(defs as never);
  return harness;
};

const rejection = (...defs: unknown[]): string =>
  messageOf(() => register(...defs));

describe('registerSettings: нормализация', () => {
  it('принимает все виды; пропущенные поля — null, 0 и пределы по умолчанию', () => {
    const { registrar } = register(
      { id: ID, type: 'boolean', label: 'On', default: true },
      {
        id: `${ID}.name`,
        type: 'string',
        label: 'Name',
        description: 'Shown to you',
        default: 'abc',
        maxLength: 5,
      },
      { id: `${ID}.note`, type: 'text', label: 'Note', default: 'a\nb' },
      setting({ integer: true }),
      {
        id: `${ID}.mode`,
        type: 'enum',
        label: { en: 'Mode', ru: 'Режим' },
        group: 'Main',
        order: 3,
        default: 'b',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: { en: 'B' } },
        ],
      },
      { id: `${ID}.tags`, type: 'list', label: 'Tags', default: ['x'] },
    );

    expect(registrar.snapshot().settings).toEqual([
      {
        id: ID,
        type: 'boolean',
        label: 'On',
        description: null,
        group: null,
        order: 0,
        visibleWhen: null,
        default: true,
      },
      {
        id: `${ID}.name`,
        type: 'string',
        label: 'Name',
        description: 'Shown to you',
        group: null,
        order: 0,
        visibleWhen: null,
        default: 'abc',
        maxLength: 5,
      },
      {
        id: `${ID}.note`,
        type: 'text',
        label: 'Note',
        description: null,
        group: null,
        order: 0,
        visibleWhen: null,
        default: 'a\nb',
        maxLength: null,
      },
      {
        id: `${ID}.volume`,
        type: 'number',
        label: 'Volume',
        description: null,
        group: null,
        order: 0,
        visibleWhen: null,
        default: 5,
        min: 0,
        max: 10,
        integer: true,
      },
      {
        id: `${ID}.mode`,
        type: 'enum',
        label: { en: 'Mode', ru: 'Режим' },
        description: null,
        group: 'Main',
        order: 3,
        visibleWhen: null,
        default: 'b',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: { en: 'B' } },
        ],
      },
      {
        id: `${ID}.tags`,
        type: 'list',
        label: 'Tags',
        description: null,
        group: null,
        order: 0,
        visibleWhen: null,
        default: ['x'],
        maxItems: 50,
        itemMaxLength: 200,
      },
    ]);
  });

  it('цвет приводится к нижнему регистру', () => {
    const { registrar } = register({
      id: `${ID}.accent`,
      type: 'color',
      label: 'Accent',
      default: '#AABBCC',
    });

    expect(registrar.snapshot().settings[0]).toMatchObject({
      type: 'color',
      default: '#aabbcc',
    });
  });

  it('значения до загрузки — умолчания; снимок не зависит от правок исходного массива', () => {
    const tags = ['a'];
    const { registrar, s } = register({
      id: `${ID}.tags`,
      type: 'list',
      label: 'Tags',
      default: tags,
    });
    tags.push('b');

    expect(s.settings.get(`${ID}.tags`)).toEqual(['a']);
    expect(registrar.snapshot().settings[0]).toMatchObject({ default: ['a'] });
  });

  it('несколько вызовов складываются в порядке вызовов', () => {
    const { registrar, s } = register(setting({ id: `${ID}.a` }));
    s.registerSettings([setting({ id: `${ID}.b` })] as never);

    expect(registrar.snapshot().settings.map(({ id }) => id)).toEqual([
      `${ID}.a`,
      `${ID}.b`,
    ]);
  });

  it('Disposable убирает определения из снимка и чтения; чужие остаются', () => {
    const { registrar, s } = register(setting({ id: `${ID}.keep` }));
    const handle = s.registerSettings([setting({ id: `${ID}.gone` })] as never);

    handle.dispose();

    expect(registrar.snapshot().settings.map(({ id }) => id)).toEqual([
      `${ID}.keep`,
    ]);
    expect(s.settings.get(`${ID}.keep`)).toBe(5);
    expect(() => s.settings.get(`${ID}.gone`)).toThrow('is not registered');
  });

  it('после dispose тот же id можно зарегистрировать снова', () => {
    const { s } = register();
    s.registerSettings([setting()] as never).dispose();

    expect(() => s.registerSettings([setting()] as never)).not.toThrow();
  });
});

describe('registerSettings: отклонения', () => {
  it.each([
    [
      'чужое пространство id',
      setting({ id: 'other.volume' }),
      "id must be 'acme.pt'",
    ],
    [
      'id, начинающийся с id расширения без точки',
      setting({ id: `${ID}x` }),
      "id must be 'acme.pt'",
    ],
    ['default не того типа', setting({ default: '5' }), 'default'],
    [
      'default ниже min',
      setting({ default: -1 }),
      'default is less than min 0',
    ],
    [
      'default выше max',
      setting({ default: 11 }),
      'default is greater than max 10',
    ],
    [
      'нецелый default при integer',
      setting({ integer: true, default: 2.5 }),
      'default must be an integer',
    ],
    [
      'min больше max',
      setting({ min: 9, max: 1, default: 5 }),
      'min is greater than max',
    ],
    [
      'бесконечный default',
      setting({ default: Infinity, min: undefined, max: undefined }),
      'default',
    ],
    [
      'default строки длиннее maxLength',
      {
        id: `${ID}.s`,
        type: 'string',
        label: 'S',
        default: 'abcdef',
        maxLength: 5,
      },
      'default is longer than 5 characters',
    ],
    [
      'default text длиннее maxLength',
      {
        id: `${ID}.t`,
        type: 'text',
        label: 'T',
        default: 'abcdef',
        maxLength: 5,
      },
      'default is longer than 5 characters',
    ],
    [
      'default строки длиннее потолка при maxLength по умолчанию',
      {
        id: `${ID}.s`,
        type: 'string',
        label: 'S',
        default: 'x'.repeat(10_001),
      },
      'default is longer than 10000 characters',
    ],
    [
      'maxLength string сверх потолка',
      {
        id: `${ID}.s`,
        type: 'string',
        label: 'S',
        default: '',
        maxLength: 10_001,
      },
      'maxLength',
    ],
    [
      'maxLength text сверх потолка',
      {
        id: `${ID}.t`,
        type: 'text',
        label: 'T',
        default: '',
        maxLength: 10_001,
      },
      'maxLength',
    ],
    [
      'default enum не из options',
      {
        id: `${ID}.e`,
        type: 'enum',
        label: 'E',
        default: 'c',
        options: [{ value: 'a', label: 'A' }],
      },
      "default 'c' is not an option",
    ],
    [
      'повтор значений в options',
      {
        id: `${ID}.e`,
        type: 'enum',
        label: 'E',
        default: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'a', label: 'A2' },
        ],
      },
      "duplicate value 'a'",
    ],
    [
      'enum без вариантов',
      { id: `${ID}.e`, type: 'enum', label: 'E', default: 'a', options: [] },
      'options',
    ],
    [
      'enum больше 64 вариантов',
      {
        id: `${ID}.e`,
        type: 'enum',
        label: 'E',
        default: 'v0',
        options: Array.from({ length: 65 }, (_value, index) => ({
          value: `v${index}`,
          label: 'V',
        })),
      },
      'options',
    ],
    ['неизвестный ключ', setting({ step: 1 }), 'step'],
    [
      'неизвестный тип',
      { id: `${ID}.x`, type: 'date', label: 'X', default: '' },
      'type',
    ],
    [
      'цвет не #rrggbb',
      { id: `${ID}.c`, type: 'color', label: 'C', default: '#fff' },
      'must be #rrggbb',
    ],
    [
      'default списка длиннее maxItems',
      {
        id: `${ID}.l`,
        type: 'list',
        label: 'L',
        default: ['a', 'b', 'c'],
        maxItems: 2,
      },
      'default has more than 2 items',
    ],
    [
      'элемент default списка длиннее itemMaxLength',
      {
        id: `${ID}.l`,
        type: 'list',
        label: 'L',
        default: ['abcdef'],
        itemMaxLength: 5,
      },
      'default has an item longer than 5 characters',
    ],
    [
      'maxItems списка сверх потолка',
      { id: `${ID}.l`, type: 'list', label: 'L', default: [], maxItems: 51 },
      'maxItems',
    ],
    [
      'itemMaxLength списка сверх потолка',
      {
        id: `${ID}.l`,
        type: 'list',
        label: 'L',
        default: [],
        itemMaxLength: 201,
      },
      'itemMaxLength',
    ],
    ['пустая подпись', setting({ label: '' }), 'label'],
    ['подпись 61 знак', setting({ label: 'x'.repeat(61) }), 'label'],
    [
      'описание 501 знак',
      setting({ description: 'x'.repeat(501) }),
      'description',
    ],
    ['пустой group', setting({ group: '' }), 'group'],
    ['group длиннее 60', setting({ group: 'g'.repeat(61) }), 'group'],
    ['order ниже 0', setting({ order: -1 }), 'order'],
    ['order выше 1000', setting({ order: 1001 }), 'order'],
    ['нецелый order', setting({ order: 1.5 }), 'order'],
  ])('отклоняет: %s', (_name, entry, fragment) => {
    expect(rejection(entry)).toContain(fragment);
  });

  it('границы допустимы: подпись 60 знаков, order 1000, maxLength 10000', () => {
    expect(() =>
      register(
        setting({ label: 'x'.repeat(60), order: 1000 }),
        {
          id: `${ID}.s`,
          type: 'string',
          label: 'S',
          default: 'x'.repeat(10_000),
          maxLength: 10_000,
        },
        {
          id: `${ID}.l`,
          type: 'list',
          label: 'L',
          default: Array.from({ length: 50 }, () => 'x'.repeat(200)),
        },
      ),
    ).not.toThrow();
  });

  it('сообщение называет вид и id настройки', () => {
    expect(rejection(setting({ default: 11 }))).toMatch(
      /^setting 'acme\.pt\.volume': /,
    );
  });

  it('отклоняет не массив', () => {
    const { s } = registrarOf(ID);

    expect(messageOf(() => s.registerSettings(setting() as never))).toContain(
      'expects an array',
    );
  });

  it('повтор id внутри вызова и между вызовами', () => {
    expect(rejection(setting(), setting({ label: 'Again' }))).toContain(
      "duplicate setting 'acme.pt.volume'",
    );

    const { s } = register(setting());
    expect(messageOf(() => s.registerSettings([setting()] as never))).toContain(
      "duplicate setting 'acme.pt.volume'",
    );
  });

  it('отклонённый вызов не оставляет ни одного определения из списка', () => {
    const { registrar, s } = registrarOf(ID);

    expect(() =>
      s.registerSettings([
        setting({ id: `${ID}.ok` }),
        setting({ id: `${ID}.bad`, default: 99 }),
      ] as never),
    ).toThrow();
    expect(registrar.snapshot().settings).toEqual([]);
    expect(() => s.settings.get(`${ID}.ok`)).toThrow();
  });
});

describe('registerSettings: visibleWhen', () => {
  const flag = {
    id: `${ID}.flag`,
    type: 'boolean',
    label: 'F',
    default: false,
  };
  const gated = (visibleWhen: unknown, extra: Record<string, unknown> = {}) =>
    setting({ visibleWhen, ...extra });

  it('принимает ссылку на boolean, enum, string и number, в том числе из прежнего вызова', () => {
    const { registrar, s } = register(
      flag,
      { id: `${ID}.n`, type: 'number', label: 'N', default: 1 },
      { id: `${ID}.s`, type: 'string', label: 'S', default: '' },
      {
        id: `${ID}.e`,
        type: 'enum',
        label: 'E',
        default: 'a',
        options: [{ value: 'a', label: 'A' }],
      },
      gated({ setting: `${ID}.flag`, equals: true }),
      setting({
        id: `${ID}.v2`,
        visibleWhen: { setting: `${ID}.n`, equals: 3 },
      }),
      setting({
        id: `${ID}.v3`,
        visibleWhen: { setting: `${ID}.s`, equals: 'x' },
      }),
      setting({
        id: `${ID}.v4`,
        visibleWhen: { setting: `${ID}.e`, equals: 'a' },
      }),
    );
    s.registerSettings([
      setting({
        id: `${ID}.v5`,
        visibleWhen: { setting: `${ID}.flag`, equals: false },
      }),
    ] as never);

    expect(
      registrar
        .snapshot()
        .settings.filter(({ visibleWhen }) => visibleWhen !== null),
    ).toHaveLength(5);
    expect(registrar.snapshot().settings[4]?.visibleWhen).toEqual({
      setting: `${ID}.flag`,
      equals: true,
    });
  });

  it.each([
    [
      'несуществующая настройка',
      [gated({ setting: `${ID}.ghost`, equals: true })],
      "unknown setting 'acme.pt.ghost'",
    ],
    [
      'сама на себя',
      [gated({ setting: `${ID}.volume`, equals: 5 })],
      'cannot depend on itself',
    ],
    [
      'цикл',
      [
        setting({
          id: `${ID}.a`,
          visibleWhen: { setting: `${ID}.b`, equals: 5 },
        }),
        setting({
          id: `${ID}.b`,
          visibleWhen: { setting: `${ID}.a`, equals: 5 },
        }),
      ],
      'chains and cycles are not allowed',
    ],
    [
      'цепочка',
      [
        flag,
        setting({
          id: `${ID}.a`,
          visibleWhen: { setting: `${ID}.flag`, equals: true },
        }),
        setting({
          id: `${ID}.b`,
          visibleWhen: { setting: `${ID}.a`, equals: 5 },
        }),
      ],
      'chains and cycles are not allowed',
    ],
    [
      'список как условие',
      [
        { id: `${ID}.l`, type: 'list', label: 'L', default: [] },
        gated({ setting: `${ID}.l`, equals: 'x' }),
      ],
      'is a list',
    ],
    [
      'equals другого типа',
      [flag, gated({ setting: `${ID}.flag`, equals: 'yes' })],
      'must be a boolean',
    ],
    [
      'число против строки',
      [
        setting(),
        gated({ setting: `${ID}.volume`, equals: '5' }, { id: `${ID}.v` }),
      ],
      'must be a number',
    ],
    [
      'чужая настройка',
      [gated({ setting: 'other.flag', equals: true })],
      "unknown setting 'other.flag'",
    ],
  ])('отклоняет: %s', (_name, defs, fragment) => {
    expect(rejection(...defs)).toContain(fragment);
  });

  it('цель из другого вызова, у которой есть своё условие, цепочкой не разрешается', () => {
    const { s } = register(
      flag,
      setting({
        id: `${ID}.a`,
        visibleWhen: { setting: `${ID}.flag`, equals: true },
      }),
    );

    expect(
      messageOf(() =>
        s.registerSettings([
          setting({
            id: `${ID}.b`,
            visibleWhen: { setting: `${ID}.a`, equals: 5 },
          }),
        ] as never),
      ),
    ).toContain('chains and cycles are not allowed');
  });
});
