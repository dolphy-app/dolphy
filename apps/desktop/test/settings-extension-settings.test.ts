import { effectScope } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  ExtensionSettingDefDto,
  JsonValue,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import {
  parseNumberInput,
  useExtensionSettings,
} from '@/pages/settings/model/extension-settings.ts';
import {
  FakeEngineError,
  createEventBus,
  flush,
} from './support/extensions-fakes.ts';

const ID = 'acme.state';

const base = {
  extensionId: ID,
  description: null,
  group: null,
  order: 0,
  visibleWhen: null,
};
const DEFINITIONS: ExtensionSettingDefDto[] = [
  {
    ...base,
    id: 'acme.state.loud',
    type: 'boolean',
    label: 'Loud',
    default: false,
  },
  {
    ...base,
    id: 'acme.state.greeting',
    type: 'string',
    label: 'Greeting',
    default: 'hello',
    maxLength: 5,
  },
  {
    ...base,
    id: 'acme.state.limit',
    type: 'number',
    label: 'Limit',
    default: 3,
    min: 1,
    max: 10,
    integer: true,
  },
  {
    ...base,
    id: 'acme.state.mode',
    type: 'enum',
    label: 'Mode',
    default: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
  {
    ...base,
    id: 'acme.state.tags',
    type: 'list',
    label: 'Tags',
    default: ['a'],
    maxItems: 3,
    itemMaxLength: 5,
  },
  {
    ...base,
    extensionId: 'acme.other',
    id: 'acme.other.flag',
    type: 'boolean',
    label: 'Other',
    default: true,
  },
];

const DEFAULTS: Record<string, JsonValue> = {
  'acme.state.loud': false,
  'acme.state.greeting': 'hello',
  'acme.state.limit': 3,
  'acme.state.mode': 'a',
  'acme.state.tags': ['a'],
};

interface Gate {
  resolve(): void;
  reject(error: Error): void;
}

const invalid = (reason: string, message = `invalid (${reason})`) =>
  new FakeEngineError('INVALID_ARGUMENT', message, {
    details: { reason },
  });

/** Движок с настоящей проверкой значений; `hold` задерживает ответы записи до решения теста. */
const setup = (options: { hold?: boolean; loadError?: Error } = {}) => {
  const bus = createEventBus();
  let stored: Record<string, JsonValue> = { ...DEFAULTS };
  const writes: Array<[string, JsonValue]> = [];
  const gates: Gate[] = [];
  let loadError = options.loadError;
  const engine = {
    subscribe: bus.subscribe,
    extensions: {
      contributions: async () => ({ settings: DEFINITIONS }),
      getSettingValues: async () => {
        if (loadError) throw loadError;
        return { ...stored };
      },
      setSettingValue: async (
        id: string,
        settingId: string,
        value: JsonValue,
      ) => {
        expect(id).toBe(ID);
        writes.push([settingId, value]);
        if (options.hold) {
          await new Promise<void>((resolve, reject) => {
            gates.push({ resolve, reject });
          });
        }
        if (settingId === 'acme.state.limit') {
          if (typeof value !== 'number') throw invalid('type');
          if (!Number.isInteger(value)) throw invalid('integer');
          if (value < 1 || value > 10) throw invalid('range');
        }
        if (settingId === 'acme.state.greeting') {
          if (typeof value === 'string' && value.length > 5) {
            throw invalid('max-length');
          }
        }
        if (settingId === 'acme.state.broken') {
          throw new FakeEngineError('INTERNAL', 'disk is full');
        }
        stored = { ...stored, [settingId]: value };
        return { ...stored };
      },
      resetSettingValues: async () => {
        stored = { ...DEFAULTS };
        return { ...stored };
      },
    },
  } as unknown as LearningEngine;
  const scope = effectScope();
  const model = scope.run(() => useExtensionSettings(engine, ID))!;
  return {
    model,
    bus,
    writes,
    gates,
    scope,
    store: (next: Record<string, JsonValue>) => {
      stored = next;
    },
    failLoad: (error: Error | undefined) => {
      loadError = error;
    },
  };
};

describe('parseNumberInput', () => {
  it('разбирает число и отвергает пустой и нечисловой ввод', () => {
    expect(parseNumberInput(' 4.5 ')).toBe(4.5);
    expect(parseNumberInput('-2')).toBe(-2);
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('  ')).toBeNull();
    expect(parseNumberInput('abc')).toBeNull();
    expect(parseNumberInput('Infinity')).toBeNull();
  });
});

