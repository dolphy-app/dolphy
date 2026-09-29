/** Номера строк в исходном тексте для диагностик. */

/** Строка (1-based) каждого ключа верхнего уровня JSON-объекта; один проход. */
export const topLevelKeyLines = (text: string): Map<string, number> => {
  const lines = new Map<string, number>();
  let depth = 0;
  let line = 1;
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      line++;
    } else if (code === 34) {
      const startLine = line;
      let j = i + 1;
      while (j < text.length && text.charCodeAt(j) !== 34) {
        if (text.charCodeAt(j) === 92) j++;
        else if (text.charCodeAt(j) === 10) line++;
        j++;
      }
      if (depth === 1 && expectKey) {
        let k = j + 1;
        while (k < text.length && /[ \n\r\t]/.test(text.charAt(k))) k++;
        if (text.charCodeAt(k) === 58) {
          lines.set(text.slice(i + 1, j), startLine);
        }
        expectKey = false;
      }
      i = j;
    } else if (code === 123 || code === 91) {
      depth++;
      if (code === 123 && depth === 1) expectKey = true;
    } else if (code === 125 || code === 93) {
      depth--;
    } else if (code === 44 && depth === 1) {
      expectKey = true;
    }
  }
  return lines;
};

/** Строка (1-based) символа с индексом `offset`. */
export const lineOfOffset = (text: string, offset: number): number => {
  let line = 1;
  for (
    let i = text.indexOf('\n');
    i >= 0 && i < offset;
    i = text.indexOf('\n', i + 1)
  ) {
    line++;
  }
  return line;
};
