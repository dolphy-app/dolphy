import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { E2E_BUILD_DIR, createWorkspace, launchApp } from './support/app.ts';
import type { LmsApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const ECHO_EXTENSION = fileURLToPath(
  new URL('./fixtures/echo-extension', import.meta.url),
);

let workspace: Workspace | null = null;
let app: LmsApp | null = null;
let scratch: string | null = null;

const start = async (options: Parameters<typeof createWorkspace>[0] = {}) => {
  workspace = await createWorkspace(options);
  app = await launchApp(workspace.userData);
  const client = new Client(app.page);
  await client.openSettingsExtensions();
  return client;
};

/** Временный каталог вне рабочего пространства для собираемых в тесте расширений. */
const makeScratch = async () => {
  scratch = await mkdtemp(join(tmpdir(), 'lms-e2e-ext-'));
  return scratch;
};

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
  if (scratch !== null) await rm(scratch, { recursive: true, force: true });
  scratch = null;
});

describe('Настройки → Расширения', () => {
  it('расширения из поставки: lms.sql и lms.choice с источником «Поставка»', async () => {
    const client = await start();
    for (const id of ['lms.sql', 'lms.choice']) {
      const rows = await client.readExtensions(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('Поставка');
      expect(rows[0]).toContain('Загружено');
      expect(rows[0]).toContain(id);
      expect(rows[0]).toContain('Виды заданий');
    }
  });

  it('пользовательское расширение загружено, сломанное — с причиной', async () => {
    const root = await makeScratch();
    const broken = join(root, 'acme.broken');
    await mkdir(broken);
    await writeFile(
      join(broken, 'extension.json'),
      JSON.stringify({ id: 'acme.broken' }),
    );
    const client = await start({
      extensions: { 'acme.echo': ECHO_EXTENSION, 'acme.broken': broken },
    });

    const [echo] = await client.readExtensions('acme.echo');
    expect(echo).toContain('Пользовательское');
    expect(echo).toContain('Загружено');
    expect(echo).toContain('1.0.0');

    const [failed] = await client.readExtensions('acme.broken');
    expect(failed).toContain('Не загрузилось');
    expect(failed).toContain('version');
  });

  it('пользовательская копия lms.choice 1.0.1 перекрывает расширение из поставки', async () => {
    const root = await makeScratch();
    const copy = join(root, 'lms.choice');
    await cp(join(APP_DIR, E2E_BUILD_DIR, 'extensions', 'lms.choice'), copy, {
      recursive: true,
    });
    const manifestPath = join(copy, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      version: string;
    };
    manifest.version = '1.0.1';
    await writeFile(manifestPath, JSON.stringify(manifest));
    const client = await start({ extensions: { 'lms.choice': copy } });

    const rows = await client.readExtensions('lms.choice');
    expect(rows).toHaveLength(2);
    const user = rows.find((row) => row.includes('Пользовательское'));
    const bundled = rows.find((row) => row.includes('Поставка'));
    expect(user).toContain('Загружено');
    expect(user).toContain('1.0.1');
    expect(bundled).toContain('Перекрыто');
  });
});