describe('настройки расширения: загрузка', () => {
  it('берёт определения только этого расширения и его действующие значения', async () => {
    const { model } = setup();
    expect(model.state.value).toBe('loading');
    await flush();
    expect(model.state.value).toBe('loaded');
    expect(model.definitions.value.map(({ id }) => id)).toEqual([
      'acme.state.loud',
      'acme.state.greeting',
      'acme.state.limit',
      'acme.state.mode',
      'acme.state.tags',
    ]);
    expect(model.values.value).toEqual(DEFAULTS);
  });

  it('отказ движка (например, расширение отключено) показывается и повторяется', async () => {
    const refused = invalid('disabled', "Extension 'acme.state' is disabled");
    const { model, failLoad } = setup({ loadError: refused });
    await flush();
    expect(model.state.value).toBe('failed');
    expect(model.loadError.value).toBe("Extension 'acme.state' is disabled");

    failLoad(undefined);
    await model.load();
    expect(model.state.value).toBe('loaded');
    expect(model.loadError.value).toBeNull();
  });
});

describe('настройки расширения: список', () => {
  it('список записывается целиком; равный по содержимому список не пишется', async () => {
    const { model, writes } = setup();
    await flush();

    expect(await model.set('acme.state.tags', ['b', 'a'])).toBe(true);
    expect(model.values.value['acme.state.tags']).toEqual(['b', 'a']);
    expect(await model.set('acme.state.tags', ['b', 'a'])).toBe(true);
    expect(writes).toEqual([['acme.state.tags', ['b', 'a']]]);
  });
});

describe('настройки расширения: запись значения', () => {
  it('значение меняется сразу, ответ движка подтверждает', async () => {
    const { model, writes, gates } = setup({ hold: true });
    await flush();

    const done = model.set('acme.state.loud', true);
    expect(model.values.value['acme.state.loud']).toBe(true);
    expect(model.saving.value.has('acme.state.loud')).toBe(true);
    await flush();
    gates[0]?.resolve();
    expect(await done).toBe(true);

    expect(writes).toEqual([['acme.state.loud', true]]);
    expect(model.values.value['acme.state.loud']).toBe(true);
    expect(model.saving.value.size).toBe(0);
    expect(model.errors.value).toEqual({});
  });

  it.each([
    ['acme.state.greeting', 'too long text', 'max-length'],
    ['acme.state.limit', 11, 'range'],
    ['acme.state.limit', 2.5, 'integer'],
  ] as const)(
    'отказ движка по %s откатывает значение и оставляет причину «%s»',
    async (settingId, value, reason) => {
      const { model } = setup();
      await flush();
      const before = model.values.value[settingId];

      expect(await model.set(settingId, value)).toBe(false);

      expect(model.values.value[settingId]).toBe(before);
      expect(model.errors.value[settingId]).toEqual({
        reason,
        message: `invalid (${reason})`,
      });
      expect(model.saving.value.size).toBe(0);
    },
  );

  it('отказ по одному полю не трогает остальные; успех снимает ошибку', async () => {
    const { model } = setup();
    await flush();
    await model.set('acme.state.mode', 'b');
    await model.set('acme.state.limit', 99);
    expect(Object.keys(model.errors.value)).toEqual(['acme.state.limit']);
    expect(model.values.value['acme.state.mode']).toBe('b');

    expect(await model.set('acme.state.limit', 7)).toBe(true);
    expect(model.errors.value).toEqual({});
    expect(model.values.value['acme.state.limit']).toBe(7);
  });

  it('неизвестная ошибка движка показывается его сообщением без причины', async () => {
    const { model } = setup();
    await flush();
    await model.set('acme.state.broken', 1);
    expect(model.errors.value['acme.state.broken']).toEqual({
      reason: null,
      message: 'disk is full',
    });
  });

  it('нечисловой ввод отклоняется без обращения к движку', async () => {
    const { model, writes } = setup();
    await flush();
    expect(await model.set('acme.state.limit', 0, 'not-a-number')).toBe(false);
    expect(writes).toEqual([]);
    expect(model.errors.value['acme.state.limit']?.reason).toBe('not-a-number');
    expect(model.values.value['acme.state.limit']).toBe(3);
  });

  it('то же значение не уходит в движок, но снимает прежнюю ошибку', async () => {
    const { model, writes } = setup();
    await flush();
    await model.set('acme.state.limit', 99);
    expect(writes).toHaveLength(1);

    expect(await model.set('acme.state.limit', 3)).toBe(true);
    expect(writes).toHaveLength(1);
    expect(model.errors.value).toEqual({});
  });

  it('запоздалый отказ старой записи не откатывает более новую', async () => {
    const { model, gates } = setup({ hold: true });
    await flush();

    const first = model.set('acme.state.greeting', 'toolong');
    const second = model.set('acme.state.greeting', 'ok');
    await flush();
    gates[1]?.resolve();
    expect(await second).toBe(true);
    gates[0]?.resolve();
    expect(await first).toBe(false);

    expect(model.values.value['acme.state.greeting']).toBe('ok');
    expect(model.errors.value).toEqual({});
    expect(model.saving.value.size).toBe(0);
  });
});

