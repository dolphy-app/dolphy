/** Builders of small valid binary assets and of forged ones; shared by the catalog and tool tests. */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const text = (value: string): number[] =>
  [...value].map((char) => char.charCodeAt(0));

const chunk = (type: string, data: number[]): number[] => {
  const body = [...text(type), ...data];
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
};

export interface PngOptions {
  /** Extra chunk types written before IDAT (`acTL` makes the file animated). */
  extra?: string[];
  /** Cut the file after IDAT: no IEND. */
  truncate?: boolean;
  /** Padding inside IDAT to reach a size. */
  padding?: number;
}

/** A PNG whose IHDR declares `width`x`height`; the pixel data is not real, as in a forged file. */
export const png = (
  width = 64,
  height = width,
  options: PngOptions = {},
): Uint8Array =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...(options.extra ?? []).flatMap((type) => chunk(type, [0, 0, 0, 0])),
    ...chunk('IDAT', [
      0x78,
      0x9c,
      0x63,
      0x00,
      0x00,
      0x00,
      0x02,
      0x00,
      0x01,
      ...Array.from({ length: options.padding ?? 0 }, () => 0),
    ]),
    ...(options.truncate ? [] : chunk('IEND', [])),
  ]);

/** A JPEG with one SOF0 frame header declaring `width`x`height`. */
export const jpeg = (width = 64, height = width): Uint8Array =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x4a,
    0x46,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9,
  ]);

const le32 = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

const le24 = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
];

export type WebpKind = 'lossy' | 'lossless' | 'extended' | 'animated';

/** A WebP with the header of the given kind declaring `width`x`height`. */
export const webp = (
  width = 64,
  height = width,
  kind: WebpKind = 'lossless',
): Uint8Array => {
  let body: number[];
  if (kind === 'extended' || kind === 'animated') {
    body = [
      ...text('VP8X'),
      ...le32(10),
      kind === 'animated' ? 0x02 : 0,
      0,
      0,
      0,
      ...le24(width - 1),
      ...le24(height - 1),
    ];
  } else if (kind === 'lossless') {
    const bits = (width - 1) | ((height - 1) << 14);
    body = [...text('VP8L'), ...le32(5), 0x2f, ...le32(bits >>> 0).slice(0, 4)];
    body.push(0);
  } else {
    body = [
      ...text('VP8 '),
      ...le32(10),
      0,
      0,
      0,
      0x9d,
      0x01,
      0x2a,
      width & 0xff,
      (width >> 8) & 0x3f,
      height & 0xff,
      (height >> 8) & 0x3f,
    ];
  }
  const padded = body.length % 2 === 0 ? body : [...body, 0];
  return Uint8Array.from([
    ...text('RIFF'),
    ...le32(4 + padded.length),
    ...text('WEBP'),
    ...padded,
  ]);
};

/** A WOFF2 header of the given total length; the tables are not real. */
export const woff2 = (length = 64): Uint8Array => {
  const bytes = new Uint8Array(length);
  bytes.set(text('wOF2'), 0);
  new DataView(bytes.buffer).setUint32(8, length);
  return bytes;
};

export const utf8 = (value: string): Uint8Array =>
  new TextEncoder().encode(value);
