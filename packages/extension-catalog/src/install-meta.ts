import { z } from 'zod';
import { CatalogFormatError } from './errors.ts';
import { isSemver } from './semver.ts';

/** Имя файла метаданных установки внутри каталога расширения. */
export const INSTALL_META_FILE = '.spirula-install.json';

const httpUrl = z
  .url()
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'catalogUrl must be an http(s) URL',
  );

export const installMetaSchema = z.strictObject({
  catalogUrl: httpUrl,
  version: z.string().refine(isSemver, 'version must be semver'),
  installedAt: z.iso.datetime(),
});

export type InstallMeta = z.infer<typeof installMetaSchema>;

/** Разбирает содержимое `.spirula-install.json`; бросает `CatalogFormatError`. */
export const parseInstallMeta = (raw: unknown): InstallMeta => {
  const result = installMetaSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new CatalogFormatError(
    result.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.join('.') || '/'}: ${issue.message}`),
  );
};
