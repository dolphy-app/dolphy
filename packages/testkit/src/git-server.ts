/**
 * Тестовый git-сервер: smart-HTTP поверх `git http-backend` (CGI).
 *
 * Требует системный `git` с `http-backend` (только для тестов; продуктовый код
 * системный git не использует). Репозитории создаются в временном каталоге
 * через plumbing-команды (`hash-object`, `mktree`, `commit-tree`), поэтому
 * можно сохранить то, что porcelain не даёт: симлинки, gitlink, пути `.git`
 * и `..`, пути, различающиеся только регистром. `close()` удаляет каталог.
 *
 * URL: `http://127.0.0.1:<port>/<name>.git`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Запись дерева: обычный файл, исполняемый файл, симлинк или gitlink. */
export type GitEntry =
  | string
  | Uint8Array
  | { executable: string | Uint8Array }
  | { symlink: string }
  | { gitlink: string };

/** Путь → запись. Путь делится по `/`; сегменты не проверяются (`..`, `.git`). */
export type GitFiles = Record<string, GitEntry>;

export interface GitRepoSpec {
  /** Имя в URL без `.git`; по умолчанию `repo`. */
  name?: string;
  /** Содержимое первого коммита. */
  files: GitFiles;
  /** Ветка по умолчанию (`HEAD`); по умолчанию `main`. */
  branch?: string;
  /** Лёгкие теги на первом коммите. */
  tags?: string[];
  /** Аннотированные теги на первом коммите. */
  annotatedTags?: string[];
}

export interface GitServerOptions {
  /** Отвечать этим статусом на любой запрос (401 с `WWW-Authenticate`, 404…). */
  status?: number;
  /** Задержать любой ответ на столько миллисекунд (проверка таймаута). */
  stallMs?: number;
}

export interface GitServer {
  /** URL первого репозитория. */
  readonly url: string;
  /** URL репозитория по имени. */
  urlOf(name: string): string;
  /** Новый коммит с полным новым деревом; возвращает SHA коммита. */
  commit(files: GitFiles, message?: string, repo?: string): string;
  /** Лёгкий или аннотированный тег на коммит (по умолчанию — конец ветки). */
  tag(
    name: string,
    options?: { repo?: string; annotated?: boolean; commit?: string },
  ): void;
  /** Новая ветка на коммит (по умолчанию — конец ветки по умолчанию). */
  branch(name: string, options?: { repo?: string; commit?: string }): void;
  /** SHA-1 вершины ссылки (`main`, `refs/tags/v1`, `HEAD`). */
  revParse(ref: string, repo?: string): string;
  /** Меняет поведение на лету; `undefined` — вернуть обычное. */
  configure(options: GitServerOptions): void;
  close(): Promise<void>;
}

const AUTHOR_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z',
};

