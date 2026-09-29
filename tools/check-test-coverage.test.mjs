import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkCoverage,
  collectFromSource,
  extractDocIds,
} from './check-test-coverage.mjs';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-test-coverage.mjs',
);

const DOC = `# Doc
## 6. Other
| T-90 | вне раздела 7 |
## 7. Tests
| № | Что |
| T-01 | a |
### 7.1 F
| T-02 | b |
| T-03 | c |
### 7.2 matrix
| F-01 | not a test id |
## 8. Next
| T-91 | вне раздела 7 |
`;

const ids = (source) => [...collectFromSource(source).ids.keys()].sort();

describe('extractDocIds', () => {
  it('takes rows of section 7 only, in order', () => {
    assert.deepEqual(extractDocIds(DOC), ['T-01', 'T-02', 'T-03']);
  });
});

describe('collectFromSource', () => {
  it('counts active describe/it/test names, incl. each and templates', () => {
    const source = `
      describe('suite (T-01)', () => { it('x', () => {}); });
      it('T-02 a', () => {});
      test.each([1])('T-03 case %s', () => {});
      it.each([1])(\`T-04 \${'x'}\`, () => {});
      describe.each([1])('T-05 %s', () => { it('y', () => {}); });
      it('T-06', { timeout: 5 }, () => {});
      it.concurrent('T-07', async () => {});
    `;
    assert.deepEqual(ids(source), [
      'T-01',
      'T-02',
      'T-03',
      'T-04',
      'T-05',
      'T-06',
      'T-07',
    ]);
  });

  it('ignores comments and string values that are not test names', () => {
    const source = `
      // T-01 in a comment
      /** T-02 in a doc comment */
      const label = 'T-03';
      it('plain', () => { expect(label).toBe('T-04'); });
    `;
    assert.deepEqual(ids(source), []);
  });

  it('does not count skip, todo, fails or anything under a skipped suite', () => {
    const source = `
      it.skip('T-01', () => {});
      test.skip('T-02', () => {});
      it.todo('T-03');
      it.fails('T-04', () => {});
      describe.skip('T-05', () => { it('inner', () => {}); });
      describe.skip('outer', () => { it('T-06', () => {}); describe('T-07', () => { it('x', () => {}); }); });
      describe.skip.each([1])('T-08 %s', () => { it('x', () => {}); });
      it.skip.each([1])('T-09 %s', () => {});
    `;
    assert.deepEqual(ids(source), []);
  });

  it('does not count a suite that has no active test inside', () => {
    const source = `
      describe('T-01', () => { it.skip('a', () => {}); it.todo('b'); });
      describe('T-02', () => {});
      describe('T-03', () => { it('active', () => {}); });
    `;
    assert.deepEqual(ids(source), ['T-03']);
  });

  it('marks skipIf/runIf as conditional and keeps them active', () => {
    const { ids: found } = collectFromSource(`
      it.skipIf(process.platform === 'win32')('T-01', () => {});
      it.runIf(true)('T-02', () => {});
      it('T-02 again', () => {});
    `);
    assert.deepEqual(found.get('T-01'), { conditional: true });
    assert.deepEqual(found.get('T-02'), { conditional: false });
  });

  it('does not treat unrelated calls named like tests as tests', () => {
    const source = `
      bench('T-01', () => {});
      helper('T-02', () => {});
      obj.it('T-03', () => {});
      it('no body T-04');
    `;
    assert.deepEqual(ids(source), []);
  });
});

describe('checkCoverage and CLI', () => {
  const roots = [];
  const makeRoot = (files) => {
    const root = mkdtempSync(join(tmpdir(), 'check-tests-'));
    roots.push(root);
    mkdirSync(join(root, 'engine-ts/design'), { recursive: true });
    writeFileSync(join(root, 'engine-ts/design/engine-ts-testing.md'), DOC);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  };
  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const run = (root) => {
    try {
      const stdout = execFileSync('node', [SCRIPT, '--root', root], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout, stderr: '' };
    } catch (error) {
      return { code: error.status, stdout: error.stdout, stderr: error.stderr };
    }
  };

  const FULL = {
    'packages/a/test/a.test.ts': "it('T-01', () => {}); it('T-02', () => {});",
    'apps/b/test/b.test.ts': "describe('T-03', () => { it('x', () => {}); });",
    'packages/a/test/bench/c.bench.ts': "test('T-03 bench', () => {});",
  };

  it('exits 0 when every number has an active test', () => {
    const result = run(makeRoot(FULL));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /3\/3/);
  });

  it('exits 1 and lists the numbers whose label was removed or skipped', () => {
    const root = makeRoot({
      'packages/a/test/a.test.ts':
        "it('plain', () => {}); it.skip('T-02', () => {}); // T-01",
      'apps/b/test/b.test.ts': "it('T-03', () => {});",
    });
    const result = run(root);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /1\/3/);
    assert.match(result.stderr, /T-01, T-02/);
  });

  it('ignores files under node_modules and fixtures', () => {
    const root = makeRoot({
      ...FULL,
      'packages/a/test/fixtures/x.test.ts': "it('T-90', () => {});",
    });
    const { unknown } = checkCoverage({ root });
    assert.deepEqual(unknown, []);
  });

  it('exits 1 when the document has no numbers at all', () => {
    const root = makeRoot(FULL);
    writeFileSync(join(root, 'engine-ts/design/engine-ts-testing.md'), '# x');
    assert.equal(run(root).code, 1);
  });
});
