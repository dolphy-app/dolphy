# Debugging

Where to look when an extension does not do what you expect, from the cheapest
check to the running app. Commands are those of a generated project; see the
[quick start](quick-start.md).

## 1. Reproduce it in a test

The helpers of `@dolphy-app/extension-sdk/testing` run your handlers in plain
Node, with a debugger and `console.log` available. Most mistakes (wrong result
shape, a setting read before it is set, a handler that throws) show up there.

- `loadCommands`, `loadEvents`, `loadExerciseType` and `loadGradePolicy` take a
  `logger` option: pass an object with `debug`, `info`, `warn` and `error`
  methods to see what `ctx.logger` receives.
- The helpers check what the host checks: the shape of a verdict, a grade of
  1–5 or `null`, a command result (`notify` text of 1–500 characters, a JSON
  value of at most 64 KiB), a declared id. A message from a helper usually names
  the rule.
- They do not swallow a handler's failure and do not count the host's time
  limits, so a test that passes does not prove a handler is fast enough: an
  event handler gets 2 seconds, `activate` gets 10.
- They do not restrict permissions (see section 5).

## 2. Run the checks

```sh
pnpm typecheck   # ids against extension.json: a misspelt or missing id
pnpm validate    # the manifest the way the app parses it
pnpm lint        # metadata and bundle findings the catalog review also sees
```

`pnpm validate` parses the built manifest with the same code as the app and
exits with code 1 on a problem.
`pnpm lint` prints `warning <id> <RULE> <field>: <message>` lines; a rule that
looks wrong for your code (for example `eval` in a bundled dependency) is a hint
for the reviewer, not a failure.

## 3. The app: development loop

`pnpm dev` (`dolphy-ext build --watch`) keeps `dist-ext` fresh. Start Dolphy
with `DOLPHY_DEV_EXTENSIONS=<project>/dist-ext`; the app rereads the extensions
on every file change and applies the change live. Things to know:

- The app has one instance. If Dolphy is already running, a second start exits
  without reading the variable: quit it first.
- The extension appears in Settings → Extensions with the origin
  "Development". A manifest or load problem is shown there next to the
  extension instead of the extension working: start with that text.
- If the id is also in the bundled set or installed from the catalog, the
  development copy wins.
- Answer inputs of extensions in development are recreated on a change, so
  their state can be lost.

## 4. The log

`ctx.logger` has `debug`, `info`, `warn` and `error`; each takes an object of
fields and an optional message:

```text
ctx.logger.info({ id: change.id, value: change.value }, 'setting changed');
```

The output goes to the log of the app's engine, not to a console of the window.
Log structured fields, not secrets or the learner's answers. The host writes to
the same log: an exception in a handler, a handler that outlives its time limit,
an event dropped from a full queue, and a warning after activation about an id
the manifest declares but the code did not register.

## 5. Permissions and the restricted process

An extension that is not bundled with the app and not trusted runs in a
restricted process, and what its `permissions` do not declare is unavailable:
`ctx.library` throws `PermissionError` without `library.read`; spawning a
process, a worker thread or a native module fails with `ERR_ACCESS_DENIED`.
Test helpers do not reproduce this, so a feature that needs a permission must be
tried in the app. Extensions in development get the permissions their manifest
declares. To debug without the restrictions, turn on "Trust (no isolation)" for
the extension in Settings → Extensions; turn it off again before you release,
because your users will not have it on.

## 6. Reading a stack trace

`dolphy-ext build` does not minify and does not write source maps, so
`dist-ext/<id>/main.mjs` is readable code. A stack trace of the extension
process points to lines of `main.mjs`: open that file to find the place, and
search it for the name from the trace.

## Which limit did I hit?

| Symptom                                         | Limit                                                    |
| ----------------------------------------------- | -------------------------------------------------------- |
| activation fails with `activation-timeout`      | `activate` must finish in 10 seconds                     |
| an event handler stops mid-way                  | 2 seconds per event; the queue holds 100 events          |
| `StorageQuotaError`                             | key 128 characters, value 64 KiB, 256 keys, 1 MiB total  |
| a command result is rejected                    | `notify` text 1–500 characters; a result up to 64 KiB    |
| a panel cannot load an image or open a socket   | the frame loads only from its own extension, no network  |