describe('настройки расширения: сброс', () => {
  it('возвращает значения по умолчанию и снимает ошибки', async () => {
    const { model } = setup();
    await flush();
    await model.set('acme.state.loud', true);
    await model.set('acme.state.limit', 99);
    expect(model.values.value['acme.state.loud']).toBe(true);
    expect(Object.keys(model.errors.value)).toHaveLength(1);

    expect(await model.reset()).toBe(true);
    expect(model.values.value).toEqual(DEFAULTS);
    expect(model.errors.value).toEqual({});
    expect(model.resetting.value).toBe(false);
  });
});

describe('настройки расширения: изменения от движка', () => {
  it('settings-changed для этого расширения подтягивает значения без участия формы', async () => {
    const { model, bus, store } = setup();
    await flush();

    store({ ...DEFAULTS, 'acme.state.mode': 'b' });
    bus.emit({
      type: 'settings-changed',
      scope: 'extensionValues',
      extensionId: ID,
    });
    await flush();

    expect(model.values.value['acme.state.mode']).toBe('b');
  });

  it('событие другого расширения и другой области игнорируется', async () => {
    const { model, bus, store } = setup();
    await flush();

    store({ ...DEFAULTS, 'acme.state.mode': 'b' });
    bus.emit({
      type: 'settings-changed',
      scope: 'extensionValues',
      extensionId: 'acme.other',
    });
    bus.emit({ type: 'settings-changed', scope: 'ui' });
    await flush();

    expect(model.values.value['acme.state.mode']).toBe('a');
  });

  it('перечитанное не затирает значение, пока идёт запись', async () => {
    const { model, bus, gates, store } = setup({ hold: true });
    await flush();

    const done = model.set('acme.state.loud', true);
    await flush();
    store({ ...DEFAULTS });
    bus.emit({
      type: 'settings-changed',
      scope: 'extensionValues',
      extensionId: ID,
    });
    await flush();
    expect(model.values.value['acme.state.loud']).toBe(true);

    gates[0]?.resolve();
    await done;
    expect(model.values.value['acme.state.loud']).toBe(true);
  });

  it('после закрытия формы подписка снимается', async () => {
    const { bus, scope } = setup();
    await flush();
    expect(bus.count()).toBe(1);
    scope.stop();
    expect(bus.count()).toBe(0);
  });
});
