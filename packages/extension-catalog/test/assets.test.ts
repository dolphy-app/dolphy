import { describe, expect, it } from 'vitest';
import {
  ASSET_LIMITS,
  type BinaryInspection,
  assetExtensionOf,
  iconDataUri,
  iconProblem,
  inspectBinaryAsset,
  sizeProblem,
} from '../src/index.ts';
import { jpeg, png, webp, woff2 } from './samples.ts';

const sizeOf = (result: BinaryInspection) =>
  result.ok ? result.size : result.reason;

describe('inspectBinaryAsset', () => {
  it('reads the declared pixel size of every raster format', () => {
    expect(sizeOf(inspectBinaryAsset('png', png(120, 80)))).toEqual({
      width: 120,
      height: 80,
    });
    expect(sizeOf(inspectBinaryAsset('jpg', jpeg(300, 200)))).toEqual({
      width: 300,
      height: 200,
    });
    expect(sizeOf(inspectBinaryAsset('jpeg', jpeg(65, 66)))).toEqual({
      width: 65,
      height: 66,
    });
    for (const kind of ['lossy', 'lossless', 'extended'] as const) {
      expect(sizeOf(inspectBinaryAsset('webp', webp(100, 90, kind)))).toEqual({
        width: 100,
        height: 90,
      });
    }
  });

  it('accepts a WOFF2 whose length field matches', () => {
    expect(inspectBinaryAsset('woff2', woff2(100))).toEqual({
      ok: true,
      size: null,
    });
  });

  it('rejects a file of another format under the extension', () => {
    expect(inspectBinaryAsset('png', jpeg())).toMatchObject({ ok: false });
    expect(inspectBinaryAsset('jpg', png())).toMatchObject({ ok: false });
    expect(inspectBinaryAsset('webp', png())).toMatchObject({ ok: false });
    expect(inspectBinaryAsset('woff2', png())).toMatchObject({ ok: false });
    expect(
      inspectBinaryAsset('png', new TextEncoder().encode('<svg/>')),
    ).toMatchObject({ ok: false });
  });

  it('does not trust a forged IHDR: a declared size above the limit fails', () => {
    const forged = inspectBinaryAsset('png', png(100_000, 100_000));
    expect(forged).toMatchObject({ ok: false });
    expect(forged.ok ? '' : forged.reason).toContain('4096');
    expect(inspectBinaryAsset('png', png(4096, 4096)).ok).toBe(true);
    expect(inspectBinaryAsset('png', png(4097, 10)).ok).toBe(false);
    expect(inspectBinaryAsset('jpg', jpeg(5000, 100)).ok).toBe(false);
    expect(inspectBinaryAsset('webp', webp(5000, 100, 'extended')).ok).toBe(
      false,
    );
  });

  it('rejects a damaged IHDR checksum, truncation and trailing data', () => {
    const damaged = png();
    damaged[16] = (damaged[16] ?? 0) ^ 0xff;
    expect(inspectBinaryAsset('png', damaged).ok).toBe(false);
    expect(inspectBinaryAsset('png', png(64, 64, { truncate: true })).ok).toBe(
      false,
    );
    const trailing = Uint8Array.from([...png(), 1, 2, 3]);
    expect(inspectBinaryAsset('png', trailing).ok).toBe(false);
  });

  it('rejects animated PNG and WebP', () => {
    expect(inspectBinaryAsset('png', png(64, 64, { extra: ['acTL'] }))).toEqual(
      { ok: false, reason: 'animated PNG is not accepted' },
    );
    expect(inspectBinaryAsset('webp', webp(64, 64, 'animated'))).toEqual({
      ok: false,
      reason: 'animated WebP is not accepted',
    });
  });

  it('rejects mismatching container sizes', () => {
    const shortWebp = webp().slice(0, -2);
    expect(inspectBinaryAsset('webp', shortWebp).ok).toBe(false);
    const badWoff = woff2(100);
    new DataView(badWoff.buffer).setUint32(8, 99);
    expect(inspectBinaryAsset('woff2', badWoff).ok).toBe(false);
    expect(inspectBinaryAsset('woff2', woff2(100).slice(0, 10)).ok).toBe(false);
  });

  it('does not throw on truncated input of any length', () => {
    for (const extension of ['png', 'jpg', 'webp', 'woff2'] as const) {
      const source = {
        png: png(),
        jpg: jpeg(),
        webp: webp(),
        woff2: woff2(),
      }[extension];
      for (let length = 0; length < source.length; length++) {
        expect(() =>
          inspectBinaryAsset(extension, source.slice(0, length)),
        ).not.toThrow();
      }
    }
  });
});

describe('iconProblem', () => {
  it('accepts a square 64..512 PNG or WebP within 16 KiB', () => {
    expect(iconProblem('assets/icon.png', png(64))).toBeNull();
    expect(iconProblem('assets/icon.webp', webp(512, 512))).toBeNull();
  });

  it('rejects other formats, sizes and shapes', () => {
    expect(iconProblem('assets/icon.svg', png())).toContain('.png or .webp');
    expect(iconProblem('assets/icon.jpg', jpeg())).toContain('.png or .webp');
    expect(iconProblem('assets/icon.png', png(63))).toContain('64 to 512');
    expect(iconProblem('assets/icon.png', png(513))).toContain('64 to 512');
    expect(iconProblem('assets/icon.png', png(64, 128))).toContain('square');
    expect(iconProblem('assets/icon.png', jpeg())).toContain('PNG');
  });

  it('rejects an icon over 16 KiB', () => {
    const big = png(64, 64, { padding: ASSET_LIMITS.icon });
    expect(iconProblem('assets/icon.png', big)).toContain(
      String(ASSET_LIMITS.icon),
    );
  });
});

describe('asset helpers', () => {
  it('matches only lowercase extensions', () => {
    expect(assetExtensionOf('assets/a.png')).toBe('png');
    expect(assetExtensionOf('assets/a.PNG')).toBeNull();
    expect(assetExtensionOf('main.mjs')).toBeNull();
    expect(assetExtensionOf('assets/.png')).toBeNull();
  });

  it('applies the per-type ceilings', () => {
    expect(sizeProblem('a.css', ASSET_LIMITS.css)).toBeNull();
    expect(sizeProblem('a.css', ASSET_LIMITS.css + 1)).toContain('a.css');
    expect(sizeProblem('a.svg', ASSET_LIMITS.svg + 1)).not.toBeNull();
    expect(sizeProblem('a.jpeg', ASSET_LIMITS.image + 1)).not.toBeNull();
    expect(sizeProblem('a.woff2', ASSET_LIMITS.woff2)).toBeNull();
    expect(sizeProblem('main.mjs', 9_000_000)).toBeNull();
  });

  it('builds a data URI of the icon', () => {
    const uri = iconDataUri('assets/icon.png', png());
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    expect(
      iconDataUri('assets/icon.webp', webp()).startsWith('data:image/webp'),
    ).toBe(true);
    expect(Buffer.from(uri.split(',')[1] ?? '', 'base64')).toEqual(
      Buffer.from(png()),
    );
  });
});
