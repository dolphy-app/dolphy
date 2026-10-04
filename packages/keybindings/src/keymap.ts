import {
  KeybindingSyntaxError,
  matchKeystroke,
  parseChord,
  strokeKey,
} from './keystroke.ts';
import type { Chord, KeyEventLike } from './keystroke.ts';
import type { Platform } from './platform.ts';
import {
  evaluateWhen,
  parseWhen,
  whenOverlaps,
  WhenSyntaxError,
  whenToText,
} from './when.ts';
import type { ContextLookup, WhenExpr } from './when.ts';

/** Откуда привязка: код приложения, вклад расширения, настройки пользователя. */
export type BindingSource = 'default' | 'extension' | 'user';

/** Привязка из кода приложения или вклада расширения; `mac`/`windows`/`linux` заменяют `key` на своей платформе. */
export interface BindingDefinition {
  readonly command: string;
  readonly key: string;
  readonly mac?: string | null;
  readonly windows?: string | null;
  readonly linux?: string | null;
  readonly when?: string | null;
}

export interface UserBindingEntry {
  readonly key: string;
  readonly when: string | null;
}

/** Набор пользователя по ключам команд: заменяет привязки команды целиком (пустой — «снято»). */
export type UserKeybindings = Readonly<
  Record<string, readonly UserBindingEntry[]>
>;

export interface Binding {
  readonly command: string;
  readonly source: BindingSource;
  /** Запись клавиш для платформы окна, как задана. */
  readonly text: string;
  readonly chord: Chord;
  readonly when: WhenExpr | null;
  readonly whenText: string | null;
  /** Чем больше, тем выше приоритет. */
  readonly rank: number;
}

/** Запись, которую не удалось разобрать: карта её пропускает и сообщает. */
export interface BindingIssue {
  readonly source: BindingSource;
  readonly command: string;
  readonly key: string;
  readonly when: string | null;
  readonly field: 'key' | 'when';
  readonly reason: string;
}

export interface KeymapInput {
  readonly platform: Platform;
  readonly defaults: readonly BindingDefinition[];
  readonly extensions: readonly BindingDefinition[];
  readonly user: UserKeybindings;
}

export type Resolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'pending'; readonly binding: Binding }
  | { readonly kind: 'run'; readonly binding: Binding };

/**
 * Пересечение привязок разных команд: `same` — клавиши совпадают, `prefix` —
 * клавиши одной начинают цепочку другой; условия пересекаются. Побеждает
 * привязка с большим приоритетом.
 */
export interface Conflict {
  readonly kind: 'same' | 'prefix';
  readonly winner: Binding;
  readonly loser: Binding;
}

export interface Keymap {
  /** Действующие привязки по убыванию приоритета. */
  readonly bindings: readonly Binding[];
  readonly issues: readonly BindingIssue[];
  /** Привязки команды по убыванию приоритета. */
  forCommand(command: string): readonly Binding[];
  /**
   * Нажатия с начала цепочки (последнее — текущее): `run` — выполнить
   * команду, `pending` — ждать следующее нажатие, `none` — привязки нет.
   * Недоступные команды (`isEnabled`) и привязки с ложным условием не
   * участвуют.
   */
  resolve(
    presses: readonly KeyEventLike[],
    lookup: ContextLookup,
    isEnabled?: (command: string) => boolean,
  ): Resolution;
  conflicts(): readonly Conflict[];
}

const SOURCE_WEIGHT: Record<BindingSource, number> = {
  extension: 0,
  default: 1,
  user: 2,
};
const SOURCE_STEP = 1_000_000;

const issueReason = (error: unknown): string | null => {
  if (error instanceof KeybindingSyntaxError) return error.reason;
  if (error instanceof WhenSyntaxError) return error.reason;
  return null;
};

const compare = (left: Binding, right: Binding): Conflict['kind'] | null => {
  const common = Math.min(left.chord.length, right.chord.length);
  for (let index = 0; index < common; index++) {
    if (strokeKey(left.chord[index]!) !== strokeKey(right.chord[index]!)) {
      return null;
    }
  }
  return left.chord.length === right.chord.length ? 'same' : 'prefix';
};

/** Пересечение двух привязок разных команд или `null`. */
const conflictOf = (left: Binding, right: Binding): Conflict | null => {
  if (left.command === right.command) return null;
  const kind = compare(left, right);
  if (kind === null || !whenOverlaps(left.when, right.when)) return null;
  return left.rank >= right.rank
    ? { kind, winner: left, loser: right }
    : { kind, winner: right, loser: left };
};

