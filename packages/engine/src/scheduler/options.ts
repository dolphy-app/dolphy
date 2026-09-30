import type {
  DeepPartial,
  MasteryWindowDto,
  MasteryWindowName,
  SchedulerOptionsDto,
} from '@dolphy-app/engine-contract';

/** Оценка, при которой дробный отбор урока достигает 100% кандидатов. */
export const FULL_CANDIDATES_SCORE = 4.0;

const MAX_SCORE = 5.0;
const PERCENTAGE_TOLERANCE = 1e-6;

/** Порядок окон, как в `SchedulerOptions` Trane. */
export const MASTERY_WINDOW_NAMES: readonly MasteryWindowName[] = [
  'new',
  'target',
  'current',
  'easy',
  'mastered',
];

const deepFreeze = <T extends object>(value: T): T => {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
};

/** Умолчания `SchedulerOptions::default()` (data.rs:1056-1085) плюс F-слой. */
export const DEFAULT_SCHEDULER_OPTIONS: Readonly<SchedulerOptionsDto> =
  deepFreeze({
    batchSize: 50,
    relearnFraction: 0.1,
    masteryWindows: {
      new: { percentage: 0.2, range: [0.0, 0.1] },
      target: { percentage: 0.2, range: [0.1, 2.5] },
      current: { percentage: 0.3, range: [2.5, 3.75] },
      easy: { percentage: 0.2, range: [3.75, 4.5] },
      mastered: { percentage: 0.1, range: [4.5, 5.0] },
    },
    passingScore: { minScore: 3.0, minFraction: 0.5, minAvgTrials: 1.8 },
    supersedingScore: 4.0,
    numTrials: 20,
    numRewards: 10,
    maxLessonsInProgress: 10,
    implicitCredit: { enabled: false, lambda: 0.9, minCredit: 0.2, kappa: 1 },
    remediation: { failThreshold: 2, maxItems: 3 },
    plan: {
      targetRetention: 0.9,
      minNewFraction: 0.25,
      maxSameCourseRun: 2,
      minTagDistance: 2,
    },
  });

/** Оценка `score` в окне: последнее окно включает верхнюю границу 5.0. */
export const isInWindow = (window: MasteryWindowDto, score: number) => {
  const [low, high] = window.range;
  if (high >= MAX_SCORE && score >= MAX_SCORE) return true;
  return low <= score && score < high;
};

/** Окно оценки или `null`, если она попала в разрыв между окнами. */
export const windowNameOf = (
  options: Pick<SchedulerOptionsDto, 'masteryWindows'>,
  score: number,
): MasteryWindowName | null => {
  for (const name of MASTERY_WINDOW_NAMES) {
    if (isInWindow(options.masteryWindows[name], score)) return name;
  }
  return null;
};

