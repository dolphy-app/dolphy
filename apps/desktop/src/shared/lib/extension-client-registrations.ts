import type { Component } from 'vue';
import { z } from 'zod';
import {
  BUILTIN_THEME_IDS,
  DEFAULT_EXTENSION_ICON,
  EXTENSION_COMMAND_LIMITS,
  EXTENSION_ICONS,
  INJECTION_LIMITS,
  INJECTION_POSITIONS,
  MARKDOWN_LANGUAGE_PATTERN,
  THEME_COLOR_KEYS,
  THEME_VARIABLE_KEYS,
  isMountable,
  parseWhen,
} from '@dolphy-app/extension-api';
import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import type {
  AppApi,
  ClientContext,
  Disposable,
  ExtensionIconName,
  InjectionPosition,
  LocalizedText,
  Mountable,
  RegisteredKeybinding,
} from '@dolphy-app/extension-api';
import { PLATFORMS, validateBinding } from '@dolphy-app/keybindings';
import type { BindingProblem } from '@dolphy-app/keybindings';

/** Компонент расширения: Vue-компонент или `Mountable` любого фреймворка. */
export type ExtensionComponent =
  Component | Mountable<unknown, unknown, unknown>;

/** Панель, которую расширение добавило вызовом `addPanel`. */
export interface ClientPanel {
  kind: 'panel';
  /** Ключ экземпляра: меняется при каждой загрузке клиентской части. */
  key: string;
  extensionId: string;
  id: string;
  title: LocalizedText;
  icon: ExtensionIconName;
  when: string | null;
  /** `false`: панель рисует заголовок страницы сама, шапки приложения нет. */
  header: boolean;
  component: ExtensionComponent;
}

/** Компонент расширения, вставляемый в DOM окна (`addInjection`), с умолчаниями. */
export interface ClientInjection {
  kind: 'injection';
  key: string;
  extensionId: string;
  id: string;
  target: string;
  position: InjectionPosition;
  component: ExtensionComponent;
}

/** Компонент ввода ответа для вида задания (`addAnswerView`). */
export interface ClientAnswerView {
  kind: 'answerView';
  key: string;
  extensionId: string;
  type: string;
  component: ExtensionComponent;
}

/** Компонент блока markdown для языка (`addMarkdownRenderer`). */
export interface ClientMarkdownRenderer {
  kind: 'markdownRenderer';
  key: string;
  extensionId: string;
  language: string;
  component: ExtensionComponent;
}

/** Тема расширения (`addTheme`) с умолчаниями. */
export interface ClientTheme {
  kind: 'theme';
  key: string;
  extensionId: string;
  id: string;
  label: LocalizedText;
  dark: boolean;
  colors: Record<string, string>;
  variables: Record<string, string | number>;
}

/** Команда, чей обработчик работает в окне (`addCommand`), с умолчаниями. */
export interface ClientCommand {
  kind: 'command';
  key: string;
  extensionId: string;
  id: string;
  title: LocalizedText;
  description: LocalizedText | null;
  category: LocalizedText | null;
  palette: boolean;
  icon: ExtensionIconName;
  when: string | null;
  keybindings: RegisteredKeybinding[];
  run: () => void | Promise<void>;
}

export type ClientRegistration =
  | ClientPanel
  | ClientInjection
  | ClientAnswerView
  | ClientMarkdownRenderer
  | ClientTheme
  | ClientCommand;

/** Что нужно контексту от записи расширения: текущий набор вкладов и способ его изменить. */
export interface RegistrationSink {
  readonly extensionId: string;
  /** `AppApi` этого расширения: тот же объект, что `useApp()` в его компонентах. */
  readonly app: AppApi;
  /** Клиент движка окна: тот же объект, что `useEngine()`. */
  readonly engine: ExtensionEngine;
  /** Следующий ключ вклада этого экземпляра. */
  nextKey(): string;
  current(): readonly ClientRegistration[];
  add(registration: ClientRegistration): Disposable;
  /** Id серверных команд расширения: у клиентской команды такого id быть не может. */
  serverCommandIds(): ReadonlySet<string>;
}

const { titleLength, descriptionLength, categoryLength, whenLength } =
  EXTENSION_COMMAND_LIMITS;

const HEX_COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

const component = z.custom<ExtensionComponent>(
  (value) =>
    isMountable(value) ||
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null),
  'must be a Vue component or a Mountable',
);

const text = (max: number) =>
  z.union([
    z.string().min(1).max(max),
    z.strictObject({
      en: z.string().min(1).max(max),
      ru: z.string().min(1).max(max).optional(),
    }),
  ]);

