import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_LIMITS } from '@dolphy-app/extension-catalog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createExtensionAssetsShell,
  frameCsp,
  FRAME_PERMISSIONS_POLICY,
  SVG_CSP,
} from '../electron/main/shells/extension-assets.ts';

type Handler = (request: { url: string }) => Promise<Response> | Response;

let base = '';
let USER = '';
let BUNDLED = '';

beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'dolphy-assets-')));
  USER = path.join(base, 'user-ext');
  BUNDLED = path.join(base, 'bundled-ext');
  mkdirSync(USER);
  mkdirSync(BUNDLED);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Кладёт файл в корень расширений; возвращает его путь. */
const put = (
  root: string,
  id: string,
  relative: string,
  content: string | Buffer = 'export {};',
) => {
  const file = path.join(root, id, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
};

const setup = (failFetch = false) => {
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
        return new Response(readFileSync(fileURLToPath(url)), { status: 200 });
      },
    },
    roots: [USER, BUNDLED],
    fs: { realpath, stat },
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
  it('регистрирует привилегированную схему dolphy-ext', () => {
    const { privileged } = setup();
    expect(privileged()).toEqual([
      {
        scheme: 'dolphy-ext',
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
    put(BUNDLED, 'dolphy.sql', 'view.mjs');
    const { request, fetched } = setup();
    const response = await request('dolphy-ext://dolphy.sql/view.mjs');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/javascript');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toContain('/bundled-ext/dolphy.sql/view.mjs');
  });

  it('пользовательский корень приоритетнее поставки', async () => {
    put(USER, 'dolphy.sql', 'view.mjs');
    put(BUNDLED, 'dolphy.sql', 'view.mjs');
    const { request, fetched } = setup();
    await request('dolphy-ext://dolphy.sql/view.mjs');
    expect(fetched[0]).toContain('/user-ext/dolphy.sql/view.mjs');
  });

  it('не отдаёт файлы вне каталога расширения, не скрипты и чужие id', async () => {
    put(BUNDLED, '', 'secret.mjs');
    put(BUNDLED, 'dolphy.sql', 'extension.json', '{}');
    const { request, fetched } = setup();
    expect(
      (await request('dolphy-ext://dolphy.sql/..%2Fsecret.mjs')).status,
    ).toBe(404);
    expect(
      (await request('dolphy-ext://dolphy.sql/extension.json')).status,
    ).toBe(404);
    expect((await request('dolphy-ext://Bad_Id/view.mjs')).status).toBe(404);
    expect((await request('dolphy-ext://dolphy.sql/absent.mjs')).status).toBe(
      404,
    );
    expect(fetched).toEqual([]);
  });

  it('ошибка чтения — 404 и предупреждение', async () => {
    put(BUNDLED, 'dolphy.sql', 'view.mjs');
    const { request, warned } = setup(true);
    expect((await request('dolphy-ext://dolphy.sql/view.mjs')).status).toBe(
      404,
    );
    expect(warned).toHaveLength(1);
  });
});

describe('ресурсы расширения', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it.each([
    ['assets/panel.css', 'text/css; charset=utf-8'],
    ['assets/logo.svg', 'image/svg+xml'],
    ['assets/a.png', 'image/png'],
    ['assets/a.webp', 'image/webp'],
    ['assets/a.jpg', 'image/jpeg'],
    ['assets/a.jpeg', 'image/jpeg'],
    ['assets/f.woff2', 'font/woff2'],
  ])('%s: Content-Type %s, nosniff, no-cache, CORS', async (file, type) => {
    put(USER, 'acme.echo', file, PNG);
    const { request } = setup();
    const response = await request(`dolphy-ext://acme.echo/${file}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(type);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  });

  it('только SVG получает CSP с sandbox', async () => {
    put(USER, 'acme.echo', 'assets/logo.svg', '<svg/>');
    put(USER, 'acme.echo', 'assets/a.png', PNG);
    const { request } = setup();
    const svg = await request('dolphy-ext://acme.echo/assets/logo.svg');
    expect(svg.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(SVG_CSP).toBe(svg.headers.get('Content-Security-Policy'));
    const png = await request('dolphy-ext://acme.echo/assets/a.png');
    expect(png.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('манифест, README, locales/*.json, json/md/txt, прочие типы, пути с точки и расширение в верхнем регистре — 404', async () => {
    const paths = [
      'extension.json',
      'README.md',
      'data/table.json',
      // таблицы переводов читает движок при обнаружении; окну и рамкам они не отдаются
      'locales/en.json',
      'locales/ru.json',
      'notes.txt',
      'docs/guide.md',
      'assets/icon.gif',
      'assets/page.html',
      'assets/module.wasm',
      'assets/NOEXT',
      'assets/UPPER.PNG',
      'assets/Mixed.Css',
      '.hidden.png',
      'assets/.secret.css',
      '.git/logo.png',
      '.dot/view.mjs',
    ];
    for (const relative of paths) put(USER, 'acme.echo', relative, PNG);
    const { request, fetched } = setup();
    for (const relative of paths) {
      const response = await request(`dolphy-ext://acme.echo/${relative}`);
      expect(response.status, relative).toBe(404);
    }
    expect(fetched).toEqual([]);
  });

  it('ресурс чужого id не отдаётся по своему', async () => {
    put(USER, 'acme.other', 'assets/a.png', PNG);
    const { request } = setup();
    expect((await request('dolphy-ext://acme.echo/assets/a.png')).status).toBe(
      404,
    );
    expect(
      (await request('dolphy-ext://acme.echo/..%2Facme.other%2Fassets%2Fa.png'))
        .status,
    ).toBe(404);
  });

  it('потолок размера по типу: на пределе отдаётся, больше — 413 и предупреждение', async () => {
    const limits = {
      'a.css': ASSET_LIMITS.css,
      'a.svg': ASSET_LIMITS.svg,
      'a.png': ASSET_LIMITS.image,
      'a.woff2': ASSET_LIMITS.woff2,
    };
    for (const [name, limit] of Object.entries(limits)) {
      put(USER, 'acme.echo', `ok/${name}`, Buffer.alloc(limit));
      put(USER, 'acme.echo', `big/${name}`, Buffer.alloc(limit + 1));
    }
    const { request, warned } = setup();
    for (const name of Object.keys(limits)) {
      expect((await request(`dolphy-ext://acme.echo/ok/${name}`)).status).toBe(
        200,
      );
      expect((await request(`dolphy-ext://acme.echo/big/${name}`)).status).toBe(
        413,
      );
    }
    expect(warned).toHaveLength(4);
  });

  it('скрипты потолком ресурсов не ограничены', async () => {
    put(USER, 'acme.echo', 'main.mjs', Buffer.alloc(ASSET_LIMITS.woff2 + 1));
    const { request } = setup();
    expect((await request('dolphy-ext://acme.echo/main.mjs')).status).toBe(200);
  });

  describe('символические ссылки', () => {
    const link = (target: string, at: string) => {
      mkdirSync(path.dirname(at), { recursive: true });
      symlinkSync(target, at);
    };

    it('ссылка на ресурс вне каталога расширения — 404', async () => {
      const secret = path.join(base, 'secret.png');
      writeFileSync(secret, PNG);
      link(secret, path.join(USER, 'acme.echo', 'assets', 'leak.png'));
      link(secret, path.join(USER, 'acme.echo', 'assets', 'leak.mjs'));
      const { request, fetched } = setup();
      expect(
        (await request('dolphy-ext://acme.echo/assets/leak.png')).status,
      ).toBe(404);
      expect(
        (await request('dolphy-ext://acme.echo/assets/leak.mjs')).status,
      ).toBe(404);
      expect(fetched).toEqual([]);
    });

    it('ссылка на каталог вне расширения — 404', async () => {
      put(base, 'outside', 'a.png', PNG);
      link(path.join(base, 'outside'), path.join(USER, 'acme.echo', 'assets'));
      const { request } = setup();
      expect(
        (await request('dolphy-ext://acme.echo/assets/a.png')).status,
      ).toBe(404);
    });

    it('ссылка на ресурс внутри каталога тоже — 404, на скрипт внутри — отдаётся', async () => {
      const png = put(USER, 'acme.echo', 'real/a.png', PNG);
      const script = put(USER, 'acme.echo', 'real/m.mjs');
      link(png, path.join(USER, 'acme.echo', 'alias.png'));
      link(script, path.join(USER, 'acme.echo', 'alias.mjs'));
      link(
        path.join(USER, 'acme.echo', 'real'),
        path.join(USER, 'acme.echo', 'dir-alias'),
      );
      const { request } = setup();
      expect((await request('dolphy-ext://acme.echo/alias.png')).status).toBe(
        404,
      );
      expect(
        (await request('dolphy-ext://acme.echo/dir-alias/a.png')).status,
      ).toBe(404);
      expect((await request('dolphy-ext://acme.echo/alias.mjs')).status).toBe(
        200,
      );
      expect((await request('dolphy-ext://acme.echo/real/a.png')).status).toBe(
        200,
      );
    });

    it('сам каталог расширения может быть ссылкой (режим разработчика)', async () => {
      put(base, 'project', 'assets/a.png', PNG);
      link(path.join(base, 'project'), path.join(USER, 'acme.echo'));
      const { request } = setup();
      expect(
        (await request('dolphy-ext://acme.echo/assets/a.png')).status,
      ).toBe(200);
    });

    it('битая ссылка — 404', async () => {
      link(
        path.join(base, 'absent.png'),
        path.join(USER, 'acme.echo', 'a.png'),
      );
      const { request } = setup();
      expect((await request('dolphy-ext://acme.echo/a.png')).status).toBe(404);
    });
  });

  it('ресурс пользовательского корня перекрывает поставку; отвергнутый не уступает поставке', async () => {
    put(USER, 'acme.echo', 'a.png', PNG);
    put(BUNDLED, 'acme.echo', 'a.png', Buffer.from('bundled'));
    put(USER, 'acme.echo', 'big.css', Buffer.alloc(ASSET_LIMITS.css + 1));
    put(BUNDLED, 'acme.echo', 'big.css', 'a{}');
    const { request } = setup();
    const own = await request('dolphy-ext://acme.echo/a.png');
    expect(Buffer.from(await own.arrayBuffer())).toEqual(PNG);
    expect((await request('dolphy-ext://acme.echo/big.css')).status).toBe(413);
  });

  it('каталог вместо файла — 404', async () => {
    mkdirSync(path.join(USER, 'acme.echo', 'dir.png'), { recursive: true });
    const { request } = setup();
    expect((await request('dolphy-ext://acme.echo/dir.png')).status).toBe(404);
  });
});