const findConflictsIn = (bindings: readonly Binding[]): Conflict[] => {
  const buckets = new Map<string, Binding[]>();
  for (const binding of bindings) {
    const key = strokeKey(binding.chord[0]!);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [binding]);
    else bucket.push(binding);
  }
  const conflicts: Conflict[] = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const conflict = conflictOf(bucket[i]!, bucket[j]!);
        if (conflict !== null) conflicts.push(conflict);
      }
    }
  }
  return conflicts;
};

interface Raw {
  readonly command: string;
  readonly source: BindingSource;
  readonly key: string;
  readonly when: string | null;
  readonly index: number;
}

const compile = (
  raw: Raw,
  platform: Platform,
  issues: BindingIssue[],
): Binding | null => {
  const problem = (field: 'key' | 'when', error: unknown): null => {
    const reason = issueReason(error);
    if (reason === null) throw error;
    issues.push({
      source: raw.source,
      command: raw.command,
      key: raw.key,
      when: raw.when,
      field,
      reason,
    });
    return null;
  };
  let chord: Chord;
  try {
    chord = parseChord(raw.key, platform);
  } catch (error) {
    return problem('key', error);
  }
  let when: WhenExpr | null = null;
  if (raw.when !== null && raw.when.trim() !== '') {
    try {
      when = parseWhen(raw.when);
    } catch (error) {
      return problem('when', error);
    }
  }
  return {
    command: raw.command,
    source: raw.source,
    text: raw.key,
    chord,
    when,
    whenText: when === null ? null : whenToText(when),
    rank: SOURCE_WEIGHT[raw.source] * SOURCE_STEP + raw.index,
  };
};

const definitionKey = (
  definition: BindingDefinition,
  platform: Platform,
): string => definition[platform] ?? definition.key;

/**
 * Собирает действующие привязки: набор пользователя заменяет привязки команды
 * из кода и расширений целиком; приоритет `user` > `default` > `extension`,
 * внутри источника позднее выше. Записи, которые не разбираются (повреждённые
 * данные), пропускаются и попадают в `issues`.
 */
export const buildKeymap = (input: KeymapInput): Keymap => {
  const { platform, user } = input;
  const issues: BindingIssue[] = [];
  const replaced = new Set(Object.keys(user));
  const raws: Raw[] = [];

  const addDefinitions = (
    definitions: readonly BindingDefinition[],
    source: BindingSource,
  ) => {
    definitions.forEach((definition, index) => {
      if (replaced.has(definition.command)) return;
      raws.push({
        command: definition.command,
        source,
        key: definitionKey(definition, platform),
        when: definition.when ?? null,
        index,
      });
    });
  };
  addDefinitions(input.defaults, 'default');
  addDefinitions(input.extensions, 'extension');

  let userIndex = 0;
  for (const [command, entries] of Object.entries(user)) {
    for (const entry of entries) {
      raws.push({
        command,
        source: 'user',
        key: entry.key,
        when: entry.when,
        index: userIndex++,
      });
    }
  }

  const bindings = raws
    .map((raw) => compile(raw, platform, issues))
    .filter((binding) => binding !== null)
    .sort((left, right) => right.rank - left.rank);

  const byCommand = new Map<string, Binding[]>();
  for (const binding of bindings) {
    const list = byCommand.get(binding.command);
    if (list === undefined) byCommand.set(binding.command, [binding]);
    else list.push(binding);
  }

  return {
    bindings,
    issues,
    forCommand: (command) => byCommand.get(command) ?? [],
    resolve: (presses, lookup, isEnabled) => {
      for (const binding of bindings) {
        if (binding.chord.length < presses.length) continue;
        const matches = presses.every((press, index) =>
          matchKeystroke(press, binding.chord[index]!),
        );
        if (!matches) continue;
        if (!evaluateWhen(binding.when, lookup)) continue;
        if (isEnabled !== undefined && !isEnabled(binding.command)) continue;
        return binding.chord.length > presses.length
          ? { kind: 'pending', binding }
          : { kind: 'run', binding };
      }
      return { kind: 'none' };
    },
    conflicts: () => findConflictsIn(bindings),
  };
};

export interface Candidate {
  readonly command: string;
  readonly chord: Chord;
  readonly when: WhenExpr | null;
}

/**
 * Пересечения кандидата с действующими привязками **других** команд (набор
 * самой команды заменяется кандидатами, поэтому его привязки не сравниваются).
 * Для интерфейса записи сочетания: список до сохранения.
 */
export const findCandidateConflicts = (
  keymap: Keymap,
  candidate: Candidate,
): Conflict[] => {
  const self: Binding = {
    command: candidate.command,
    source: 'user',
    text: '',
    chord: candidate.chord,
    when: candidate.when,
    whenText: null,
    rank: Number.MAX_SAFE_INTEGER,
  };
  return keymap.bindings
    .map((binding) => conflictOf(self, binding))
    .filter((conflict) => conflict !== null);
};
