import { describe, expect, it } from 'vitest';
import {
  assetProblem,
  validateCss,
  validateSvg,
} from '../src/catalog/assets.ts';
import {
  jpeg,
  png,
  utf8,
  webp,
  woff2,
} from '../../extension-catalog/test/samples.ts';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (body = '', attributes = ''): string =>
  `<svg ${NS} viewBox="0 0 10 10" ${attributes}>${body}</svg>`;

describe('validateSvg: accepts', () => {
  it('a plain drawing with gradients, local references and a style element', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" width="10" height="10">
  <title>logo &amp; mark</title>
  <defs>
    <linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    <style><![CDATA[ .a { fill: url(#g); } ]]></style>
  </defs>
  <g class="a" transform="translate(1 1)"><rect width="5" height="5" fill="url(#g)" style="stroke:red"/></g>
  <use xlink:href="#g"/><use href="#g"/>
  <image href="data:image/png;base64,AAAA" width="2" height="2"/>
  <!-- comment -->
</svg>`;
    expect(validateSvg(text)).toBeNull();
  });

  it('accepts a byte order mark', () => {
    expect(validateSvg(`\ufeff${svg('<path d="M0 0L1 1"/>')}`)).toBeNull();
  });
});

describe('validateSvg: rejects hostile documents', () => {
  const hostile: [string, string, RegExp][] = [
    ['script element', svg('<script>alert(1)</script>'), /<script>/],
    ['self-closing script', svg('<script href="x"/>'), /<script>/],
    [
      'foreignObject',
      svg('<foreignObject><div/></foreignObject>'),
      /foreignObject/,
    ],
    ['onload attribute', svg('', 'onload="alert(1)"'), /event handler/],
    ['onclick on a child', svg('<rect onclick="x()"/>'), /event handler/],
    ['uppercase handler', svg('<rect ONMOUSEOVER="x()"/>'), /event handler/],
    [
      'DOCTYPE with an entity',
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]>${svg('<text>&x;</text>')}`,
      /DOCTYPE/,
    ],
    ['ENTITY outside a DOCTYPE', svg('<!ENTITY x "y">'), /DOCTYPE/],
    ['an undefined entity reference', svg('<text>&x;</text>'), /entity/],
    ['external href', svg('<image href="https://example.com/a.png"/>'), /href/],
    [
      'external xlink:href',
      svg('<use xlink:href="https://example.com/a.svg#x"/>'),
      /href/,
    ],
    ['javascript href', svg('<use href="javascript:alert(1)"/>'), /href/],
    [
      'href disguised with a character reference',
      svg('<use href="&#106;avascript:alert(1)"/>'),
      /href/,
    ],
    ['an anchor', svg('<a href="#x"><rect/></a>'), /<a>/],
    [
      'external url() in an attribute',
      svg('<rect fill="url(https://example.com/x)"/>'),
      /url\(/,
    ],
    [
      'external url() in a style attribute',
      svg('<rect style="fill:url(http://example.com/x)"/>'),
      /url\(/,
    ],
    [
      'style element with @import',
      svg('<style>@import url(https://example.com/a.css);</style>'),
      /@import/,
    ],
    [
      'style element with an escaped @import',
      svg('<style>@\\69mport "https://example.com/a.css";</style>'),
      /@import/,
    ],
    [
      'style element with a relative url (an SVG is a leaf)',
      svg('<style>.a{fill:url(x.svg#y)}</style>'),
      /url\(/,
    ],
    [
      'data:image/svg+xml href',
      svg('<image href="data:image/svg+xml;base64,AAAA"/>'),
      /href/,
    ],
    ['data: href on use', svg('<use href="data:image/png;base64,AA"/>'), /use/],
    [
      'an animation element',
      svg('<set attributeName="href" to="x"/>'),
      /<set>/,
    ],
    ['feImage', svg('<filter><feImage href="#a"/></filter>'), /feImage/],
    ['a namespaced element', svg('<svg:rect/>'), /namespaced/],
    [
      'a foreign namespace declaration',
      svg('', 'xmlns:h="http://www.w3.org/1999/xhtml"'),
      /namespace/,
    ],
    [
      'a processing instruction',
      `<?xml-stylesheet href="x.css"?>${svg()}`,
      /processing/,
    ],
    ['an unknown attribute', svg('<rect srcdoc="x"/>'), /srcdoc/],
    ['a non-svg root', '<html xmlns="http://www.w3.org/1999/xhtml"/>', /root/],
    ['a missing xmlns', '<svg viewBox="0 0 1 1"/>', /xmlns/],
    ['a wrong xmlns', '<svg xmlns="http://example.com/"/>', /xmlns/],
    ['two roots', `${svg()}${svg()}`, /root/],
    ['text after the root', `${svg()}tail`, /outside/],
    ['an unclosed element', `<svg ${NS}><g>`, /not closed/],
    ['a mismatched tag', `<svg ${NS}><g></rect></svg>`, /unexpected/],
    ['an unquoted attribute', `<svg ${NS} width=10/>`, /quoted/],
    ['a duplicate attribute', svg('<rect x="1" x="2"/>'), /duplicate/],
    ['a NUL byte', svg('<title>a\0b</title>'), /NUL/],
    [
      'a style type other than css',
      svg('<style type="text/js">1</style>'),
      /text\/css/,
    ],
    [
      'an expression()',
      svg('<rect style="width:expression(alert(1))"/>'),
      /expression/,
    ],
    ['empty input', '', /root/],
  ];
  it.each(hostile)('%s', (_name, text, pattern) => {
    const problem = validateSvg(text);
    expect(problem).not.toBeNull();
    expect(problem).toMatch(pattern);
  });

  it('rejects nesting that is too deep', () => {
    const deep = `${'<g>'.repeat(40)}${'</g>'.repeat(40)}`;
    expect(validateSvg(svg(deep))).toContain('too deep');
  });
});

describe('validateCss', () => {
  const css = (text: string) =>
    validateCss(text, { kind: 'css', path: 'assets/panel.css' });

  it('accepts ordinary styles, data URIs, relative paths and fragment references', () => {
    expect(
      css(`
        @font-face { font-family: X; src: url("./font.woff2") format("woff2"); }
        .a { background: url(logo.png); }
        .b { background: url('../img/x.png'); }
        .c { background-image: url(data:image/png;base64,AAAA); }
        @font-face { font-family: Y; src: url(data:font/woff2;base64,AAAA); }
        .d { filter: url(#blur); content: "url(http://example.com)"; }
        /* url(http://commented.example) */
        .e { background: image-set(url(a.png) 1x, url(b.png) 2x); }
      `),
    ).toBeNull();
  });

  const rejected: [string, string, RegExp][] = [
    [
      '@import with a string',
      '@import "https://example.com/a.css";',
      /@import/,
    ],
    ['@import with url()', '@import url(a.css);', /@import/],
    ['an upper-case @IMPORT', '@IMPORT "a.css";', /@import/],
    ['an escaped @import', '@\\69mport "a.css";', /@import/],
    [
      'an @import with a comment before it',
      '/* x */@import "a.css";',
      /@import/,
    ],
    ['https url()', '.a{background:url(https://example.com/x.png)}', /outside/],
    [
      'quoted http url()',
      ".a{background:url('http://example.com/x.png')}",
      /outside/,
    ],
    [
      'protocol-relative url()',
      '.a{background:url(//example.com/x.png)}',
      /outside/,
    ],
    ['file: url()', '.a{background:url(file:///etc/passwd)}', /outside/],
    ['javascript: url()', '.a{background:url(javascript:alert(1))}', /outside/],
    [
      'an escaped url(',
      '.a{background:u\\72l(http://example.com/x)}',
      /outside/,
    ],
    [
      'a url with tabs inside the scheme',
      '.a{background:url("ht\ttp://example.com/x")}',
      /outside/,
    ],
    [
      'data:text/html',
      '.a{background:url(data:text/html;base64,AAAA)}',
      /data/,
    ],
    ['an absolute path', '.a{background:url(/x.png)}', /relative/],
    [
      'a path leaving the extension',
      '.a{background:url(../../x.png)}',
      /leaves/,
    ],
    ['expression()', '.a{width:expression(alert(1))}', /expression/],
    [
      'expression( with an escape',
      '.a{width:\\65xpression(alert(1))}',
      /expression/,
    ],
    ['-moz-binding', '.a{-moz-binding:url(x.xml#y)}', /-moz-binding/],
    ['src()', '@font-face{src:src("http://example.com/f")}', /src\(/],
    [
      'a string URL in image-set()',
      '.a{background:image-set("http://example.com/a.png" 1x)}',
      /image-set/,
    ],
    ['a NUL', '.a{color:red}\0', /NUL/],
  ];
  it.each(rejected)('rejects %s', (_name, text, pattern) => {
    const problem = css(text);
    expect(problem).not.toBeNull();
    expect(problem).toMatch(pattern);
  });

  it('does not let a string hide a url() from the scan', () => {
    const sneaky = `a{content:"/*"} b{background:url(http://example.com/x)} c{content:"*/"}`;
    expect(css(sneaky)).toMatch(/outside/);
  });

  it('resolves relative paths against the style sheet directory', () => {
    const inAssets = validateCss('.a{background:url(../x.png)}', {
      kind: 'css',
      path: 'assets/css/panel.css',
    });
    expect(inAssets).toBeNull();
    expect(
      validateCss('.a{background:url(../../x.png)}', {
        kind: 'css',
        path: 'assets/css/panel.css',
      }),
    ).toBeNull();
    expect(
      validateCss('.a{background:url(../../../x.png)}', {
        kind: 'css',
        path: 'assets/css/panel.css',
      }),
    ).toMatch(/leaves/);
  });
});

describe('assetProblem', () => {
  it('passes valid files of every type', () => {
    expect(assetProblem('assets/a.png', png(100))).toBeNull();
    expect(assetProblem('assets/a.jpg', jpeg(100))).toBeNull();
    expect(assetProblem('assets/a.jpeg', jpeg(100))).toBeNull();
    expect(assetProblem('assets/a.webp', webp(100))).toBeNull();
    expect(assetProblem('assets/a.woff2', woff2(100))).toBeNull();
    expect(assetProblem('assets/a.css', utf8('.a{color:red}'))).toBeNull();
    expect(assetProblem('assets/a.svg', utf8(svg('<rect/>')))).toBeNull();
  });

  it('ignores files that are not assets', () => {
    expect(assetProblem('main.mjs', utf8('anything'))).toBeNull();
    expect(assetProblem('extension.json', utf8('{'))).toBeNull();
  });

  it('rejects a mismatch between the extension and the content', () => {
    expect(assetProblem('assets/a.png', jpeg())).toContain('PNG');
    expect(assetProblem('assets/a.jpg', png())).toContain('JPEG');
    expect(assetProblem('assets/a.webp', png())).toContain('WebP');
    expect(
      assetProblem('assets/a.woff2', utf8('not a font'.repeat(10))),
    ).toContain('WOFF2');
    expect(assetProblem('assets/a.png', utf8('<svg/>'))).toContain('PNG');
    expect(assetProblem('assets/a.svg', png())).not.toBeNull();
    expect(assetProblem('assets/a.css', png())).toContain('UTF-8');
  });

  it('rejects a forged IHDR with a huge declared size', () => {
    expect(assetProblem('assets/a.png', png(60_000, 60_000))).toContain('4096');
  });

  it('rejects files over the per-type ceiling', () => {
    expect(
      assetProblem('assets/a.css', utf8(`.a{}${' '.repeat(256 * 1024)}`)),
    ).toContain('exceed');
    expect(
      assetProblem('assets/a.svg', utf8(svg(' '.repeat(64 * 1024)))),
    ).toContain('exceed');
    expect(
      assetProblem('assets/a.png', png(64, 64, { padding: 512 * 1024 })),
    ).toContain('exceed');
  });

  it('reports an invalid SVG with its reason', () => {
    expect(assetProblem('assets/a.svg', utf8(svg('<script/>')))).toContain(
      '<script>',
    );
  });
});
