import { defineExtension, inActivate } from '@dolphy-app/extension-sdk';
import type {
  BytesImportInput,
  CourseExportInput,
  TextImportInput,
} from '@dolphy-app/extension-sdk';

export const host = defineExtension({
  importers: {
    'acme.transfer.csv': ({ name, text }: TextImportInput) => ({
      files: { 'course.yaml': `id: ${name}`, 'rows.csv': text },
    }),
    'acme.transfer.zip': inActivate,
  },
  exporters: {
    'acme.transfer.course': ({ title, files }: CourseExportInput) => ({
      filename: `${title}.json`,
      text: JSON.stringify(files),
    }),
    'acme.transfer.progress': inActivate,
  },
  activate(ctx) {
    ctx.importers.register('acme.transfer.zip', (input) => {
      const { bytes } = input as BytesImportInput;
      return { files: { 'size.txt': String(bytes.length) } };
    });
    ctx.exporters.register('acme.transfer.progress', async () => {
      const { current } = await ctx.stats.streak();
      return { filename: 'progress.txt', text: String(current) };
    });
  },
});
