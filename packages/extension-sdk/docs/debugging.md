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

`dolphy-ext dev` builds the project in watch mode and starts the installed
Dolphy app on the result:

```sh
pnpm exec dolphy-ext dev            # the project in the current directory
pnpm exec dolphy-ext dev ../my-ext  # another project
```

It prints the path of the app it started and the directory it passes to it
(`DOLPHY_DEV_EXTENSIONS=<project>/dist-ext`). Press Ctrl+C to stop the build and
the app; the exit code is 0. The app is looked up in this order:

1. `--app <path>`: a macOS `.app` bundle or an executable file.
2. The `DOLPHY_APP` environment variable (same kind of path).
3. The standard place of your system: macOS `/Applications/Dolphy.app`, then
   `~/Applications/Dolphy.app`; Windows
   `%LOCALAPPDATA%\Programs\Dolphy\Dolphy.exe`; Linux the newest
   `~/Applications/Dolphy-Linux-*.AppImage` (Linux has no fixed place: keep the
   AppImage there or use `--app`).

When none exists the command exits with code 2 and lists the places it looked
at. A path given with `--app` or `DOLPHY_APP` that does not exist is an error as
well, not a silent fallback.

If you prefer to run the two parts yourself, start `pnpm dev`
(`dolphy-ext build --watch`) and start Dolphy with
`DOLPHY_DEV_EXTENSIONS=<project>/dist-ext`; from a checkout of the Dolphy
repository that is `DOLPHY_DEV_EXTENSIONS=<project>/dist-ext pnpm dev`. The app
rereads the extensions on every file change and applies the change live. Things
to know:

- The app has one instance. If Dolphy is already running, a second start exits
  at once and the variable is lost. `dolphy-ext dev` notices an app that quits
  within 5 seconds and prints "Dolphy is probably already running: quit it and
  run again" (exit code 1): quit the running app and start again.
- The extension appears in Settings → Extensions with the origin
  "Development". A manifest or load problem is shown there next to the
  extension instead of the extension working: start with that text.
- If the id is also in the bundled set or installed from the catalog, the
  development copy wins.
- Answer inputs of extensions in development are recreated on a change, so
  their state can be lost.

## 4. DevTools

While `DOLPHY_DEV_EXTENSIONS` is set (so under `dolphy-ext dev` too), in any
build of the app, including an installed one, these keys toggle the DevTools of
the main window: `F12`, `Cmd+Alt+I` (macOS) and `Ctrl+Shift+I`. Without the
variable the keys do nothing and an installed app has no DevTools.

- Views, panels and markdown blocks of an extension run in frames with the
  address `dolphy-ext://<id>/__dolphy/frame.html`. In the console, pick that
  frame in the context drop-down (the one that says "top") to evaluate code in
  your view; in "Elements" the frame is an `<iframe>` with that address.
- `dolphy-ext dev` and `dolphy-ext build --watch` put an inline source map
  (`//# sourceMappingURL=data:application/json…`) into every bundle, so
  "Sources" shows your TypeScript (`src/index.ts` and the files it imports) for
  views, panels and renderers: set a breakpoint there, `debugger;` works too.
  A plain `dolphy-ext build` (`pnpm build`) and the catalog build never write
  source maps, and the catalog check rejects a submission that has one.
- The code that runs in the extension process (`main.mjs`: commands, events,
  `activate`) is not in this window: see section 7 and the log.

## 5. The log

`ctx.logger` has `debug`, `info`, `warn` and `error`; each takes an object of
fields and an optional message:

```text
ctx.logger.info({ id: change.id, value: change.value }, 'setting changed');
```

The output goes to the log of the app, not to a console of the window. Log
structured fields, not secrets or the learner's answers. The host writes to the
same log: an exception in a handler, a handler that outlives its time limit, an
event dropped from a full queue, and a warning after activation about an id the
manifest declares but the code did not register.

### Reading the log in the app

1. Open Settings → Extensions. In the "Diagnostics" block press "Log" to see
   everything, or press "Log" in the row of your extension to see only its
   entries (the dialog opens with the id of the extension in the filter).
2. The dialog lists the last 500 entries, the newest at the bottom. Each entry
   shows the time, the level, the source (`main`, `engine` or `ext-host`), the
   id of the extension that wrote it and the message. "Details" opens the other
   fields of the entry as JSON.
3. Filter by extension: type or pick an id in "Extension" (an id that is not in
   the list is accepted). Filter by level: "Minimum level" hides entries below
   it; the default, "Debug", shows all of them.
4. The dialog does not update by itself: press "Refresh" after you triggered
   the code you are watching. "No entries match the filters." means the filters
   hide everything, or nothing was logged yet.

