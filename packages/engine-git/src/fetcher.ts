import { mkdir, writeFile } from 'node:fs/promises';
import * as nodeFs from 'node:fs';
import { join } from 'node:path';

import {
  GitFetchError,
  type FetchedSnapshot,
  type FetchSnapshotRequest,
  type GitSnapshotFetcher,
  type ResolvedRef,
  type ResolveRequest,
  DEFAULT_SNAPSHOT_LIMITS,
  SnapshotRejectedError,
  type SnapshotLimits,
} from '@lms/engine/ports';
import git from 'isomorphic-git';
import type {
  GitHttpRequest,
  GitHttpResponse,
  HttpClient,
} from 'isomorphic-git';

/** Ограничения одной сетевой операции (`resolve` или `fetchSnapshot`). */
interface NetworkLimits {
  idleTimeoutMs: number;
  /**
   * Потолок байт в ответах `git-upload-pack` (pack); `undefined` — без
   * потолка. Адвертайз ссылок в счёт не идёт.
   */
  maxBytes?: number;
}

/** Состояние сетевой сессии: нужно, чтобы разобрать причину обрыва. */
interface Session {
  http: HttpClient;
  readonly timedOut: boolean;
  readonly tooLarge: boolean;
  readonly received: number;
  dispose(): void;
}

/**
 * Запас к `maxBytes` для pack: деревья, коммит и протокольные рамки не входят
 * в размер файлов снимка.
 */
const PROTOCOL_SLACK_BYTES = 1024 * 1024;

/** `.git` и его короткое имя NTFS `git~1`, в т.ч. с хвостовыми точками/пробелами. */
const GIT_SEGMENT = /^(\.git|git~\d+)[. ]*$/i;

/**
 * HTTP-клиент для isomorphic-git поверх `fetch`: `isomorphic-git/http/node`
 * не умеет ни отмены в `clone`/`fetch`, ни таймаута простоя, ни потолка
 * загрузки. Таймер простоя идёт только пока ждём сеть, не пока isomorphic-git
 * разбирает уже полученные байты.
 */
const createSession = (
  external: AbortSignal,
  limits: NetworkLimits,
  onBytes: (received: number) => void,
): Session => {
  const controller = new AbortController();
  let timedOut = false;
  let tooLarge = false;
  let received = 0;
  let timer: NodeJS.Timeout | null = null;

  const disarm = (): void => {
    clearTimeout(timer ?? undefined);
    timer = null;
  };
  const arm = (): void => {
    disarm();
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, limits.idleTimeoutMs);
  };
  const onExternalAbort = (): void => controller.abort(external.reason);
  if (external.aborted) onExternalAbort();
  else external.addEventListener('abort', onExternalAbort, { once: true });

  async function* iterate(
    body: ReadableStream<Uint8Array>,
    counted: boolean,
  ): AsyncGenerator<Uint8Array> {
    const reader = body.getReader();
    try {
      for (;;) {
        arm();
        const { done, value } = await reader.read();
        disarm();
        if (done) return;
        if (counted) received += value.byteLength;
        if (limits.maxBytes !== undefined && received > limits.maxBytes) {
          tooLarge = true;
          controller.abort();
          throw new GitFetchError('too-large', 'download exceeds maxBytes');
        }
        onBytes(received);
        yield value;
      }
    } finally {
      disarm();
      reader.cancel().catch(() => undefined);
    }
  }

  const http: HttpClient = {
    async request(req: GitHttpRequest): Promise<GitHttpResponse> {
      let body: Uint8Array<ArrayBuffer> | undefined;
      if (req.body) {
        const parts: Uint8Array[] = [];
        for await (const part of req.body) parts.push(part);
        body = new Uint8Array(Buffer.concat(parts));
      }
      arm();
      let res: Response;
      try {
        const init: RequestInit = {
          method: req.method ?? 'GET',
          headers: req.headers ?? {},
          signal: controller.signal,
          redirect: 'follow',
        };
        if (body) init.body = body;
        res = await fetch(req.url, init);
      } finally {
        disarm();
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        url: res.url,
        method: req.method ?? 'GET',
        headers,
        statusCode: res.status,
        statusMessage: res.statusText,
        ...(res.body ? { body: iterate(res.body, req.method === 'POST') } : {}),
      };
    },
  };

  return {
    http,
    get timedOut() {
      return timedOut;
    },
    get tooLarge() {
      return tooLarge;
    },
    get received() {
      return received;
    },
    dispose() {
      disarm();
      external.removeEventListener('abort', onExternalAbort);
      controller.abort();
    },
  };
};

