import { DEFAULT_MARKDOWN_RENDERER } from '@spirula-app/extension-api';
import { z } from 'zod';
import { resolveModuleUrl, safePath } from './support.ts';
import type { ContributionPoint } from './types.ts';

export const markdownRenderers: ContributionPoint<'markdownRenderers'> = {
  key: 'markdownRenderers',
  needsMain: false,
  schema: z.strictObject({
    language: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'invalid language'),
    renderer: safePath(['.js', '.mjs']).optional(),
  }),
  normalize: (entries) =>
    entries.map((entry) => ({
      language: entry.language,
      renderer: entry.renderer ?? DEFAULT_MARKDOWN_RENDERER,
    })),
  check: () => [],
  resolve: async (entries, { dir, extensionId, verifyFiles }) => {
    const resolved = [];
    for (const entry of entries) {
      resolved.push({
        language: entry.language,
        rendererUrl: await resolveModuleUrl(
          extensionId,
          dir,
          entry.renderer,
          DEFAULT_MARKDOWN_RENDERER,
          verifyFiles,
          'markdown renderer',
        ),
      });
    }
    return resolved;
  },
  claims: (resolved) => resolved.map((entry) => `markdown:${entry.language}`),
};