const when = z
  .string()
  .min(1)
  .max(whenLength)
  .superRefine((value, ctx) => {
    try {
      parseWhen(value);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: `invalid condition: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

const problemText = (problem: BindingProblem): string => {
  if (problem.reason === 'typing') {
    return 'a key that types text needs a "when" inactive while inputFocus (for example "!inputFocus")';
  }
  if (problem.field === 'when') {
    return `invalid "when" (${problem.detail} at ${problem.position})`;
  }
  return `invalid key (${problem.detail})`;
};

const keybinding = z
  .strictObject({
    key: z.string().min(1),
    mac: z.string().min(1).optional(),
    windows: z.string().min(1).optional(),
    linux: z.string().min(1).optional(),
    when: z.string().min(1).max(whenLength).optional(),
  })
  .superRefine((binding, ctx) => {
    const condition = binding.when ?? null;
    const checks = [
      { path: 'key', key: binding.key, platforms: PLATFORMS },
      ...PLATFORMS.flatMap((platform) => {
        const override = binding[platform];
        return override === undefined
          ? []
          : [{ path: platform, key: override, platforms: [platform] }];
      }),
    ];
    for (const { path, key, platforms } of checks) {
      const problem = validateBinding({ key, when: condition }, platforms);
      if (problem !== null) {
        ctx.addIssue({
          code: 'custom',
          path: [path],
          message: problemText(problem),
        });
      }
    }
  });

const keybindings = z
  .array(keybinding)
  .max(EXTENSION_COMMAND_LIMITS.keybindingsPerCommand)
  .superRefine((bindings, ctx) => {
    const seen = new Set<string>();
    for (const [index, binding] of bindings.entries()) {
      const identity = `${binding.key.trim()}\u0000${binding.when?.trim() ?? ''}`;
      if (seen.has(identity)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'key'],
          message: `duplicate binding '${binding.key}'`,
        });
      }
      seen.add(identity);
    }
  });

const icon = z.enum(EXTENSION_ICONS).optional();

const panelSchema = z.strictObject({
  id: z.string(),
  title: text(titleLength),
  icon,
  when: when.optional(),
  header: z.boolean().optional(),
  component,
});

const injectionSchema = z.strictObject({
  id: z.string().min(1),
  target: z.string().min(1).max(INJECTION_LIMITS.selectorLength),
  position: z.enum(INJECTION_POSITIONS).optional(),
  component,
});

const themeColors = z
  .record(
    z.string(),
    z.string().regex(HEX_COLOR, 'must be #rrggbb or #rrggbbaa'),
  )
  .refine((colors) => Object.keys(colors).length > 0, 'must not be empty')
  .refine(
    (colors) =>
      Object.keys(colors).every((key) => THEME_COLOR_KEYS.includes(key)),
    `keys must be among: ${THEME_COLOR_KEYS.join(', ')}`,
  );

const themeVariables = z
  .record(z.string(), z.union([z.string(), z.number()]))
  .refine(
    (variables) =>
      Object.keys(variables).every((key) => THEME_VARIABLE_KEYS.includes(key)),
    `keys must be among: ${THEME_VARIABLE_KEYS.join(', ')}`,
  )
  .refine(
    (variables) =>
      Object.entries(variables).every(([key, value]) =>
        key === 'border-color'
          ? typeof value === 'string' && HEX_COLOR.test(value)
          : typeof value === 'number' && value >= 0 && value <= 1,
      ),
    'border-color must be a hex color, the others numbers in [0, 1]',
  );

const themeSchema = z.strictObject({
  id: z.string(),
  label: text(titleLength),
  dark: z.boolean(),
  colors: themeColors,
  variables: themeVariables.optional(),
});

const commandSchema = z.strictObject({
  id: z.string(),
  title: text(titleLength),
  description: text(descriptionLength).optional(),
  category: text(categoryLength).optional(),
  keybindings: keybindings.optional(),
  palette: z.boolean().optional(),
  when: when.optional(),
  icon,
  run: z.custom<() => void | Promise<void>>(
    (value) => typeof value === 'function',
    'must be a function',
  ),
});

const parse = <S extends z.ZodType>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map(
    ({ path, message }) => `${[what, ...path].join('.')}: ${message}`,
  );
  throw new Error(issues.join('; '));
};

const checkId = (extensionId: string, what: string, id: string): void => {
  if (id !== extensionId && !id.startsWith(`${extensionId}.`)) {
    throw new Error(
      `${what} id '${id}' must be '${extensionId}' or start with '${extensionId}.'`,
    );
  }
};

const ofKind = <K extends ClientRegistration['kind']>(
  sink: RegistrationSink,
  kind: K,
): Extract<ClientRegistration, { kind: K }>[] =>
  sink
    .current()
    .filter(
      (item): item is Extract<ClientRegistration, { kind: K }> =>
        item.kind === kind,
    );

const ensureRoom = (what: string, taken: number, limit: number): void => {
  if (taken >= limit) throw new Error(`at most ${limit} ${what} allowed`);
};

const ensureUnique = (
  what: string,
  value: string,
  existing: readonly string[],
): void => {
  if (existing.includes(value)) {
    throw new Error(`${what} '${value}' is already registered`);
  }
};

/**
 * Контекст клиентской части расширения: каждый вызов `add*` проверяет
 * регистрацию, добавляет её в набор расширения и возвращает `Disposable`,
 * который её снимает. Нарушение — исключение из вызова `add*`.
 */
export const createClientContext = (
  sink: RegistrationSink,
): ClientContext<ExtensionEngine> => {
  const { extensionId, app, engine } = sink;
  return {
    extensionId,
    app,
    engine,
    addPanel: (raw) => {
      const reg = parse(panelSchema, raw, 'panel');
      checkId(extensionId, 'panel', reg.id);
      const panels = ofKind(sink, 'panel');
      ensureRoom('panels', panels.length, EXTENSION_COMMAND_LIMITS.panels);
      ensureUnique(
        'panel',
        reg.id,
        panels.map(({ id }) => id),
      );
      return sink.add({
        kind: 'panel',
        key: sink.nextKey(),
        extensionId,
        id: reg.id,
        title: reg.title,
        icon: reg.icon ?? DEFAULT_EXTENSION_ICON,
        when: reg.when ?? null,
        header: reg.header ?? true,
        component: reg.component,
      });
    },
    addInjection: (raw) => {
      const reg = parse(injectionSchema, raw, 'injection');
      ensureUnique(
        'injection',
        reg.id,
        ofKind(sink, 'injection').map(({ id }) => id),
      );
      return sink.add({
        kind: 'injection',
        key: sink.nextKey(),
        extensionId,
        id: reg.id,
        target: reg.target,
        position: reg.position ?? 'append',
        component: reg.component,
      });
    },
    addAnswerView: (exerciseTypeId, raw) => {
      const type = parse(z.string().min(1), exerciseTypeId, 'answer view type');
      const view = parse(component, raw, 'answer view');
      ensureUnique(
        'answer view',
        type,
        ofKind(sink, 'answerView').map((item) => item.type),
      );
      return sink.add({
        kind: 'answerView',
        key: sink.nextKey(),
        extensionId,
        type,
        component: view,
      });
    },
    addMarkdownRenderer: (languageId, raw) => {
      const language = parse(
        z.string().regex(MARKDOWN_LANGUAGE_PATTERN, 'invalid language'),
        languageId,
        'markdown language',
      );
      const view = parse(component, raw, 'markdown renderer');
      ensureUnique(
        'markdown renderer',
        language,
        ofKind(sink, 'markdownRenderer').map((item) => item.language),
      );
      return sink.add({
        kind: 'markdownRenderer',
        key: sink.nextKey(),
        extensionId,
        language,
        component: view,
      });
    },
    addTheme: (raw) => {
      const reg = parse(themeSchema, raw, 'theme');
      checkId(extensionId, 'theme', reg.id);
      if ((BUILTIN_THEME_IDS as readonly string[]).includes(reg.id)) {
        throw new Error(
          `theme id '${reg.id}' is reserved for a built-in theme`,
        );
      }
      ensureUnique(
        'theme',
        reg.id,
        ofKind(sink, 'theme').map(({ id }) => id),
      );
      return sink.add({
        kind: 'theme',
        key: sink.nextKey(),
        extensionId,
        id: reg.id,
        label: reg.label,
        dark: reg.dark,
        colors: reg.colors,
        variables: reg.variables ?? {},
      });
    },
    addCommand: (raw) => {
      const reg = parse(commandSchema, raw, 'command');
      checkId(extensionId, 'command', reg.id);
      const commands = ofKind(sink, 'command');
      ensureRoom(
        'commands',
        commands.length,
        EXTENSION_COMMAND_LIMITS.commands,
      );
      ensureUnique(
        'command',
        reg.id,
        commands.map(({ id }) => id),
      );
      if (sink.serverCommandIds().has(reg.id)) {
        throw new Error(
          `command '${reg.id}' is already registered by the server part`,
        );
      }
      if (reg.palette === false && (reg.keybindings ?? []).length > 0) {
        throw new Error('keybindings need palette: true');
      }
      return sink.add({
        kind: 'command',
        key: sink.nextKey(),
        extensionId,
        id: reg.id,
        title: reg.title,
        description: reg.description ?? null,
        category: reg.category ?? null,
        palette: reg.palette ?? true,
        icon: reg.icon ?? DEFAULT_EXTENSION_ICON,
        when: reg.when ?? null,
        keybindings: (reg.keybindings ?? []).map((binding) => ({
          key: binding.key,
          mac: binding.mac ?? null,
          windows: binding.windows ?? null,
          linux: binding.linux ?? null,
          when: binding.when ?? null,
        })),
        run: reg.run,
      });
    },
  };
};