const statusOf = (error: unknown): number | undefined => {
  const data = (error as { data?: { statusCode?: unknown } } | null)?.data;
  return typeof data?.statusCode === 'number' ? data.statusCode : undefined;
};

/** Приводит любой сбой сетевой операции к `GitFetchError` или отмене. */
const classify = (
  error: unknown,
  signal: AbortSignal,
  session: Session,
): Error => {
  if (signal.aborted) {
    return signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError');
  }
  if (error instanceof GitFetchError) return error;
  if (error instanceof SnapshotRejectedError) return error;
  if (session.timedOut) {
    return new GitFetchError('timeout', 'no data from the server', {
      cause: error,
    });
  }
  if (session.tooLarge) {
    return new GitFetchError('too-large', 'download exceeds maxBytes', {
      cause: error,
    });
  }
  const status = statusOf(error);
  if (status === 404) {
    return new GitFetchError('not-found', 'repository not found', {
      cause: error,
    });
  }
  if (status === 401 || status === 403) {
    return new GitFetchError('auth-required', 'authentication required', {
      cause: error,
    });
  }
  // Ответ не по протоколу git (HTML вместо адвертайза) — это не репозиторий.
  if ((error as { code?: unknown } | null)?.code === 'SmartHttpError') {
    return new GitFetchError('not-found', 'not a git repository', {
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new GitFetchError('network', message, { cause: error });
};

const assertHttpUrl = (url: string): void => {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new TypeError(`invalid url: ${url}`);
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new TypeError(`unsupported url scheme: ${protocol}`);
  }
};

/** Короткое имя → полное; `null` — ветка, на которую указывает `HEAD`. */
const pickRef = async (
  session: Session,
  req: ResolveRequest,
): Promise<ResolvedRef> => {
  const refs = await git.listServerRefs({
    http: session.http,
    url: req.url,
    symrefs: true,
    peelTags: true,
  });
  const byName = new Map(refs.map((r) => [r.ref, r]));
  const commitOf = (name: string): ResolvedRef | null => {
    const r = byName.get(name);
    if (!r) return null;
    return { ref: name, commit: r.peeled ?? r.oid };
  };

  if (req.ref === null) {
    const head = byName.get('HEAD');
    const target = head?.target;
    if (target) {
      const found = commitOf(target);
      if (found) return found;
    }
    throw new GitFetchError(
      'ref-not-found',
      'repository has no default branch',
    );
  }
  const name = req.ref.replace(/^refs\/(heads|tags)\//, '');
  const found = commitOf(`refs/heads/${name}`) ?? commitOf(`refs/tags/${name}`);
  if (!found) {
    throw new GitFetchError('ref-not-found', `ref not found: ${req.ref}`);
  }
  return found;
};

const assertSegment = (name: string, path: string): void => {
  if (
    name === '' ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new SnapshotRejectedError(
      'path-escapes',
      `unsafe path: ${JSON.stringify(path)}`,
      path,
    );
  }
  if (GIT_SEGMENT.test(name)) {
    throw new SnapshotRejectedError(
      'git-segment',
      `reserved path segment: ${path}`,
      path,
    );
  }
};

const exportTree = async (
  gitdir: string,
  treeOid: string,
  destDir: string,
  limits: SnapshotLimits,
  signal: AbortSignal,
  onProgress: FetchSnapshotRequest['onProgress'],
): Promise<{ files: number; bytes: number }> => {
  const seen = new Set<string>();
  let files = 0;
  let bytes = 0;

  const claim = (path: string): void => {
    const key = path.normalize('NFC').toLowerCase();
    if (seen.has(key)) {
      throw new SnapshotRejectedError(
        'case-collision',
        `paths differ only by case: ${path}`,
        path,
      );
    }
    seen.add(key);
  };

  const walk = async (oid: string, rel: string, abs: string): Promise<void> => {
    const { tree } = await git
      .readTree({ fs: nodeFs, gitdir, oid })
      .catch((error: unknown) => {
        // isomorphic-git сам отвергает `.`, `..`, `.git`, `git~1` при разборе дерева.
        const name = (error as { data?: { filepath?: unknown } } | null)?.data
          ?.filepath;
        if (
          (error as { code?: unknown } | null)?.code !==
            'UnsafeFilepathError' ||
          typeof name !== 'string'
        ) {
          throw error;
        }
        const path = rel === '' ? name : `${rel}/${name}`;
        assertSegment(name, path);
        throw new SnapshotRejectedError(
          'git-segment',
          `reserved path segment: ${path}`,
          path,
        );
      });
    for (const entry of tree) {
      signal.throwIfAborted();
      const path = rel === '' ? entry.path : `${rel}/${entry.path}`;
      assertSegment(entry.path, path);
      if (entry.mode === '120000') {
        throw new SnapshotRejectedError(
          'symlink',
          `symbolic link: ${path}`,
          path,
        );
      }
      if (entry.mode === '160000') {
        throw new SnapshotRejectedError(
          'special-file',
          `submodule: ${path}`,
          path,
        );
      }
      const target = join(abs, entry.path);
      if (entry.mode === '040000') {
        claim(path);
        await mkdir(target);
        await walk(entry.oid, path, target);
        continue;
      }
      if (entry.mode !== '100644' && entry.mode !== '100755') {
        throw new SnapshotRejectedError(
          'special-file',
          `unsupported mode ${entry.mode}: ${path}`,
          path,
        );
      }
      claim(path);
      if (files + 1 > limits.maxFiles) {
        throw new SnapshotRejectedError(
          'too-many-files',
          `more than ${limits.maxFiles} files`,
          path,
        );
      }
      const { blob } = await git.readBlob({
        fs: nodeFs,
        gitdir,
        oid: entry.oid,
      });
      if (blob.byteLength > limits.maxFileBytes) {
        throw new SnapshotRejectedError(
          'file-too-large',
          `file exceeds ${limits.maxFileBytes} bytes: ${path}`,
          path,
        );
      }
      if (bytes + blob.byteLength > limits.maxBytes) {
        throw new SnapshotRejectedError(
          'too-large',
          `snapshot exceeds ${limits.maxBytes} bytes`,
          path,
        );
      }
      await writeFile(target, blob, {
        flag: 'wx',
        mode: entry.mode === '100755' ? 0o755 : 0o644,
      });
      files += 1;
      bytes += blob.byteLength;
      if (files % 50 === 0) onProgress('export', { loaded: files });
    }
  };

  await walk(treeOid, '', destDir);
  onProgress('export', { loaded: files, total: files });
  return { files, bytes };
};

export const createIsomorphicGitFetcher = (
  options: { resolveIdleTimeoutMs?: number } = {},
): GitSnapshotFetcher => ({
  async resolve(req: ResolveRequest): Promise<ResolvedRef> {
    assertHttpUrl(req.url);
    const session = createSession(
      req.signal,
      {
        idleTimeoutMs:
          options.resolveIdleTimeoutMs ?? DEFAULT_SNAPSHOT_LIMITS.idleTimeoutMs,
      },
      () => undefined,
    );
    try {
      return await pickRef(session, req);
    } catch (error) {
      throw classify(error, req.signal, session);
    } finally {
      session.dispose();
    }
  },

  async fetchSnapshot(req: FetchSnapshotRequest): Promise<FetchedSnapshot> {
    assertHttpUrl(req.url);
    const { limits, signal } = req;
    const session = createSession(
      signal,
      {
        idleTimeoutMs: limits.idleTimeoutMs,
        maxBytes: limits.maxBytes + PROTOCOL_SLACK_BYTES,
      },
      (loaded) => req.onProgress('fetch', { loaded }),
    );
    let resolved: ResolvedRef;
    let treeOid: string;
    try {
      resolved = await pickRef(session, req);
      signal.throwIfAborted();
      await git.init({ fs: nodeFs, gitdir: req.tmpDir, bare: true });
      await git.addRemote({
        fs: nodeFs,
        gitdir: req.tmpDir,
        remote: 'origin',
        url: req.url,
      });
      await git.fetch({
        fs: nodeFs,
        http: session.http,
        gitdir: req.tmpDir,
        url: req.url,
        ref: resolved.ref,
        remoteRef: resolved.ref,
        remote: 'origin',
        depth: 1,
        singleBranch: true,
        tags: false,
      });
      signal.throwIfAborted();
      const { commit } = await git.readCommit({
        fs: nodeFs,
        gitdir: req.tmpDir,
        oid: resolved.commit,
      });
      treeOid = commit.tree;
    } catch (error) {
      throw classify(error, signal, session);
    } finally {
      session.dispose();
    }
    const { files, bytes } = await exportTree(
      req.tmpDir,
      treeOid,
      req.destDir,
      limits,
      signal,
      req.onProgress,
    );
    return { ...resolved, files, bytes };
  },
});
