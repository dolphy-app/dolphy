// Импортёры и экспортёры для проверки передачи файлов через ограниченный процесс.
export default {
  activate(ctx) {
    // тело файла возвращается как есть (файлами не больше 1 млн знаков): проверяет передачу частями туда и обратно
    ctx.importers.register('acme.csv.text', ({ name, text }) => {
      const files = { 'name.txt': name };
      let start = 0;
      let index = 0;
      do {
        let end = Math.min(start + 1_000_000, text.length);
        const last = text.charCodeAt(end - 1);
        if (end < text.length && last >= 0xd800 && last <= 0xdbff) end++;
        files[`body/${index++}.txt`] = text.slice(start, end);
        start = end;
      } while (start < text.length);
      return { files };
    });
    ctx.importers.register('acme.csv.bytes', ({ name, bytes }) => {
      let sum = 0;
      for (const byte of bytes) sum = (sum + byte) % 1_000_003;
      return {
        files: {
          'info.json': JSON.stringify({
            name,
            isUint8Array: bytes instanceof Uint8Array,
            length: bytes.length,
            sum,
          }),
        },
      };
    });
    // `{count, size}` в тексте: count файлов по size знаков
    ctx.importers.register('acme.csv.many', ({ text }) => {
      const { count, size } = JSON.parse(text);
      const files = {};
      for (let index = 0; index < count; index++) {
        files[`f/${index}.txt`] = 'x'.repeat(size);
      }
      return { files };
    });
    ctx.importers.register('acme.csv.bad', () => ({
      files: { '../escape.txt': 'x' },
    }));
    ctx.importers.register('acme.csv.fail', () => {
      throw new Error('importer boom');
    });
    ctx.importers.register('acme.csv.spin', () => {
      for (;;);
    });
    ctx.importers.register('acme.csv.pid', () => ({
      files: { 'pid.txt': String(process.pid) },
    }));

    ctx.exporters.register('acme.csv.course', (input) => ({
      filename: 'course.json',
      text: JSON.stringify({
        courseId: input.courseId,
        title: input.title,
        files: input.files,
      }),
    }));
    ctx.exporters.register('acme.csv.course-bytes', (input) => ({
      filename: 'course.bin',
      bytes: new TextEncoder().encode(Object.values(input.files).join('')),
    }));
    ctx.exporters.register('acme.csv.progress', async () => {
      const streak = await ctx.stats.streak();
      return { filename: 'progress.txt', text: `streak ${streak.current}` };
    });
    ctx.exporters.register('acme.csv.huge', () => ({
      filename: 'huge.bin',
      bytes: new Uint8Array(5 * 1024 * 1024 + 7).fill(7),
    }));
    ctx.exporters.register('acme.csv.bad-name', () => ({
      filename: '../etc/passwd',
      text: 'x',
    }));
  },
};