describe('страница и рантайм изолированной рамки', () => {
  it('__dolphy/frame.html: страница с CSP своего id, без чтения с диска', async () => {
    const { request, fetched } = setup();
    const response = await request(
      'dolphy-ext://acme.echo/__dolphy/frame.html',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(response.headers.get('Content-Security-Policy')).toBe(
      frameCsp('acme.echo'),
    );
    expect(response.headers.get('Permissions-Policy')).toBe(
      FRAME_PERMISSIONS_POLICY,
    );
    // каждая возможность закрыта для всех, включая саму страницу
    for (const feature of ['camera', 'microphone', 'geolocation', 'usb']) {
      expect(FRAME_PERMISSIONS_POLICY).toContain(`${feature}=()`);
    }
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    const html = await response.text();
    expect(html).toContain(
      '<script type="module" src="dolphy-ext://acme.echo/__dolphy/frame.js"></script>',
    );
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).not.toContain('dolphy.sql');
    expect(fetched).toEqual([]);
  });

  const directives = (csp: string) =>
    new Map(
      csp.split('; ').map((part) => {
        const [name, ...values] = part.split(' ');
        return [name, values.join(' ')];
      }),
    );

  it.each(['acme.echo', 'dolphy', 'acme.my-ext', 'a-b.c-d.e1'])(
    'CSP рамки %s: ресурсы только своего расширения, сеть, формы и base запрещены',
    async (id) => {
      const { request } = setup();
      const header = (
        await request(`dolphy-ext://${id}/__dolphy/frame.html`)
      ).headers.get('Content-Security-Policy');
      expect(header).toBe(frameCsp(id));
      const own = `dolphy-ext://${id}`;
      const csp = directives(frameCsp(id));
      expect(csp.get('default-src')).toBe("'none'");
      expect(csp.get('script-src')).toBe(own);
      expect(csp.get('style-src')).toBe(`${own} 'unsafe-inline'`);
      expect(csp.get('img-src')).toBe(`${own} data: blob:`);
      expect(csp.get('font-src')).toBe(`${own} data:`);
      expect(csp.get('connect-src')).toBe("'none'");
      expect(csp.get('base-uri')).toBe("'none'");
      expect(csp.get('form-action')).toBe("'none'");
      expect(csp.size).toBe(8);
      expect(frameCsp(id)).not.toContain('unsafe-eval');
      // никакой схемы целиком: чужое расширение под ту же схему не подходит
      expect(frameCsp(id)).not.toMatch(/dolphy-ext:(?!\/\/)/);
    },
  );

  it('CSP разных расширений различается только id', () => {
    expect(frameCsp('acme.a').replaceAll('acme.a', 'X')).toBe(
      frameCsp('acme.b').replaceAll('acme.b', 'X'),
    );
    expect(frameCsp('acme.a')).not.toContain('acme.b');
  });

  it('__dolphy/frame.html для неверного id — 404', async () => {
    const { request } = setup();
    expect(
      (await request('dolphy-ext://Bad_Id/__dolphy/frame.html')).status,
    ).toBe(404);
    expect(
      (
        await request(
          'dolphy-ext://acme.echo%22%3E%3Cscript/__dolphy/frame.html',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          'dolphy-ext://acme.echo%3B%20script-src%20*/__dolphy/frame.html',
        )
      ).status,
    ).toBe(404);
  });

  it('__dolphy/frame.js: рантайм рамки одинаков для всех расширений, с CORS', async () => {
    const { request, fetched } = setup();
    const first = await request('dolphy-ext://acme.echo/__dolphy/frame.js');
    const second = await request('dolphy-ext://dolphy.sql/__dolphy/frame.js');
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('text/javascript');
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const script = await first.text();
    expect(script).toContain('dolphy-answer-change');
    expect(
      script
        .trimEnd()
        .endsWith('dolphyFrameRuntime(window, (url) => import(url));'),
    ).toBe(true);
    expect(await second.text()).toBe(script);
    expect(fetched).toEqual([]);
  });

  it('путь __dolphy нельзя использовать для выхода и нельзя отдать из каталога расширения', async () => {
    put(BUNDLED, 'acme.echo', '__dolphy/secret.mjs');
    put(BUNDLED, 'acme.echo', '__dolphy/frame.mjs');
    put(BUNDLED, '', 'secret.mjs');
    put(BUNDLED, 'acme.echo', '__dolphy/logo.png', 'x');
    const { request, fetched } = setup();
    const urls = [
      'dolphy-ext://acme.echo/__dolphy/secret.mjs',
      'dolphy-ext://acme.echo/__dolphy/frame.mjs',
      'dolphy-ext://acme.echo/__dolphy/logo.png',
      'dolphy-ext://acme.echo/__dolphy/frame.json',
      'dolphy-ext://acme.echo/__dolphy/frame.html/',
      'dolphy-ext://acme.echo/__dolphy/',
      'dolphy-ext://acme.echo/x%2F..%2F__dolphy%2Fsecret.mjs',
      'dolphy-ext://acme.echo/..%2F__dolphy%2Fframe.js',
      'dolphy-ext://acme.echo/__dolphy%2F..%2F..%2Fsecret.mjs',
    ];
    for (const url of urls) {
      expect((await request(url)).status, url).toBe(404);
    }
    expect(fetched).toEqual([]);
  });

  it('файлы расширения по-прежнему отдаются рядом со служебными путями', async () => {
    put(BUNDLED, 'acme.echo', 'view.mjs');
    const { request, fetched } = setup();
    expect((await request('dolphy-ext://acme.echo/view.mjs')).status).toBe(200);
    expect(fetched).toHaveLength(1);
  });
});
