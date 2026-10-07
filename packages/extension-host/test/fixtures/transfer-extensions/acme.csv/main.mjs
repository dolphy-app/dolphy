// Импортёры и экспортёры для проверки передачи файлов.
export const server = (s) => {
  const importer = (id, input, run) =>
    s.registerImporter({
      id,
      title: id,
      accept: input === 'bytes' ? ['.bin'] : ['.txt', '.csv'],
      input,
      run,
    });
  const exporter = (id, scope, run) =>
    s.registerExporter({ id, title: id, scope, run });

  // тело файла возвращается как есть (файлами не больше 1 млн знаков): проверяет передачу туда и обратно
  importer('acme.csv.text', 'text', ({ name, text }) => {
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
  importer('acme.csv.bytes', 'bytes', ({ name, bytes }) => {
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
  importer('acme.csv.many', 'text', ({ text }) => {
    const { count, size } = JSON.parse(text);
    const files = {};
    for (let index = 0; index < count; index++) {
      files[`f/${index}.txt`] = 'x'.repeat(size);
    }
    return { files };
  });
  importer('acme.csv.bad', 'text', () => ({ files: { '../escape.txt': 'x' } }));
  importer('acme.csv.fail', 'text', () => {
    throw new Error('importer boom');
  });
  importer('acme.csv.spin', 'text', () => {
    for (;;);
  });
  importer('acme.csv.pid', 'text', () => ({
    files: { 'pid.txt': String(process.pid) },
  }));

  exporter('acme.csv.course', 'course', (input) => ({
    filename: 'course.json',
    text: JSON.stringify({
      courseId: input.courseId,
      title: input.title,
      files: input.files,
    }),
  }));
  exporter('acme.csv.course-bytes', 'course', (input) => ({
    filename: 'course.bin',
    bytes: new TextEncoder().encode(Object.values(input.files).join('')),
  }));
  exporter('acme.csv.progress', 'progress', async () => {
    const streak = await s.stats.streak();
    return { filename: 'progress.txt', text: `streak ${streak.current}` };
  });
  exporter('acme.csv.huge', 'course', () => ({
    filename: 'huge.bin',
    bytes: new Uint8Array(5 * 1024 * 1024 + 7).fill(7),
  }));
  exporter('acme.csv.bad-name', 'course', () => ({
    filename: '../etc/passwd',
    text: 'x',
  }));
};
