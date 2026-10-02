import { build } from 'vite';
import { errorText, failureDetail, jobsOf } from './bundle.ts';
import type { Job } from './bundle.ts';
import { BuildError } from './errors.ts';
import type { Project } from './project.ts';

interface WatcherEvent {
  code: string;
  error?: unknown;
}

/** Структурный вид rolldown-вотчера, который возвращает `build` с `watch`. */
interface Watcher {
  on(event: 'event', listener: (event: WatcherEvent) => void): unknown;
  close(): Promise<void>;
}

const isWatcher = (value: unknown): value is Watcher =>
  typeof value === 'object' &&
  value !== null &&
  'on' in value &&
  'close' in value;

/** Итог одного цикла пересборки: что собралось и что сломалось (одинаковые причины — одной записью). */
export interface RebuildReport {
  rebuilt: string[];
  failures: { labels: string[]; detail: string }[];
}

/**
 * Правка исходника будит вотчеры всех файлов почти одновременно: события одного
 * цикла собираются в один отчёт, который уходит после тишины и когда ни один
 * вотчер не занят пересборкой.
 */
const SETTLE_MS = 150;

export interface Reporter {
  /** Вотчер начал пересборку (`START`). */
  begin(): void;
  /** Вотчер закончил пересборку (`END`), успешно или нет. */
  end(): void;
  rebuilt(job: Job): void;
  failed(job: Job, detail: string): void;
  close(): void;
}

export const createReporter = (
  onReport: (report: RebuildReport) => void,
  settleMs = SETTLE_MS,
): Reporter => {
  const rebuilt = new Set<string>();
  let failures: RebuildReport['failures'] = [];
  let busy = 0;
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    if (busy > 0) return;
    const report = { rebuilt: [...rebuilt], failures };
    rebuilt.clear();
    failures = [];
    if (report.rebuilt.length > 0 || report.failures.length > 0) {
      onReport(report);
    }
  };
  const touch = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, settleMs);
  };
  return {
    begin() {
      busy += 1;
    },
    end() {
      busy = Math.max(0, busy - 1);
      touch();
    },
    rebuilt(job) {
      rebuilt.add(job.output);
      touch();
    },
    failed(job, detail) {
      const same = failures.find((failure) => failure.detail === detail);
      if (same === undefined) failures.push({ labels: [job.label], detail });
      else if (!same.labels.includes(job.label)) same.labels.push(job.label);
      touch();
    },
    close() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
};

export interface BundleWatch {
  /** Все бандлы собрались с первого раза. */
  isHealthy: boolean;
  close(): Promise<void>;
}

const watchJob = async (
  job: Job,
  reporter: Reporter,
  isFailFast: boolean,
  failedFirst: Set<string>,
): Promise<{ watcher: Watcher; first: Promise<void> }> => {
  const started = await build({
    ...job.config,
    build: { ...job.config.build, watch: {} },
  });
  if (!isWatcher(started)) {
    throw new Error(`watch mode is not available for '${job.output}'`);
  }
  let isFirst = true;
  let hasFailed = false;
  const first = new Promise<void>((resolve, reject) => {
    started.on('event', (event) => {
      if (event.code === 'START') {
        reporter.begin();
        hasFailed = false;
        job.state.problem = null;
      }
      if (event.code === 'ERROR') {
        hasFailed = true;
        const detail = failureDetail(job, event.error);
        if (isFirst && isFailFast) reject(new Error(`${job.label}: ${detail}`));
        else reporter.failed(job, detail);
        if (isFirst) {
          failedFirst.add(job.output);
          resolve();
          isFirst = false;
        }
      }
      if (event.code === 'END') {
        reporter.end();
        if (isFirst) resolve();
        else if (!hasFailed) reporter.rebuilt(job);
        isFirst = false;
      }
    });
  });
  return { watcher: started, first };
};

/**
 * Запускает вотчеры всех бандлов проекта; резолвится после первой сборки каждого. Первая сборка с ошибкой — отказ
 * (`isFailFast`), иначе ошибка уходит в отчёт, а вотчер ждёт правки.
 */
export const watchAll = async (
  project: Project,
  outDir: string,
  reporter: Reporter,
  isFailFast: boolean,
): Promise<BundleWatch> => {
  const watchers: Watcher[] = [];
  const close = async (): Promise<void> => {
    await Promise.all(watchers.map((watcher) => watcher.close()));
  };
  const failedFirst = new Set<string>();
  try {
    const firsts: Promise<void>[] = [];
    for (const job of jobsOf(project, outDir)) {
      const { watcher, first } = await watchJob(
        job,
        reporter,
        isFailFast,
        failedFirst,
      );
      watchers.push(watcher);
      firsts.push(first);
    }
    await Promise.all(firsts);
  } catch (error) {
    await close();
    throw new BuildError(
      `failed to bundle: ${errorText(error)}`,
      project.manifest.id,
    );
  }
  return { isHealthy: failedFirst.size === 0, close };
};
