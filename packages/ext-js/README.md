# @dolphy-app/ext-js

The built-in `dolphy.js` extension: JavaScript exercises checked by running the
learner's code against tests written by the course author.

## Answer field

The answer field is a plain `textarea` under a highlighted copy of the same text
(JavaScript, by `sugar-high`). Typing, selection and the caret are the browser's
own. The colors are the `--sh-*` variables that the app publishes on the document
root from the current theme, so the field follows built-in and extension
themes. In forced-colors mode the highlight layer is hidden.

## How it works

Each check runs in a fresh child process started in Node's permission mode with
no grants (it can only read its own worker file). The learner's code and the
tests run in one clean `node:vm` context. The parent kills the process at
`timeoutMs` (2000 ms by default), so infinite loops and hanging promises end
as `failed/timeout`. The answer is a string with the source code (at most
20000 characters).

## Exercise spec

| Field            | Required | Meaning                                                         |
| ---------------- | -------- | --------------------------------------------------------------- |
| `tests`          | yes      | Test code, see below.                                           |
| `reference`      | no       | Reference solution; `engine-cli validate --run-checks` runs it. |
| `starter`        | no       | Text the answer field starts with.                              |
| `maxOutputChars` | no       | Limit for the learner's `console.log` output (default 10000).   |

`tests` and `reference` are never sent to the window; the view receives only
`{ starter }`.

## Test DSL

`tests` is a function body with four parameters: `test(name, fn)`, `assert`
(`node:assert/strict`), `logs` (lines the learner's code printed with
`console.log`) and `sleep(ms)`. Functions defined by the learner are plain
globals.

```yaml
engine:
  exercise:
    type: dolphy.js
    spec:
      starter: |
        function double(n) {}
      tests: |
        test('doubles', () => assert.equal(double(2), 4));
        test('async', async () => {
          await sleep(5);
          assert.equal(double(0), 0);
        });
      reference: |
        function double(n) { return n * 2; }
```

## Results

`passed`; `failed` with reason `tests_failed`, `syntax_error`, `runtime_error`,
`timeout`, `output_limit` or `too_long`; `error` for author or infrastructure
faults (`tests_invalid`, `spec_invalid`, `worker_crash`).
