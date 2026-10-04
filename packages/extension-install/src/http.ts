import { ExtensionInstallError } from '@dolphy-app/engine/ports';
import type { ExtensionInstallErrorCause } from '@dolphy-app/engine/ports';

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface GetRequest {
  url: URL;
  headers?: Record<string, string>;
  /** Тело больше — обрыв с `overflow`. */
  maxBytes: number;
  overflow: ExtensionInstallErrorCause;
  /** `true` — ответ 304 не ошибка. */
  allowNotModified?: boolean;
  /** `true` — ответ 404 не ошибка: `status` равен 404, тело пусто. */
  allowNotFound?: boolean;
  extensionId: string | null;
}

export interface GetResponse {
  status: number;
  etag: string | null;
  bytes: Uint8Array;
}

export interface HttpClientOptions {
  fetch: typeof fetch;
  /** Единственный разрешённый origin, в том числе после редиректов. */
  origin: string;
  userAgent: string;
  timeoutMs: number;
}

const describeError = (error: unknown, timeoutMs: number): string => {
  if (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return `timed out after ${timeoutMs} ms`;
  }
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error
    ? `${error.message}: ${error.cause.message}`
    : error.message;
};

const readBody = async (
  response: Response,
  request: GetRequest,
): Promise<Uint8Array> => {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > request.maxBytes) {
      await reader.cancel();
      throw new ExtensionInstallError(
        request.overflow,
        request.extensionId,
        `response is larger than ${request.maxBytes} bytes`,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
};

/** GET без автоматических редиректов: каждый переход проверяется на origin каталога. */
export const createHttpClient = (options: HttpClientOptions) => {
  const { origin, timeoutMs } = options;

  const get = async (request: GetRequest): Promise<GetResponse> => {
    const fail = (message: string): ExtensionInstallError =>
      new ExtensionInstallError('network', request.extensionId, message);
    const headers = { 'User-Agent': options.userAgent, ...request.headers };

    const hop = async (
      url: URL,
    ): Promise<{ redirect: URL } | { result: GetResponse }> => {
      if (url.origin !== origin) {
        throw fail(`${url.href} is outside the catalog origin ${origin}`);
      }
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await options.fetch(url, {
        headers,
        redirect: 'manual',
        signal,
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (location === null)
          throw fail(`redirect from ${url.href} without location`);
        return { redirect: new URL(location, url) };
      }
      const accepted =
        response.ok ||
        (response.status === 304 && request.allowNotModified === true) ||
        (response.status === 404 && request.allowNotFound === true);
      if (!accepted) {
        await response.body?.cancel();
        throw fail(`GET ${url.href}: HTTP ${response.status}`);
      }
      if (response.status === 404) {
        await response.body?.cancel();
        return {
          result: { status: 404, etag: null, bytes: new Uint8Array(0) },
        };
      }
      return {
        result: {
          status: response.status,
          etag: response.headers.get('etag'),
          bytes: await readBody(response, request),
        },
      };
    };

    let url = request.url;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      try {
        const step = await hop(url);
        if ('result' in step) return step.result;
        url = step.redirect;
      } catch (error) {
        if (error instanceof ExtensionInstallError) throw error;
        throw fail(`GET ${url.href}: ${describeError(error, timeoutMs)}`);
      }
    }
    throw fail(`too many redirects from ${request.url.href}`);
  };

  return { get };
};

export type HttpClient = ReturnType<typeof createHttpClient>;