The labels the dialog shows, with the keys of the app's messages (ru and en):

| Where                      | English                          | Русский                       | Message key                                |
| -------------------------- | -------------------------------- | ----------------------------- | ------------------------------------------ |
| Settings section           | Extensions                       | Расширения                    | `settings.extensions.title`                |
| Origin of a dev extension  | Development                      | Разработка                    | `settings.extensions.origin.dev`           |
| Trust switch               | Trust (no isolation)             | Доверять (без изоляции)       | `settings.extensions.trustLabel`           |
| Block with the log button  | Diagnostics                      | Диагностика                   | `settings.extensions.support.title`        |
| Button of the block        | Log                              | Журнал                        | `settings.extensions.support.openLog`      |
| Action in an extension row | Log                              | Журнал                        | `settings.extensions.log.rowAction`        |
| Dialog title               | Log                              | Журнал                        | `settings.extensions.log.title`            |
| Extension filter           | Extension                        | Расширение                    | `settings.extensions.log.filterExtension`  |
| Extension filter, empty    | All extensions                   | Все расширения                | `settings.extensions.log.filterExtensionHint` |
| Level filter               | Minimum level                    | Минимальный уровень           | `settings.extensions.log.filterLevel`      |
| Level                      | Debug                            | Отладка                       | `settings.extensions.log.level.debug`      |
| Level                      | Info                             | Инфо                          | `settings.extensions.log.level.info`       |
| Level                      | Warning                          | Предупреждение                | `settings.extensions.log.level.warn`       |
| Level                      | Error                            | Ошибка                        | `settings.extensions.log.level.error`      |
| Other fields of an entry   | Details                          | Подробности                   | `settings.extensions.log.details`          |
| Reread the log             | Refresh                          | Обновить                      | `settings.extensions.log.refresh`          |
| Filters match nothing      | No entries match the filters.    | Нет записей, подходящих под условия. | `settings.extensions.log.empty`     |

### Output of the restricted process

An extension that is not trusted runs in a restricted process (section 6). What
it prints with `console.log`, `console.error` or an uncaught error goes to the
log as `warn` entries with the extension id and `stream` (`stdout` or `stderr`)
in "Details". Use `ctx.logger` for anything you want to filter by level; use
`console` only for a quick look. The output is limited so that one extension
cannot flood the log: at most 64 KiB in 60 seconds per extension; the rest is
dropped and one entry "output truncated" with `droppedBytes` closes the window.
A process that sends a message larger than 1 MiB or more than 200 messages in
a second is stopped, with an `error` entry whose reason is `ipc-size` or
`ipc-rate`.

### The file

The entries are also in `logs/dolphy-YYYY-MM-DD.log` in the app's data folder,
one JSON object per line (`level`, `source`, `message`, `at` and the other
fields). A new file starts every day and at 2 MiB; files older than 7 days are
removed, and the oldest go first while the folder is over 10 MiB. Attach the
relevant lines, or the text of "Copy diagnostics" in the "Diagnostics" block (it
has no paths of your home folder, library content or learning data), to a bug
report.

## 6. Permissions and the restricted process

An extension that is not bundled with the app and not trusted runs in a
restricted process, and what its `permissions` do not declare is unavailable:
`ctx.library` throws `PermissionError` without `library.read`; spawning a
process, a worker thread or a native module fails with `ERR_ACCESS_DENIED`.
Test helpers do not reproduce this, so a feature that needs a permission must be
tried in the app. Extensions in development get the permissions their manifest
declares. To debug without the restrictions, turn on "Trust (no isolation)" for
the extension in Settings → Extensions; turn it off again before you release,
because your users will not have it on.

## 7. Reading a stack trace

The code of the extension process is `dist-ext/<id>/main.mjs`, readable and not
minified. A watch build (`dolphy-ext dev`, `dolphy-ext build --watch`) appends
an inline source map to it, but the app does not turn on source maps for that
process, so a stack trace in the log still points to lines of `main.mjs`: open
that file to find the place and search it for the name from the trace. The
map is for the browser files of section 4. A plain `dolphy-ext build` writes no
maps at all.

## Which limit did I hit?

| Symptom                                         | Limit                                                    |
| ----------------------------------------------- | -------------------------------------------------------- |
| activation fails with `activation-timeout`      | `activate` must finish in 10 seconds                     |
| an event handler stops mid-way                  | 2 seconds per event; the queue holds 100 events          |
| `StorageQuotaError`                             | key 128 characters, value 64 KiB, 256 keys, 1 MiB total  |
| a command result is rejected                    | `notify` text 1–500 characters; a result up to 64 KiB    |
| a panel cannot load an image or open a socket   | the frame loads only from its own extension, no network  |
