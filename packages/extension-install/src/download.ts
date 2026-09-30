import { createHash } from 'node:crypto';
import path from 'node:path';
import { ExtensionInstallError } from '@dolphy-app/engine/ports';
import {
  CatalogFormatError,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  versionFileUrl,
} from '@dolphy-app/extension-catalog';
import type {
  CatalogFile,
  CatalogVersion,
} from '@dolphy-app/extension-catalog';
import { totalSize } from './dto.ts';
import type { InstallerFs } from './fs.ts';
import type { HttpClient } from './http.ts';

const MAX_PATH_LENGTH = 200;

export interface DownloadOptions {
  http: HttpClient;
  fs: InstallerFs;
  catalogUrl: string;
  extensionId: string;
  version: CatalogVersion;
  /** Каталог стейджинга: файлы ложатся по относительным путям. */
  directory: string;
}

const isSafePath = (value: string): boolean =>
  value.length > 0 &&
  value.length <= MAX_PATH_LENGTH &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  value
    .split('/')
    .every((segment) => segment !== '' && !segment.startsWith('.'));

/** Проверки, которые `parseIndex` уже делает, повторены: индекс мог прийти не из разбора. */
const assertPlan = (
  extensionId: string,
  files: readonly CatalogFile[],
  version: CatalogVersion,
): void => {
  const fail = (cause: 'limits' | 'invalid', message: string) =>
    new ExtensionInstallError(cause, extensionId, message);
  if (files.length > MAX_FILES) {
    throw fail('limits', `more than ${MAX_FILES} files`);
  }
  if (totalSize(version) > MAX_TOTAL_BYTES) {
    throw fail('limits', `total size exceeds ${MAX_TOTAL_BYTES} bytes`);
  }
  const paths = new Set<string>();
  const directories = new Set<string>();
  for (const { path: filePath } of files) {
    if (!isSafePath(filePath))
      throw fail('invalid', `unsafe path '${filePath}'`);
    if (paths.has(filePath))
      throw fail('invalid', `duplicate path '${filePath}'`);
    paths.add(filePath);
    const segments = filePath.split('/');
    for (let i = 1; i < segments.length; i++) {
      directories.add(segments.slice(0, i).join('/'));
    }
  }
  const clash = [...paths].find((p) => directories.has(p));
  if (clash !== undefined) {
    throw fail('invalid', `'${clash}' is both a file and a directory`);
  }
};

const fileLocation = (options: DownloadOptions, file: CatalogFile): URL => {
  try {
    return versionFileUrl(options.catalogUrl, options.version, file.path);
  } catch (error) {
    if (!(error instanceof CatalogFormatError)) throw error;
    throw new ExtensionInstallError(
      'network',
      options.extensionId,
      error.message,
    );
  }
};

const downloadFile = async (
  options: DownloadOptions,
  file: CatalogFile,
): Promise<void> => {
  const { extensionId } = options;
  const url = fileLocation(options, file);
  const response = await options.http.get({
    url,
    maxBytes: file.size,
    overflow: 'integrity',
    extensionId,
  });
  if (response.bytes.length !== file.size) {
    throw new ExtensionInstallError(
      'integrity',
      extensionId,
      `${file.path}: size ${response.bytes.length} differs from declared ${file.size}`,
    );
  }
  const digest = createHash('sha256').update(response.bytes).digest('hex');
  if (digest !== file.sha256) {
    throw new ExtensionInstallError(
      'integrity',
      extensionId,
      `${file.path}: sha256 mismatch`,
    );
  }
  const target = path.join(options.directory, ...file.path.split('/'));
  await options.fs.mkdir(path.dirname(target));
  await options.fs.writeFile(target, response.bytes);
};

/** Скачивает файлы версии в стейджинг, проверяя размер и sha256 каждого; origin проверяет `http`. */
export const downloadVersion = async (
  options: DownloadOptions,
): Promise<void> => {
  const { files } = options.version;
  assertPlan(options.extensionId, files, options.version);
  for (const file of files) {
    await downloadFile(options, file);
  }
};
