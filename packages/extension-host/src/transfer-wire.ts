import { EXTENSION_TRANSFER_LIMITS } from '@dolphy-app/extension-api';
import type { ExportResult, ImportResult } from '@dolphy-app/extension-api';
import type { RunExporterRequest, RunImporterRequest } from './protocol.ts';
import type { StreamedRequest, StreamedResult } from './restricted-protocol.ts';

/**
 * Передача тел файлов между родителем и ограниченным процессом. Сообщение IPC
 * не больше 1 МиБ (`IPC_MAX_MESSAGE_CHARS`), а файл — до 20 МиБ, поэтому тело
 * идёт байтовым потоком частями `CHUNK_BYTES` в base64 (≤ 256 КиБ знаков, без
 * экранирования JSON), а структура — короткой «головой». Каталог файлов
 * кодируется кадрами `[длина пути u32][путь][длина содержимого u32][содержимое]`.
 */

/** Исходных байт в одной части; в base64 это ровно 256 КиБ знаков. */
export const CHUNK_BYTES = 192 * 1024;

/** Тело повреждено или нарушает потолок: получатель отказывает вызову. */
export class TransferWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferWireError';
  }
}

/** Самое большое тело каталога файлов: содержимое, пути и длины в кадрах. */
export const MAX_FILES_FRAME_BYTES =
  EXTENSION_TRANSFER_LIMITS.totalBytes +
  EXTENSION_TRANSFER_LIMITS.files * (8 + EXTENSION_TRANSFER_LIMITS.pathBytes);

const encoder = new TextEncoder();

const U32 = 4;

/** Кодирует каталог файлов в один буфер. */
export const encodeFiles = (
  files: Readonly<Record<string, string>>,
): Uint8Array => {
  const parts: Uint8Array[] = [];
  let size = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path);
    const body = encoder.encode(content);
    parts.push(name, body);
    size += U32 + name.length + U32 + body.length;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const name = parts[index] as Uint8Array;
    const body = parts[index + 1] as Uint8Array;
    view.setUint32(offset, name.length);
    out.set(name, offset + U32);
    offset += U32 + name.length;
    view.setUint32(offset, body.length);
    out.set(body, offset + U32);
    offset += U32 + body.length;
  }
  return out;
};

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const decodeText = (bytes: Uint8Array): string => {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new TransferWireError('content is not valid UTF-8');
  }
};

