import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCALE_LIMITS } from '@dolphy-app/extension-api';
import { discoverExtensions } from '../src/discover.ts';
import { formatDiagnostic } from '../src/diagnostics.ts';
import { createExtensionPolicy } from '../src/policy.ts';
import { createExtensionRegistry } from '../src/registry.ts';
import { createDiscoveryHolder } from '../src/holder.ts';
import { createLogger } from './helpers.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'dolphy-locales-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const MANIFEST = {
  id: 'acme.pack',
  version: '1.0.0',
  apiVersion: 1,
  name: '%name%',
  description: 'Plain description of the pack',
  contributes: {
    themes: [
      {
        id: 'acme.pack.night',
        label: '%theme.night%',
        dark: true,
        colors: { background: '#000000', surface: '#111111' },
      },
    ],
  },
};

const install = async (
  locales: Record<string, string | object>,
): Promise<void> => {
  const dir = path.join(root, 'acme.pack');
  await mkdir(path.join(dir, 'locales'), { recursive: true });
  await writeFile(path.join(dir, 'extension.json'), JSON.stringify(MANIFEST));
  for (const [name, content] of Object.entries(locales)) {
    await writeFile(
      path.join(dir, 'locales', name),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
};

const discover = async (verifyFiles = true) => {
  const logger = createLogger();
  const result = await discoverExtensions({
    roots: [{ dir: root, origin: 'user' }],
    logger,
    verifyFiles,
  });
  return { ...result, logger };
};

describe('translation tables at discovery', () => {
  it('reads ru and en tables and reports nothing for a complete en', async () => {
    await install({
      'en.json': { name: 'Pack', 'theme.night': 'Night' },
      'ru.json': { name: 'Набор' },
    });
    const { extensions, diagnostics } = await discover();
    expect(diagnostics).toEqual([]);
    expect(extensions[0]?.messages).toEqual({
      en: { name: 'Pack', 'theme.night': 'Night' },
      ru: { name: 'Набор' },
    });
    expect(extensions[0]?.warnings).toEqual([]);
  });

  it('warns about a key that en lacks, even if ru has it', async () => {
    await install({
      'en.json': { name: 'Pack' },
      'ru.json': { name: 'Набор', 'theme.night': 'Ночь' },
    });
    const { extensions, logger } = await discover();
    expect(extensions[0]?.warnings).toEqual([
      { code: 'locale.missing-key', data: { key: 'theme.night' } },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      { extensionId: 'acme.pack' },
      "extension locale: key 'theme.night' is missing in locales/en.json",
    );
  });

  it('warns for every key when there is no en file at all', async () => {
    await install({ 'ru.json': { name: 'Набор', 'theme.night': 'Ночь' } });
    const { extensions } = await discover();
    expect(extensions[0]?.warnings.map(({ data }) => data.key)).toEqual([
      'name',
      'theme.night',
    ]);
    expect(extensions[0]?.messages).toEqual({
      ru: { name: 'Набор', 'theme.night': 'Ночь' },
    });
  });

  it.each([
    ['not JSON', '{ "name": '],
    ['an array', '["a"]'],
    ['a nested value', '{ "name": { "a": "b" } }'],
    [
      'a long value',
      JSON.stringify({ name: 'x'.repeat(LOCALE_LIMITS.valueLength + 1) }),
    ],
  ])(
    'ignores a broken file (%s) with a warning, the extension still loads',
    async (_name, content) => {
      await install({
        'en.json': { name: 'Pack', 'theme.night': 'Night' },
        'ru.json': content,
      });
      const { extensions, diagnostics } = await discover();
      expect(diagnostics).toEqual([]);
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.messages).toEqual({
        en: { name: 'Pack', 'theme.night': 'Night' },
      });
      expect(extensions[0]?.warnings).toHaveLength(1);
      expect(extensions[0]?.warnings[0]).toMatchObject({
        code: 'locale.invalid-file',
        data: { file: 'locales/ru.json' },
      });
    },
  );

  it('does not read a file over the size limit', async () => {
    await install({
      'en.json': { name: 'Pack', 'theme.night': 'Night' },
      'ru.json': ' '.repeat(LOCALE_LIMITS.fileBytes + 1),
    });
    const { extensions } = await discover();
    expect(extensions[0]?.warnings[0]).toMatchObject({
      code: 'locale.invalid-file',
      data: { file: 'locales/ru.json' },
    });
  });

  it('does not follow a symlink out of the extension directory', async () => {
    const outside = path.join(root, 'outside.json');
    await writeFile(outside, JSON.stringify({ name: 'Leaked' }));
    await install({ 'en.json': { name: 'Pack', 'theme.night': 'Night' } });
    await symlink(outside, path.join(root, 'acme.pack/locales/ru.json'));
    const { extensions } = await discover();
    expect(extensions[0]?.messages.ru).toBeUndefined();
    expect(extensions[0]?.warnings[0]).toMatchObject({
      code: 'locale.invalid-file',
    });
  });

  it('reads no files without verifyFiles', async () => {
    await install({ 'en.json': { name: 'Pack', 'theme.night': 'Night' } });
    const { extensions } = await discover(false);
    expect(extensions[0]?.messages).toEqual({});
    expect(extensions[0]?.warnings).toEqual([]);
  });

  it('formats both warnings in English for logs and tools', () => {
    expect(
      formatDiagnostic({ code: 'locale.missing-key', data: { key: 'a' } }),
    ).toBe("key 'a' is missing in locales/en.json");
    expect(
      formatDiagnostic({
        code: 'locale.invalid-file',
        data: { file: 'locales/ru.json', reason: 'bad' },
      }),
    ).toBe('locales/ru.json is ignored: bad');
  });
});

describe('registry with translations', () => {
  const registryOf = async () => {
    const holder = createDiscoveryHolder(await discover());
    return createExtensionRegistry(holder, createExtensionPolicy(holder));
  };

  it('passes the tables and the warnings to the window, labels stay raw', async () => {
    await install({
      'en.json': { name: 'Pack' },
      'ru.json': { name: 'Набор' },
    });
    const registry = await registryOf();
    const [info] = registry.list();
    expect(info).toMatchObject({
      name: '%name%',
      messages: { en: { name: 'Pack' }, ru: { name: 'Набор' } },
      diagnostics: [
        { code: 'locale.missing-key', data: { key: 'theme.night' } },
      ],
      state: 'loaded',
    });
    const contributions = registry.contributions();
    expect(contributions.themes[0]?.label).toBe('%theme.night%');
    expect(contributions.messages).toEqual({
      'acme.pack': { en: { name: 'Pack' }, ru: { name: 'Набор' } },
    });
  });

  it('omits extensions without tables from the contributions', async () => {
    await install({});
    const registry = await registryOf();
    expect(registry.contributions().messages).toEqual({});
    expect(registry.list()[0]?.messages).toEqual({});
  });
});