/** Опции не прошли `verify`; `issues` — все найденные нарушения. */
export class InvalidSchedulerOptionsError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid scheduler options: ${issues.join('; ')}`);
    this.name = 'InvalidSchedulerOptionsError';
    this.issues = issues;
  }
}

const isClose = (a: number, b: number) =>
  Math.abs(a - b) < PERCENTAGE_TOLERANCE;

const isFraction = (value: number) =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const isPositiveInteger = (value: number) =>
  Number.isSafeInteger(value) && value >= 1;

const isNonNegativeInteger = (value: number) =>
  Number.isSafeInteger(value) && value >= 0;

const collectWindowIssues = (
  options: SchedulerOptionsDto,
  issues: string[],
) => {
  const { masteryWindows: windows } = options;
  let sum = 0;
  for (const name of MASTERY_WINDOW_NAMES) {
    const { percentage, range } = windows[name];
    sum += percentage;
    const isFiniteRange = range.length === 2 && range.every(Number.isFinite);
    if (!isFraction(percentage)) {
      issues.push(`invalid percentage of the ${name} window: ${percentage}`);
    }
    if (!isFiniteRange) issues.push(`invalid range of the ${name} window`);
  }
  if (!isClose(sum, 1.0)) {
    issues.push(`mastery window percentages sum to ${sum}, expected 1.0`);
  }
  if (!isClose(windows.new.range[0], 0.0)) {
    issues.push('the new window must start at 0.0');
  }
  if (!isClose(windows.mastered.range[1], MAX_SCORE)) {
    issues.push('the mastered window must end at 5.0');
  }
  const joints: ReadonlyArray<readonly [MasteryWindowName, MasteryWindowName]> =
    [
      ['new', 'target'],
      ['target', 'current'],
      ['current', 'easy'],
      ['easy', 'mastered'],
    ];
  for (const [lower, upper] of joints) {
    if (!isClose(windows[lower].range[1], windows[upper].range[0])) {
      issues.push(`gap between the ${lower} and ${upper} windows`);
    }
  }
};

const collectPassingIssues = (
  options: SchedulerOptionsDto,
  issues: string[],
) => {
  const { minScore, minFraction, minAvgTrials } = options.passingScore;
  if (!(minScore >= 0 && minScore < FULL_CANDIDATES_SCORE)) {
    issues.push(`invalid minimum score: ${minScore}`);
  }
  if (!isFraction(minFraction)) {
    issues.push(`invalid minimum fraction: ${minFraction}`);
  }
  if (!(Number.isFinite(minAvgTrials) && minAvgTrials >= 1.0)) {
    issues.push(`invalid minimum average trials: ${minAvgTrials}`);
  }
};

const collectFeatureIssues = (
  options: SchedulerOptionsDto,
  issues: string[],
) => {
  const { implicitCredit, remediation, plan } = options;
  const { lambda, minCredit, kappa } = implicitCredit;
  if (!(lambda > 0 && lambda <= 1)) issues.push(`invalid lambda: ${lambda}`);
  if (!(minCredit > 0 && minCredit <= 1)) {
    issues.push(`invalid minimum credit: ${minCredit}`);
  }
  if (!(Number.isFinite(kappa) && kappa > 0)) {
    issues.push(`invalid kappa: ${kappa}`);
  }
  if (!isPositiveInteger(remediation.failThreshold)) {
    issues.push(`invalid fail threshold: ${remediation.failThreshold}`);
  }
  if (!isPositiveInteger(remediation.maxItems)) {
    issues.push(`invalid remediation max items: ${remediation.maxItems}`);
  }
  if (!(plan.targetRetention > 0 && plan.targetRetention < 1)) {
    issues.push(`invalid target retention: ${plan.targetRetention}`);
  }
  if (!isFraction(plan.minNewFraction)) {
    issues.push(`invalid minimum new fraction: ${plan.minNewFraction}`);
  }
  if (!isPositiveInteger(plan.maxSameCourseRun)) {
    issues.push(`invalid max same course run: ${plan.maxSameCourseRun}`);
  }
  if (!isNonNegativeInteger(plan.minTagDistance)) {
    issues.push(`invalid minimum tag distance: ${plan.minTagDistance}`);
  }
};

/**
 * `SchedulerOptions::verify` (data.rs:~1000-1050): проверки Trane плюс
 * целочисленность и конечность полей и диапазоны F-слоя [ВЫВОД]. Сумма
 * процентов и стыки окон сравниваются с допуском 1e-6 (в f64 сумма 0.2 + 0.2
 * + 0.3 + 0.2 + 0.1 не равна 1.0 точно). Бросает `InvalidSchedulerOptionsError`.
 */
export const verifySchedulerOptions = (options: SchedulerOptionsDto) => {
  const issues: string[] = [];
  if (!isPositiveInteger(options.batchSize)) {
    issues.push(`invalid batch size: ${options.batchSize}`);
  }
  if (!isFraction(options.relearnFraction)) {
    issues.push(`invalid relearn fraction: ${options.relearnFraction}`);
  }
  collectPassingIssues(options, issues);
  collectWindowIssues(options, issues);
  if (!isPositiveInteger(options.maxLessonsInProgress)) {
    issues.push(
      `invalid max lessons in progress: ${options.maxLessonsInProgress}`,
    );
  }
  if (!isPositiveInteger(options.numTrials)) {
    issues.push(`invalid number of trials: ${options.numTrials}`);
  }
  if (!isNonNegativeInteger(options.numRewards)) {
    issues.push(`invalid number of rewards: ${options.numRewards}`);
  }
  if (!Number.isFinite(options.supersedingScore)) {
    issues.push(`invalid superseding score: ${options.supersedingScore}`);
  }
  collectFeatureIssues(options, issues);
  if (issues.length > 0) throw new InvalidSchedulerOptionsError(issues);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Глубокое слияние: объекты — по ключам, массивы — по индексам, `undefined` пропускается. */
const mergeValue = (base: unknown, patch: unknown): unknown => {
  if (patch === undefined) return base;
  if (Array.isArray(base) && Array.isArray(patch)) {
    return base.map((item, index) => mergeValue(item, patch[index]));
  }
  if (isPlainObject(base) && isPlainObject(patch)) {
    const merged: Record<string, unknown> = {};
    for (const key of Object.keys(base)) {
      merged[key] = mergeValue(base[key], patch[key]);
    }
    return merged;
  }
  return patch;
};

/** Опции с применённым патчем; входные объекты не меняются. */
export const applySchedulerPatch = (
  base: SchedulerOptionsDto,
  patch: DeepPartial<SchedulerOptionsDto>,
): SchedulerOptionsDto => mergeValue(base, patch) as SchedulerOptionsDto;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const diffValue = (base: unknown, next: unknown): unknown => {
  if (isPlainRecord(base) && isPlainRecord(next)) {
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(next)) {
      const part = diffValue(base[key], next[key]);
      if (part !== undefined) changed[key] = part;
    }
    return Object.keys(changed).length > 0 ? changed : undefined;
  }
  // массивы (границы окон) сохраняются целиком: патч по индексам хрупок
  return JSON.stringify(base) === JSON.stringify(next) ? undefined : next;
};

/** Патч, который превращает `base` в `next`; `{}`, если опции совпадают. */
export const diffSchedulerOptions = (
  base: SchedulerOptionsDto,
  next: SchedulerOptionsDto,
): DeepPartial<SchedulerOptionsDto> =>
  (diffValue(base, next) ?? {}) as DeepPartial<SchedulerOptionsDto>;

/**
 * Сохранённые отличия от умолчаний → патч. Содержимое проверяет
 * `verifySchedulerOptions` при применении; не объект — «своих значений нет».
 */
export const decodeSchedulerOverrides = (
  raw: unknown,
): DeepPartial<SchedulerOptionsDto> =>
  isPlainRecord(raw) ? (raw as DeepPartial<SchedulerOptionsDto>) : {};

const cloneOptions = (options: SchedulerOptionsDto): SchedulerOptionsDto =>
  structuredClone(options);

/** Предпочтения ученика, влияющие на опции (`create_scheduler_options`). */
export interface SchedulerPreferences {
  readonly batchSize?: number | null;
}

/**
 * Умолчания с подменой `batchSize` из предпочтений; результат проходит
 * `verifySchedulerOptions` (в Trane — `lib.rs:184`, `verify` на `lib.rs:273`).
 */
export const createSchedulerOptions = (
  preferences: SchedulerPreferences = {},
): SchedulerOptionsDto => {
  const options = cloneOptions(DEFAULT_SCHEDULER_OPTIONS);
  if (preferences.batchSize !== undefined && preferences.batchSize !== null) {
    options.batchSize = preferences.batchSize;
  }
  verifySchedulerOptions(options);
  return deepFreeze(options);
};

export type SchedulerOptionsListener = (options: SchedulerOptionsDto) => void;

/**
 * Единый источник опций планировщика. Компоненты читают `get()` при каждом
 * вычислении, поэтому `set` доходит до всех сразу (в Rust у `UnitScorer`,
 * `CandidateFilter`, `ReviewKnocker`, `RelearnPile` устаревшие клоны).
 */
export interface SchedulerOptionsHolder {
  /** Текущий неизменяемый снимок. */
  get(): SchedulerOptionsDto;
  /**
   * Применяет патч атомарно: невалидный результат бросает
   * `InvalidSchedulerOptionsError` и не меняет состояние.
   */
  set(patch: DeepPartial<SchedulerOptionsDto>): SchedulerOptionsDto;
  /** Возвращает опции, с которыми создан холдер (умолчания или предпочтения). */
  reset(): SchedulerOptionsDto;
  /** Слушатель вызывается после каждого успешного `set`/`reset`. */
  subscribe(listener: SchedulerOptionsListener): () => void;
}

export const createSchedulerOptionsHolder = (
  initial: SchedulerOptionsDto = createSchedulerOptions(),
): SchedulerOptionsHolder => {
  verifySchedulerOptions(initial);
  const baseline = deepFreeze(cloneOptions(initial));
  let current = baseline;
  const listeners = new Set<SchedulerOptionsListener>();

  const publish = (next: SchedulerOptionsDto) => {
    current = next;
    for (const listener of listeners) listener(next);
    return next;
  };

  const set = (patch: DeepPartial<SchedulerOptionsDto>) => {
    const next = applySchedulerPatch(current, patch);
    verifySchedulerOptions(next);
    return publish(deepFreeze(next));
  };

  const reset = () => publish(baseline);

  const subscribe = (listener: SchedulerOptionsListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get: () => current, set, reset, subscribe };
};
