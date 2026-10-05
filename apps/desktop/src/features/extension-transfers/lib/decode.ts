const decoder = new TextDecoder('utf-8', { fatal: true });

/** Байты файла как UTF-8; `null`, если это не текст в UTF-8 (BOM отбрасывается). */
export const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
};
