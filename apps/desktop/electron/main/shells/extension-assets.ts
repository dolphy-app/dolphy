import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTENSION_ID_PATTERN } from '@lms/extension-api';
import type { MainLogger } from '../logger.ts';
import type { Shell } from './types.ts';

export const EXTENSION_SCHEME = 'lms-ext';

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['.js', '.mjs']);

export interface ExtensionAssetsDeps {
  app: { whenReady(): Promise<unknown> };
  protocol: {
    registerSchemesAsPrivileged(
      schemes: {
        scheme: string;
        privileges: {
          standard: boolean;
          secure: boolean;
          supportFetchAPI: boolean;
          corsEnabled: boolean;
        };
      }[],
    ): void;
    handle(
      scheme: string,
      handler: (request: { url: string }) => Promise<Response> | Response,
    ): void;
  };
  net: { fetch(url: string): Promise<Response> };
  /** Корни расширений в порядке приоритета: пользовательский, затем из поставки. */
  roots: readonly string[];
  exists(file: string): boolean;
  logger: MainLogger;
}

const notFound = () => new Response(null, { status: 404 });

/**
 * Протокол `lms-ext://<id>/<путь>`: отдаёт renderer'у только скрипты
 * (`.js`/`.mjs`) из каталога расширения; выход за каталог — 404.
 */
export const createExtensionAssetsShell = ({
  app,
  protocol,
  net,
  roots,
  exists,
  logger,
}: ExtensionAssetsDeps): Shell => {
  const resolveFile = (url: URL): string | null => {
    const id = decodeURIComponent(url.hostname);
    if (!EXTENSION_ID_PATTERN.test(id)) return null;
    const relative = decodeURIComponent(url.pathname.slice(1));
    if (!SCRIPT_EXTENSIONS.has(path.extname(relative))) return null;
    for (const root of roots) {
      const dir = path.resolve(root, id);
      const file = path.resolve(dir, relative);
      if (file.startsWith(dir + path.sep) && exists(file)) return file;
    }
    return null;
  };

  const handler = async (request: { url: string }) => {
    let file: string | null;
    try {
      file = resolveFile(new URL(request.url));
    } catch {
      return notFound();
    }
    if (file === null) return notFound();
    try {
      const upstream = await net.fetch(pathToFileURL(file).href);
      return new Response(upstream.body, {
        status: upstream.status,
        // renderer грузится с file:// (origin null): модульный import() идёт в режиме CORS
        headers: {
          'Content-Type': 'text/javascript',
          'Access-Control-Allow-Origin': '*',
          // после перезагрузки в режиме разработчика окно обязано увидеть свежий код
          'Cache-Control': 'no-cache',
        },
      });
    } catch (error) {
      logger.warn({ error, file }, 'extension asset was not read');
      return notFound();
    }
  };

  return {
    register: () => {
      protocol.registerSchemesAsPrivileged([
        {
          scheme: EXTENSION_SCHEME,
          privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
          },
        },
      ]);
      void app
        .whenReady()
        .then(() => protocol.handle(EXTENSION_SCHEME, handler));
    },
  };
};