/** Разбирает кадры; `count` — сколько файлов обещано, лишнее и недостающее — ошибка. */
export const decodeFiles = (
  bytes: Uint8Array,
  count: number,
): Record<string, string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files: Record<string, string> = {};
  let offset = 0;
  const take = (): Uint8Array => {
    if (offset + U32 > bytes.length) {
      throw new TransferWireError('files frame is truncated');
    }
    const length = view.getUint32(offset);
    const start = offset + U32;
    if (start + length > bytes.length) {
      throw new TransferWireError('files frame is truncated');
    }
    offset = start + length;
    return bytes.subarray(start, offset);
  };
  for (let index = 0; index < count; index++) {
    const path = decodeText(take());
    const content = decodeText(take());
    if (Object.hasOwn(files, path)) {
      throw new TransferWireError(`file ${JSON.stringify(path)} is repeated`);
    }
    // defineProperty: путь `__proto__` — обычный ключ, а не смена прототипа
    Object.defineProperty(files, path, {
      value: content,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (offset !== bytes.length) {
    throw new TransferWireError('files frame has trailing bytes');
  }
  return files;
};

/** Тело вызова: голова без тела и поток байт; `null` — вызов целиком умещается в одно сообщение. */
export const splitRequest = (
  request: RunImporterRequest | RunExporterRequest,
): { head: StreamedRequest; body: Uint8Array } | null => {
  if (request.method === 'runImporter') {
    const { params } = request;
    const { extensionId, importerId, name, isolated } = params;
    return {
      head: {
        id: request.id,
        method: 'runImporter',
        params: {
          extensionId,
          importerId,
          name,
          isolated,
          input: 'text' in params ? 'text' : 'bytes',
        },
      },
      body: 'text' in params ? encoder.encode(params.text) : params.bytes,
    };
  }
  const { extensionId, exporterId, input, isolated } = request.params;
  if (input.scope === 'progress') return null;
  return {
    head: {
      id: request.id,
      method: 'runExporter',
      params: {
        extensionId,
        exporterId,
        isolated,
        input: {
          courseId: input.courseId,
          title: input.title,
          count: Object.keys(input.files).length,
        },
      },
    },
    body: encodeFiles(input.files),
  };
};

/** Самое большое тело, которое голова вправе обещать. */
export const maxRequestBody = (head: StreamedRequest): number =>
  head.method === 'runImporter'
    ? EXTENSION_TRANSFER_LIMITS.inputBytes
    : MAX_FILES_FRAME_BYTES;

/** Собирает вызов из головы и потока (обратное `splitRequest`). */
export const joinRequest = (
  head: StreamedRequest,
  body: Uint8Array,
): RunImporterRequest | RunExporterRequest => {
  if (head.method === 'runImporter') {
    const { input, ...rest } = head.params;
    return {
      id: head.id,
      method: 'runImporter',
      params: {
        ...rest,
        ...(input === 'text' ? { text: decodeText(body) } : { bytes: body }),
      },
    };
  }
  const { input, ...rest } = head.params;
  return {
    id: head.id,
    method: 'runExporter',
    params: {
      ...rest,
      input: {
        scope: 'course',
        courseId: input.courseId,
        title: input.title,
        files: decodeFiles(body, input.count),
      },
    },
  };
};

/** Проверенный результат обработчика в голову и поток. */
export const splitResult = (
  method: 'runImporter' | 'runExporter',
  result: ImportResult | ExportResult,
): { head: StreamedResult; body: Uint8Array } => {
  if (method === 'runImporter') {
    const { files } = result as ImportResult;
    return {
      head: { kind: 'files', count: Object.keys(files).length },
      body: encodeFiles(files),
    };
  }
  const file = result as ExportResult;
  return 'text' in file
    ? {
        head: { kind: 'text', filename: file.filename },
        body: encoder.encode(file.text),
      }
    : {
        head: { kind: 'bytes', filename: file.filename },
        body: file.bytes,
      };
};

/** Самое большое тело, которое голова результата вправе обещать. */
export const maxResultBody = (head: StreamedResult): number =>
  head.kind === 'files'
    ? MAX_FILES_FRAME_BYTES
    : EXTENSION_TRANSFER_LIMITS.outputBytes;

/** Собирает результат из головы и потока; форму и потолки проверяет вызывающий. */
export const joinResult = (
  head: StreamedResult,
  body: Uint8Array,
): ImportResult | ExportResult => {
  switch (head.kind) {
    case 'files':
      return { files: decodeFiles(body, head.count) };
    case 'text':
      return { filename: head.filename, text: decodeText(body) };
    default:
      return { filename: head.filename, bytes: body };
  }
};

/** Тело частями base64; пустое тело — одна пустая часть, чтобы получатель увидел конец. */
export function* chunksOf(body: Uint8Array): Generator<string> {
  if (body.length === 0) {
    yield '';
    return;
  }
  for (let start = 0; start < body.length; start += CHUNK_BYTES) {
    yield Buffer.from(
      body.buffer,
      body.byteOffset + start,
      Math.min(CHUNK_BYTES, body.length - start),
    ).toString('base64');
  }
}

/**
 * Собирает тело известного размера из частей по порядку. Отказ (`false`) —
 * часть вне очереди, больше обещанного или не base64: поток недействителен.
 */
export interface BodyReceiver {
  /** Принимает часть; `false` — поток недействителен. */
  accept(seq: number, data: string): boolean;
  /** Все `size` байт получены. */
  readonly complete: boolean;
  /** Собранное тело; вызывать после `complete`. */
  body(): Uint8Array;
}

export const createBodyReceiver = (size: number): BodyReceiver => {
  const body = new Uint8Array(size);
  let received = 0;
  let next = 0;
  return {
    accept(seq, data) {
      if (seq !== next || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return false;
      const chunk = Buffer.from(data, 'base64');
      if (received + chunk.length > size) return false;
      // не последняя часть обязана быть полной: так смещение определяется номером
      if (chunk.length !== CHUNK_BYTES && received + chunk.length !== size) {
        return false;
      }
      body.set(chunk, received);
      received += chunk.length;
      next += 1;
      return true;
    },
    get complete() {
      return received === size && (size > 0 || next > 0);
    },
    body: () => body,
  };
};
