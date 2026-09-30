import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createExtensionAssetsShell,
  FRAME_CSP,
} from '../electron/main/shells/extension-assets.ts';

type Handler = (request: { url: string }) => Promise<Response> | Response;

const USER = path.resolve('/user-ext');
const BUNDLED = path.resolve('/bundled-ext');

const setup = (files: string[], failFetch = false) => {
  let handler: Handler | null = null;
  let privileged: unknown = null;
  const fetched: string[] = [];
  const warned: unknown[] = [];
  const shell = createExtensionAssetsShell({
    app: { whenReady: () => Promise.resolve() },
    protocol: {
      registerSchemesAsPrivileged: (schemes) => {
        privileged = schemes;
      },
      handle: (_scheme, registered) => {
        handler = registered;
      },
    },
    net: {
      fetch: async (url) => {
        if (failFetch) throw new Error('EIO');
        fetched.push(url);
        return new Response('export {};', { status: 200 });
      },
    },
    roots: [USER, BUNDLED],
    exists: (file) => files.includes(file),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (fields) => warned.push(fields),
      error: () => undefined,
    },
  });
  shell.register();
  const request = async (url: string) => {
    await Promise.resolve();
    return (handler as Handler)({ url });
  };
  return { request, fetched, warned, privileged: () => privileged };
};

describe('extension assets shell', () => {
  it('регистрирует привилегированную схему spirula-ext', () => {
    const { privileged } = setup([]);
    expect(privileged()).toEqual([
      {
        scheme: 'spirula-ext',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
    ]);
  });

  it('отдаёт скрипт как text/javascript', async () => {
    const file = path.join(BUNDLED, 'spirula.sql', 'view.mjs');
    const { request, fetched } = setup([file]);
    const response = await request('spirula-ext://spirula.sql/view.mjs');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/javascript');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toContain('/bundled-ext/spirula.sql/view.mjs');
  });

  it('пользовательский корень приоритетнее поставки', async () => {
    const files = [
      path.join(USER, 'spirula.sql', 'view.mjs'),
      path.join(BUNDLED, 'spirula.sql', 'view.mjs'),
    ];
    const { request, fetched } = setup(files);
    await request('spirula-ext://spirula.sql/view.mjs');
    expect(fetched[0]).toContain('/user-ext/spirula.sql/view.mjs');
  });

  it('не отдаёт файлы вне каталога расширения, не скрипты и чужие id', async () => {
    const secret = path.join(BUNDLED, 'secret.mjs');
    const json = path.join(BUNDLED, 'spirula.sql', 'extension.json');
    const { request, fetched } = setup([secret, json]);
    expect(
      (await request('spirula-ext://spirula.sql/..%2Fsecret.mjs')).status,
    ).toBe(404);
    expect(
      (await request('spirula-ext://spirula.sql/extension.json')).status,
    ).toBe(404);
    expect((await request('spirula-ext://Bad_Id/view.mjs')).status).toBe(404);
    expect((await request('spirula-ext://spirula.sql/absent.mjs')).status).toBe(
      404,
    );
    expect(fetched).toEqual([]);
  });

  it('ошибка чтения — 404 и предупреждение', async () => {
    const file = path.join(BUNDLED, 'spirula.sql', 'view.mjs');
    const { request, warned } = setup([file], true);
    expect((await request('spirula-ext://spirula.sql/view.mjs')).status).toBe(
      404,
    );
    expect(warned).toHaveLength(1);
  });
});

describe('страница и рантайм изолированной рамки', () => {
  it('__spirula/frame.html: страница с CSP без сети, без чтения с диска, только свой id', async () => {
    const { request, fetched } = setup([]);
    const response = await request(
      'spirula-ext://acme.echo/__spirula/frame.html',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(response.headers.get('Content-Security-Policy')).toBe(FRAME_CSP);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    const html = await response.text();
    expect(html).toContain(
      '<script type="module" src="spirula-ext://acme.echo/__spirula/frame.js"></script>',
    );
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).not.toContain('spirula.sql');
    expect(fetched).toEqual([]);
  });

  it('CSP страницы рамки: сеть, формы и base запрещены, скрипты — только spirula-ext:', () => {
    const directives = new Map(
      FRAME_CSP.split('; ').map((part) => {
        const [name, ...values] = part.split(' ');
        return [name, values.join(' ')];
      }),
    );
    expect(directives.get('default-src')).toBe("'none'");
    expect(directives.get('script-src')).toBe('spirula-ext:');
    expect(directives.get('connect-src')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'none'");
    expect(directives.get('form-action')).toBe("'none'");
    expect(FRAME_CSP).not.toContain('unsafe-eval');
  });

  it('__spirula/frame.html для неверного id — 404', async () => {
    const { request } = setup([]);
    expect(
      (await request('spirula-ext://Bad_Id/__spirula/frame.html')).status,
    ).toBe(404);
    expect(
      (
        await request(
          'spirula-ext://acme.echo%22%3E%3Cscript/__spirula/frame.html',
        )
      ).status,
    ).toBe(404);
  });

  it('__spirula/frame.js: рантайм рамки одинаков для всех расширений, с CORS', async () => {
    const { request, fetched } = setup([]);
    const first = await request('spirula-ext://acme.echo/__spirula/frame.js');
    const second = await request(
      'spirula-ext://spirula.sql/__spirula/frame.js',
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('text/javascript');
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const script = await first.text();
    expect(script).toContain('spirula-answer-change');
    expect(
      script
        .trimEnd()
        .endsWith('spirulaFrameRuntime(window, (url) => import(url));'),
    ).toBe(true);
    expect(await second.text()).toBe(script);
    expect(fetched).toEqual([]);
  });

  it('путь __spirula нельзя использовать для выхода и нельзя отдать из каталога расширения', async () => {
    const inside = path.join(BUNDLED, 'acme.echo', '__spirula', 'secret.mjs');
    const frameFile = path.join(BUNDLED, 'acme.echo', '__spirula', 'frame.mjs');
    const outside = path.join(BUNDLED, 'secret.mjs');
    const { request, fetched } = setup([inside, frameFile, outside]);
    const urls = [
      'spirula-ext://acme.echo/__spirula/secret.mjs',
      'spirula-ext://acme.echo/__spirula/frame.mjs',
      'spirula-ext://acme.echo/__spirula/frame.json',
      'spirula-ext://acme.echo/__spirula/frame.html/',
      'spirula-ext://acme.echo/__spirula/',
      'spirula-ext://acme.echo/x%2F..%2F__spirula%2Fsecret.mjs',
      'spirula-ext://acme.echo/..%2F__spirula%2Fframe.js',
      'spirula-ext://acme.echo/__spirula%2F..%2F..%2Fsecret.mjs',
    ];
    for (const url of urls) {
      expect((await request(url)).status, url).toBe(404);
    }
    expect(fetched).toEqual([]);
  });

  it('файлы расширения по-прежнему отдаются рядом со служебными путями', async () => {
    const file = path.join(BUNDLED, 'acme.echo', 'view.mjs');
    const { request, fetched } = setup([file]);
    expect((await request('spirula-ext://acme.echo/view.mjs')).status).toBe(
      200,
    );
    expect(fetched).toHaveLength(1);
  });
});
