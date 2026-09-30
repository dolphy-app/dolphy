import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExtensionAssetsShell } from '../electron/main/shells/extension-assets.ts';

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
  it('регистрирует привилегированную схему lms-ext', () => {
    const { privileged } = setup([]);
    expect(privileged()).toEqual([
      {
        scheme: 'lms-ext',
        privileges: { standard: true, secure: true, supportFetchAPI: true },
      },
    ]);
  });

  it('отдаёт скрипт как text/javascript', async () => {
    const file = path.join(BUNDLED, 'lms.sql', 'view.mjs');
    const { request, fetched } = setup([file]);
    const response = await request('lms-ext://lms.sql/view.mjs');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/javascript');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toContain('/bundled-ext/lms.sql/view.mjs');
  });

  it('пользовательский корень приоритетнее поставки', async () => {
    const files = [
      path.join(USER, 'lms.sql', 'view.mjs'),
      path.join(BUNDLED, 'lms.sql', 'view.mjs'),
    ];
    const { request, fetched } = setup(files);
    await request('lms-ext://lms.sql/view.mjs');
    expect(fetched[0]).toContain('/user-ext/lms.sql/view.mjs');
  });

  it('не отдаёт файлы вне каталога расширения, не скрипты и чужие id', async () => {
    const secret = path.join(BUNDLED, 'secret.mjs');
    const json = path.join(BUNDLED, 'lms.sql', 'extension.json');
    const { request, fetched } = setup([secret, json]);
    expect((await request('lms-ext://lms.sql/..%2Fsecret.mjs')).status).toBe(
      404,
    );
    expect((await request('lms-ext://lms.sql/extension.json')).status).toBe(
      404,
    );
    expect((await request('lms-ext://Bad_Id/view.mjs')).status).toBe(404);
    expect((await request('lms-ext://lms.sql/absent.mjs')).status).toBe(404);
    expect(fetched).toEqual([]);
  });

  it('ошибка чтения — 404 и предупреждение', async () => {
    const file = path.join(BUNDLED, 'lms.sql', 'view.mjs');
    const { request, warned } = setup([file], true);
    expect((await request('lms-ext://lms.sql/view.mjs')).status).toBe(404);
    expect(warned).toHaveLength(1);
  });
});
