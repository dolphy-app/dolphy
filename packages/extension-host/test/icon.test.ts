import { formatDiagnostic } from '../src/diagnostics.ts';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { png, webp } from '../../extension-catalog/test/samples.ts';
import { discoverExtensions, inspectExtensionDir } from '../src/discover.ts';
import { createDiscoveryHolder } from '../src/holder.ts';
import { parseManifest } from '../src/manifest.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';
import { createLogger } from './helpers.ts';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'dolphy-icon-'));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

const manifest = (extra: Record<string, unknown> = {}) => ({
  id: 'acme.night',
  version: '1.0.0',
  apiVersion: 1,
  ...extra,
});

const extensionWith = async (
  extra: Record<string, unknown>,
  files: Record<string, Uint8Array> = {},
): Promise<string> => {
  const dir = path.join(tmp, 'acme.night');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'extension.json'),
    JSON.stringify(manifest(extra)),
  );
  for (const [file, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), bytes);
  }
  return dir;
};

const inspect = async (dir: string, verifyFiles = true) => {
  const result = await inspectExtensionDir(dir, { verifyFiles });
  return result.ok
    ? result.extension.icon
    : formatDiagnostic(result.diagnostic);
};

describe('manifest icon', () => {
  it('accepts .png and .webp paths, no icon by default', () => {
    expect(parseManifest(manifest({ icon: 'assets/i.png' }))).toMatchObject({
      ok: true,
      manifest: { icon: 'assets/i.png' },
    });
    expect(parseManifest(manifest({ icon: 'i.webp' }))).toMatchObject({
      ok: true,
    });
    expect(parseManifest(manifest())).toMatchObject({
      ok: true,
      manifest: { icon: null },
    });
  });

  it.each([
    'assets/i.svg',
    'assets/i.jpg',
    '../i.png',
    '/i.png',
    'a\\i.png',
    'i.PNG',
  ])('rejects %s', (icon) => {
    expect(parseManifest(manifest({ icon })).ok).toBe(false);
  });
});

describe('icon discovery', () => {
  it('reads a PNG and a WebP icon as a data URI', async () => {
    const dir = await extensionWith(
      { icon: 'assets/icon.png' },
      { 'assets/icon.png': png(64) },
    );
    expect(await inspect(dir)).toBe(
      `data:image/png;base64,${Buffer.from(png(64)).toString('base64')}`,
    );
    await rm(dir, { recursive: true });
    const second = await extensionWith(
      { icon: 'icon.webp' },
      { 'icon.webp': webp(128) },
    );
    expect(await inspect(second)).toContain('data:image/webp;base64,');
  });

  it('has no icon without the key, and does not read the file with verifyFiles off', async () => {
    expect(await inspect(await extensionWith({}))).toBeNull();
    await rm(path.join(tmp, 'acme.night'), { recursive: true });
    const dir = await extensionWith({ icon: 'assets/icon.png' });
    expect(await inspect(dir, false)).toBeNull();
  });

  it.each([
    ['a missing file', {}, /is not a file/],
    ['a non-square icon', { 'assets/icon.png': png(64, 96) }, /square/],
    ['an icon below 64 px', { 'assets/icon.png': png(32) }, /64 to 512/],
    ['an icon above 512 px', { 'assets/icon.png': png(600) }, /64 to 512/],
    [
      'an icon over 16 KiB',
      { 'assets/icon.png': png(64, 64, { padding: 20_000 }) },
      /16384/,
    ],
    ['a file that is not a PNG', { 'assets/icon.png': webp(64) }, /PNG/],
  ])('refuses %s', async (_name, files, pattern) => {
    const dir = await extensionWith({ icon: 'assets/icon.png' }, files);
    expect(await inspect(dir)).toMatch(pattern);
  });

  it('refuses a symbolic link in place of the icon', async () => {
    const dir = await extensionWith(
      { icon: 'assets/icon.png' },
      { 'real.png': png(64) },
    );
    await mkdir(path.join(dir, 'assets'));
    await symlink(
      path.join(dir, 'real.png'),
      path.join(dir, 'assets/icon.png'),
    );
    expect(await inspect(dir)).toMatch(/is not a file/);
  });

  it('skips an extension with a bad icon in discovery, with the reason', async () => {
    await extensionWith(
      { icon: 'assets/icon.png' },
      { 'assets/icon.png': png(32) },
    );
    const { extensions, diagnostics } = await discoverExtensions({
      roots: [{ dir: tmp, origin: 'user' }],
      logger: createLogger(),
    });
    expect(extensions).toEqual([]);
    expect(formatDiagnostic(diagnostics[0]!.diagnostic)).toMatch(/64 to 512/);
  });

  it('passes the icon of a loaded extension to the registry', async () => {
    await extensionWith(
      { icon: 'assets/icon.png' },
      { 'assets/icon.png': png(64) },
    );
    const result = await discoverExtensions({
      roots: [{ dir: tmp, origin: 'user' }],
      logger: createLogger(),
    });
    const holder = createDiscoveryHolder(result);
    const registry = createExtensionRegistry(
      holder,
      createExtensionPolicy(holder),
    );
    const [info] = registry.list();
    expect(info?.icon).toBe(
      `data:image/png;base64,${Buffer.from(png(64)).toString('base64')}`,
    );
  });
});
