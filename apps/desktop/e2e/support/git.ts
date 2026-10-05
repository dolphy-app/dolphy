import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
// Тип из git-сервера @dolphy-app/testkit; сам сервер e2e берёт из файла, а не из
// индекса пакета: индекс тянет движок и fast-check (их нет среди зависимостей
// приложения)
import type { GitFiles } from '../../../../packages/testkit/src/git-server.ts';

const GIT_COURSE_SOURCE = fileURLToPath(
  new URL('../../dev-library/git_kb', import.meta.url),
);

/** Курс, которого нет среди `dev:seed`: id и названия свои, дерево — курс `git_kb`. */
export const REMOTE_COURSE = {
  id: 'git_remote',
  name: 'Git из репозитория',
  lesson: 'Коммиты из репозитория',
  updatedLesson: 'Коммиты, вторая редакция',
  /** Занят курсом `git_kb` из `dev:seed`. */
  seededId: 'git_kb',
} as const;

const walk = (root: string, dir = ''): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = posix.join(dir, name);
    return statSync(join(root, path)).isDirectory() ? walk(root, path) : [path];
  });

export interface CourseTreeOptions {
  /** `id` из `course_manifest.json`; по умолчанию `REMOTE_COURSE.id`. */
  id?: string;
  /** Название курса; по умолчанию `REMOTE_COURSE.name`. */
  name?: string;
  /** Название первого урока. */
  lessonName?: string;
  /** Курс прямо в корне репозитория, а не в каталоге `<id>/`. */
  atRoot?: boolean;
}

/**
 * Дерево небольшого настоящего курса (3 урока, 9 упражнений) для коммита:
 * копия `dev-library/git_kb` с другим id, названием курса и первого урока.
 * По умолчанию курс лежит в каталоге репозитория (`<id>/`), с `atRoot` —
 * манифест прямо в корне репозитория.
 */
export const courseTree = (options: CourseTreeOptions = {}): GitFiles => {
  const id = options.id ?? REMOTE_COURSE.id;
  const lessonName = options.lessonName ?? REMOTE_COURSE.lesson;
  const files: GitFiles = {};
  for (const relative of walk(GIT_COURSE_SOURCE)) {
    const path = options.atRoot ? relative : posix.join(id, relative);
    const content = readFileSync(join(GIT_COURSE_SOURCE, relative), 'utf8');
    if (relative === 'course_manifest.json') {
      const manifest = JSON.parse(content) as Record<string, unknown>;
      files[path] = `${JSON.stringify(
        { ...manifest, id, name: options.name ?? REMOTE_COURSE.name },
        null,
        2,
      )}\n`;
    } else if (relative === 'commits.lesson/lesson.name.json') {
      files[path] = `${JSON.stringify(lessonName)}\n`;
    } else {
      files[path] = content;
    }
  }
  return files;
};

export interface RepositoryRow {
  id: string;
  url: string;
  ref: string | null;
  commit: string;
  fetchedAt: number;
  courseIds: string[];
  selected?: string[];
  skippedCourseIds?: string[];
  lastError?: unknown;
}

/** Реестр репозиториев из `engine.db` (чтение, приложение может быть запущено). */
export const readRepositories = (userData: string): RepositoryRow[] => {
  const db = new Database(join(userData, 'data', 'engine.db'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return (
      db.prepare('select body from repository order by id').all() as {
        body: string;
      }[]
    ).map((row) => JSON.parse(row.body) as RepositoryRow);
  } finally {
    db.close();
  }
};
