/**
 * Asset types of a catalog version: file extensions, size ceilings, MIME types, and
 * signature/geometry readers for the binary formats. Pure functions over bytes: the
 * installer, the protocol and the author tools read the same constants.
 */

/** File extensions the first catalog format accepts (the released apps parse only these). */
export const LEGACY_FILE_EXTENSIONS = [
  'json',
  'js',
  'mjs',
  'md',
  'txt',
] as const;

/** Style sheets, images and fonts an extension may ship. */
export const ASSET_EXTENSIONS = [
  'css',
  'svg',
  'png',
  'webp',
  'jpg',
  'jpeg',
  'woff2',
] as const;

export type AssetExtension = (typeof ASSET_EXTENSIONS)[number];
export type BinaryAssetExtension = Exclude<AssetExtension, 'css' | 'svg'>;

/** Every extension a file of a version may have in the full index. */
export const CATALOG_FILE_EXTENSIONS: readonly string[] = [
  ...LEGACY_FILE_EXTENSIONS,
  ...ASSET_EXTENSIONS,
];

/** Files in a version in the full index (`index.v2.json`); the first format stays at `MAX_FILES`. */
export const MAX_FILES_V2 = 100;

const KIB = 1024;

/** Per-file ceilings in bytes. `icon` bounds the manifest icon, which travels inside the index. */
export const ASSET_LIMITS = {
  css: 256 * KIB,
  svg: 64 * KIB,
  image: 512 * KIB,
  woff2: 1024 * KIB,
  icon: 16 * KIB,
} as const;

/** Largest side of a raster image in pixels. */
export const MAX_IMAGE_SIDE = 4096;
/** Icon side range in pixels; the icon is square. */
export const ICON_MIN_SIDE = 64;
export const ICON_MAX_SIDE = 512;

/** Icon formats: raster only, an SVG icon is not accepted. */
export const ICON_EXTENSIONS = ['png', 'webp'] as const;
export type IconExtension = (typeof ICON_EXTENSIONS)[number];

export const ASSET_MIME: Readonly<Record<AssetExtension, string>> = {
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  woff2: 'font/woff2',
};

/** Extension of the last path segment, as written (case-sensitive); `null` — none. */
export const extensionOf = (path: string): string | null => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : null;
};

export const isAssetExtension = (value: string): value is AssetExtension =>
  (ASSET_EXTENSIONS as readonly string[]).includes(value);

/** The asset type of a path (lowercase extension only), or `null` for a non-asset file. */
export const assetExtensionOf = (path: string): AssetExtension | null => {
  const extension = extensionOf(path);
  return extension !== null && isAssetExtension(extension) ? extension : null;
};

export const isBinaryAsset = (
  extension: AssetExtension,
): extension is BinaryAssetExtension =>
  extension !== 'css' && extension !== 'svg';

/** Ceiling in bytes for one file of the asset type. */
export const assetSizeLimit = (extension: AssetExtension): number => {
  if (extension === 'css') return ASSET_LIMITS.css;
  if (extension === 'svg') return ASSET_LIMITS.svg;
  return extension === 'woff2' ? ASSET_LIMITS.woff2 : ASSET_LIMITS.image;
};

/** Problem text when a file of the given path exceeds its per-type ceiling; `null` — within limits. */
export const sizeProblem = (path: string, size: number): string | null => {
  const extension = assetExtensionOf(path);
  if (extension === null) return null;
  const limit = assetSizeLimit(extension);
  return size > limit
    ? `${path}: ${size} bytes exceed the limit of ${limit} for .${extension}`
    : null;
};

export interface Dimensions {
  width: number;
  height: number;
}

export type BinaryInspection =
  { ok: true; size: Dimensions | null } | { ok: false; reason: string };

const fail = (reason: string): BinaryInspection => ({ ok: false, reason });
const okWith = (size: Dimensions | null): BinaryInspection => ({
  ok: true,
  size,
});

const ascii = (bytes: Uint8Array, offset: number, length: number): string => {
  let text = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    text += String.fromCharCode(bytes[i] ?? 0);
  }
  return text;
};

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;
const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = (crcTable[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const inspectPng = (bytes: Uint8Array): BinaryInspection => {
  if (
    bytes.length < 8 ||
    PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    return fail('not a PNG file (signature mismatch)');
  }
  const data = view(bytes);
  let offset = 8;
  let dimensions: Dimensions | null = null;
  let first = true;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = data.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length) return fail('PNG chunk runs past the end of file');
    if (first && type !== 'IHDR') return fail('PNG does not start with IHDR');
    if (type === 'IHDR') {
      if (!first || length !== 13) return fail('PNG has a malformed IHDR');
      if (data.getUint32(end - 4) !== crc32(bytes, offset + 4, end - 4)) {
        return fail('PNG IHDR checksum mismatch');
      }
      dimensions = {
        width: data.getUint32(offset + 8),
        height: data.getUint32(offset + 12),
      };
    }
    if (type === 'acTL') return fail('animated PNG is not accepted');
    first = false;
    offset = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended || dimensions === null) return fail('PNG is truncated (no IEND)');
  if (offset !== bytes.length) return fail('PNG has data after IEND');
  return okWith(dimensions);
};

const isStandaloneMarker = (marker: number): boolean =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);

const isStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 &&
  marker <= 0xcf &&
  marker !== 0xc4 &&
  marker !== 0xc8 &&
  marker !== 0xcc;

const inspectJpeg = (bytes: Uint8Array): BinaryInspection => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return fail('not a JPEG file (signature mismatch)');
  }
  const data = view(bytes);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return fail('JPEG segment is malformed');
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (isStandaloneMarker(marker)) {
      offset += 2;
      continue;
    }
    const length = data.getUint16(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) {
      return fail('JPEG segment runs past the end of file');
    }
    if (isStartOfFrame(marker)) {
      if (length < 8) return fail('JPEG frame header is malformed');
      return okWith({
        height: data.getUint16(offset + 5),
        width: data.getUint16(offset + 7),
      });
    }
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  return fail('JPEG has no frame header');
};

const littleEndian24 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) |
  ((bytes[offset + 1] ?? 0) << 8) |
  ((bytes[offset + 2] ?? 0) << 16);

const inspectWebp = (bytes: Uint8Array): BinaryInspection => {
  if (
    bytes.length < 21 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP'
  ) {
    return fail('not a WebP file (signature mismatch)');
  }
  const data = view(bytes);
  if (data.getUint32(4, true) + 8 !== bytes.length) {
    return fail('WebP RIFF size does not match the file size');
  }
  const chunk = ascii(bytes, 12, 4);
  const needed = chunk === 'VP8L' ? 25 : 30;
  if (bytes.length < needed) return fail('WebP header is truncated');
  if (chunk === 'VP8X') {
    if ((bytes[20] ?? 0) & 0x02) return fail('animated WebP is not accepted');
    return okWith({
      width: littleEndian24(bytes, 24) + 1,
      height: littleEndian24(bytes, 27) + 1,
    });
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return fail('WebP lossless header is malformed');
    const bits = data.getUint32(21, true);
    return okWith({
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    });
  }
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return fail('WebP lossy header is malformed');
    }
    return okWith({
      width: data.getUint16(26, true) & 0x3fff,
      height: data.getUint16(28, true) & 0x3fff,
    });
  }
  return fail('WebP has an unknown first chunk');
};

const WOFF2_HEADER_BYTES = 48;

const inspectWoff2 = (bytes: Uint8Array): BinaryInspection => {
  if (bytes.length < WOFF2_HEADER_BYTES || ascii(bytes, 0, 4) !== 'wOF2') {
    return fail('not a WOFF2 file (signature mismatch)');
  }
  return view(bytes).getUint32(8) === bytes.length
    ? okWith(null)
    : fail('WOFF2 length field does not match the file size');
};

/**
 * Checks the signature and structure of a binary asset and reads the pixel size of
 * images. A declared size above `MAX_IMAGE_SIDE` is a failure: the header is not trusted.
 */
export const inspectBinaryAsset = (
  extension: BinaryAssetExtension,
  bytes: Uint8Array,
): BinaryInspection => {
  let result: BinaryInspection;
  if (extension === 'png') result = inspectPng(bytes);
  else if (extension === 'webp') result = inspectWebp(bytes);
  else if (extension === 'woff2') result = inspectWoff2(bytes);
  else result = inspectJpeg(bytes);
  if (!result.ok || result.size === null) return result;
  const { width, height } = result.size;
  if (width < 1 || height < 1) return fail('image has an empty size');
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    return fail(
      `image is ${width}x${height}, the limit is ${MAX_IMAGE_SIDE}x${MAX_IMAGE_SIDE}`,
    );
  }
  return result;
};

const isIconExtension = (value: string | null): value is IconExtension =>
  value === 'png' || value === 'webp';

/**
 * Problem with a manifest icon: format, size in bytes, geometry. `null` — fits.
 * `path` is the icon path from the manifest, `bytes` the file contents.
 */
export const iconProblem = (path: string, bytes: Uint8Array): string | null => {
  const extension = extensionOf(path);
  if (!isIconExtension(extension)) {
    return `icon '${path}' must be a .png or .webp file`;
  }
  if (bytes.length > ASSET_LIMITS.icon) {
    return `icon '${path}' is ${bytes.length} bytes, the limit is ${ASSET_LIMITS.icon}`;
  }
  const inspected = inspectBinaryAsset(extension, bytes);
  if (!inspected.ok) return `icon '${path}': ${inspected.reason}`;
  const { width, height } = inspected.size ?? { width: 0, height: 0 };
  if (width !== height) {
    return `icon '${path}' must be square, it is ${width}x${height}`;
  }
  if (width < ICON_MIN_SIDE || width > ICON_MAX_SIDE) {
    return `icon '${path}' must be ${ICON_MIN_SIDE} to ${ICON_MAX_SIDE} pixels, it is ${width}`;
  }
  return null;
};

/** `data:image/png|webp;base64,…` — the icon as the index and the window carry it. */
export const iconDataUri = (path: string, bytes: Uint8Array): string => {
  const extension = extensionOf(path) === 'webp' ? 'webp' : 'png';
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/${extension};base64,${btoa(binary)}`;
};

/** Longest `iconDataUri` the schema accepts: the base64 of `ASSET_LIMITS.icon` bytes plus the prefix. */
export const MAX_ICON_URI_LENGTH =
  'data:image/webp;base64,'.length + Math.ceil(ASSET_LIMITS.icon / 3) * 4;
export const ICON_URI_PATTERN =
  /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