const git = (
  cwd: string,
  args: string[],
  input?: string | Uint8Array,
): string => {
  const r = spawnSync('git', args, {
    cwd,
    input: input as string | Uint8Array | undefined,
    env: { ...process.env, ...AUTHOR_ENV, GIT_CONFIG_NOSYSTEM: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${r.error?.message ?? r.stderr}`,
    );
  }
  return r.stdout.trim();
};

const hashBlob = (cwd: string, content: string | Uint8Array): string =>
  git(cwd, ['hash-object', '-w', '--stdin'], content);

interface TreeNode {
  blobs: Map<string, { mode: string; oid: string }>;
  dirs: Map<string, TreeNode>;
}

const writeTree = (cwd: string, node: TreeNode): string => {
  const lines: string[] = [];
  for (const [name, b] of node.blobs) {
    const type = b.mode === '160000' ? 'commit' : 'blob';
    lines.push(`${b.mode} ${type} ${b.oid}\t${name}`);
  }
  for (const [name, dir] of node.dirs) {
    lines.push(`040000 tree ${writeTree(cwd, dir)}\t${name}`);
  }
  return git(cwd, ['mktree', '--missing'], `${lines.join('\n')}\n`);
};

const buildTree = (cwd: string, files: GitFiles): string => {
  const root: TreeNode = { blobs: new Map(), dirs: new Map() };
  for (const [path, entry] of Object.entries(files)) {
    const segments = path.split('/');
    const name = segments.pop() as string;
    let node = root;
    for (const segment of segments) {
      let next = node.dirs.get(segment);
      if (!next) {
        next = { blobs: new Map(), dirs: new Map() };
        node.dirs.set(segment, next);
      }
      node = next;
    }
    if (typeof entry === 'string' || entry instanceof Uint8Array) {
      node.blobs.set(name, { mode: '100644', oid: hashBlob(cwd, entry) });
    } else if ('executable' in entry) {
      node.blobs.set(name, {
        mode: '100755',
        oid: hashBlob(cwd, entry.executable),
      });
    } else if ('symlink' in entry) {
      node.blobs.set(name, {
        mode: '120000',
        oid: hashBlob(cwd, entry.symlink),
      });
    } else {
      node.blobs.set(name, { mode: '160000', oid: entry.gitlink });
    }
  }
  return writeTree(cwd, root);
};

interface Repo {
  dir: string;
  branch: string;
}

const parseCgi = (
  head: string,
): { status: number; headers: Array<[string, string]> } => {
  let status = 200;
  const headers: Array<[string, string]> = [];
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key.toLowerCase() === 'status') status = Number.parseInt(value, 10);
    else headers.push([key, value]);
  }
  return { status, headers };
};

/**
 * Поднимает сервер на `127.0.0.1:<случайный порт>` для одного или нескольких
 * репозиториев.
 */
export const serveGitRepo = async (
  specs: GitRepoSpec | GitRepoSpec[],
  initial: GitServerOptions = {},
): Promise<GitServer> => {
  const list = Array.isArray(specs) ? specs : [specs];
  const root = mkdtempSync(join(tmpdir(), 'lms-git-server-'));
  const repos = new Map<string, Repo>();
  let options: GitServerOptions = { ...initial };

  const repoOf = (name: string | undefined): Repo => {
    const key = name ?? list[0]?.name ?? 'repo';
    const repo = repos.get(key);
    if (!repo) throw new Error(`unknown repo ${key}`);
    return repo;
  };

  const commitTo = (
    repo: Repo,
    files: GitFiles,
    message: string,
    parent: string | null,
  ): string => {
    const tree = buildTree(repo.dir, files);
    const args = ['commit-tree', tree, '-m', message];
    if (parent) args.push('-p', parent);
    const commit = git(repo.dir, args);
    git(repo.dir, ['update-ref', `refs/heads/${repo.branch}`, commit]);
    return commit;
  };

  const tagIn = (
    repo: Repo,
    name: string,
    commit: string,
    annotated: boolean,
  ): void => {
    const args = annotated
      ? ['tag', '-a', '-m', `tag ${name}`, name, commit]
      : ['tag', name, commit];
    git(repo.dir, args);
  };

  try {
    for (const spec of list) {
      const name = spec.name ?? 'repo';
      const dir = join(root, `${name}.git`);
      const branch = spec.branch ?? 'main';
      mkdirSync(dir, { recursive: true });
      git(dir, ['init', '--bare', `--initial-branch=${branch}`]);
      const repo: Repo = { dir, branch };
      repos.set(name, repo);
      const commit = commitTo(repo, spec.files, 'initial', null);
      for (const t of spec.tags ?? []) tagIn(repo, t, commit, false);
      for (const t of spec.annotatedTags ?? []) tagIn(repo, t, commit, true);
    }
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }

  const timers = new Set<NodeJS.Timeout>();

  const serveCgi = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: root,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: req.method ?? 'GET',
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: req.headers['content-type'] ?? '',
      REMOTE_ADDR: '127.0.0.1',
    };
    if (req.headers['content-length'] !== undefined) {
      env.CONTENT_LENGTH = req.headers['content-length'];
    }
    if (req.headers['content-encoding'] !== undefined) {
      env.HTTP_CONTENT_ENCODING = req.headers['content-encoding'];
    }
    if (typeof req.headers['git-protocol'] === 'string') {
      env.GIT_PROTOCOL = req.headers['git-protocol'];
    }
    const child = spawn('git', ['http-backend'], {
      env,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    res.on('close', () => child.kill());
    child.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    req.pipe(child.stdin);
    child.stdin.on('error', () => undefined);

    let buffered = Buffer.alloc(0);
    let headDone = false;
    child.stdout.on('data', (chunk: Buffer) => {
      if (headDone) {
        res.write(chunk);
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);
      const crlf = buffered.indexOf('\r\n\r\n');
      const lf = buffered.indexOf('\n\n');
      let end = -1;
      let sep = 0;
      if (crlf >= 0 && (lf < 0 || crlf < lf)) {
        end = crlf;
        sep = 4;
      } else if (lf >= 0) {
        end = lf;
        sep = 2;
      }
      if (end < 0) return;
      headDone = true;
      const { status, headers } = parseCgi(
        buffered.subarray(0, end).toString(),
      );
      res.writeHead(status, headers.flat());
      res.write(buffered.subarray(end + sep));
    });
    child.stdout.on('end', () => {
      if (!headDone && !res.headersSent) res.writeHead(500);
      res.end();
    });
  };

  const server: Server = createServer((req, res) => {
    const respond = (): void => {
      if (options.status !== undefined) {
        const headers: Record<string, string> = {
          'content-type': 'text/plain',
        };
        if (options.status === 401) {
          headers['www-authenticate'] = 'Basic realm="git"';
        }
        res.writeHead(options.status, headers);
        res.end(`status ${options.status}`);
        req.resume();
        return;
      }
      serveCgi(req, res);
    };
    if (options.stallMs) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        respond();
      }, options.stallMs);
      timers.add(timer);
      res.on('close', () => {
        clearTimeout(timer);
        timers.delete(timer);
      });
    } else {
      respond();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const firstName = list[0]?.name ?? 'repo';

  return {
    url: `${base}/${firstName}.git`,
    urlOf: (name) => `${base}/${name}.git`,
    commit(files, message = 'commit', repo) {
      const r = repoOf(repo);
      const parent = git(r.dir, ['rev-parse', `refs/heads/${r.branch}`]);
      return commitTo(r, files, message, parent);
    },
    tag(name, opts = {}) {
      const r = repoOf(opts.repo);
      const commit =
        opts.commit ?? git(r.dir, ['rev-parse', `refs/heads/${r.branch}`]);
      tagIn(r, name, commit, opts.annotated ?? false);
    },
    branch(name, opts = {}) {
      const r = repoOf(opts.repo);
      const commit =
        opts.commit ?? git(r.dir, ['rev-parse', `refs/heads/${r.branch}`]);
      git(r.dir, ['update-ref', `refs/heads/${name}`, commit]);
    },
    revParse(ref, repo) {
      return git(repoOf(repo).dir, ['rev-parse', `${ref}^{commit}`]);
    },
    configure(next) {
      options = { ...next };
    },
    async close() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      rmSync(root, { recursive: true, force: true });
    },
  };
};
