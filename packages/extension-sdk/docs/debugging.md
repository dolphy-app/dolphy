# Debugging

Where to look when an extension does not do what you expect, from the cheapest
check to the running app. Commands are those of a generated project; see the
[quick start](quick-start.md).

## 1. Reproduce it in a test

`createTestServer` and `createTestClient` of `@dolphy-app/extension-sdk/testing`
run your entries in plain Node, with a debugger and `console.log` available.
Most mistakes (a wrong result shape, a setting read before it is set, a handler
that throws, an id without the extension prefix) show up there.

- `createTestServer(server, { extensionId, logger })` takes a `logger` option:
  pass an object with `debug`, `info`, `warn` and `error` methods to see what
  `server.logger` receives.
- With `extensionId` set the harness checks that every id you register is the
  extension id or starts with `<id>.`, the way the host does. It also checks what
  the host checks about a result: the shape of a verdict, a grade of 1–5 or
  `null`, a command result (`notify` text of 1–500 characters, a JSON value of
  at most 64 KiB), an importer's or exporter's result. A message from the harness
  usually names the rule.
- An error in `server` fails `createTestServer` itself, as it fails the load in
  the app: nothing is registered. A handler's failure is not swallowed but
  rejects the promise.
- The harness does not count the host's time limits, so a test that passes does
  not prove a handler is fast enough: an event handler gets 2 seconds, a command
  or a schedule handler 10, an importer or an exporter 30, and the registration
  (`server`) 10.

## 2. Run the checks

```sh
pnpm typecheck   # tsc
pnpm validate    # the manifest the way the app parses it
pnpm lint        # metadata and bundle findings the catalog review also sees
```

`pnpm validate` parses the built manifest with the same code as the app and
exits with code 1 on a problem; a key the manifest does not have (a command, a
setting, a panel written into `extension.json`) is one: the manifest holds the
identity of the extension, and the code registers everything else. The build
also fails when `server` imports `vue`, `vuetify` or a component, or `client`
imports a `node:*` module, and names the file.
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
rereads the extensions on every file change and applies the change live: the
extension host runs `server` again and the window loads `client.mjs` again, and
the window itself does not reload. Things to know:

- The app has one instance. If Dolphy is already running, a second start exits
  at once and the variable is lost. `dolphy-ext dev` notices an app that quits
  within 5 seconds and prints "Dolphy is probably already running: quit it and
  run again" (exit code 1): quit the running app and start again.
- The extension appears in Settings → Extensions with the origin
  "Development". A manifest or load problem is shown there next to the
  extension instead of the extension working: start with that text.
- If the id is also in the bundled set or installed from the catalog, the
  development copy wins.
- The components of extensions in development are redrawn on a change, so their
  state can be lost.

### `load-failed`

When `server` throws, registers something invalid (an id that is taken or does
not carry the extension prefix, a bad `when`, an invalid setting definition), or
does not finish in 10 seconds, the extension host registers
nothing from it. Registration is all or nothing: the commands, settings and
event handlers `server` managed to add before the failure are removed too. The
extension row in Settings → Extensions shows the diagnostic "Could not load the
extension: {reason}" with the message of the error, and the log has the entry
`extension registration failed` with the cause (`activation-failed`, or
`activation-timeout` for the 10 seconds). `server` is called once per load, so
do slow work (a network request, a big file) in a handler and not in `server`
itself.

The client part has its own failure. When `client.mjs` does not import, `client`
throws, or a registration is refused (an id that is taken, a bad injection
target), the window shows "The extension client part failed to load" on the
extension and keeps no contribution of the client part; the other extensions
and the server part of this one keep working. The reason is in the DevTools
console of section 4. After you fix the file, the next rebuild loads it again.

## 4. DevTools

While `DOLPHY_DEV_EXTENSIONS` is set (so under `dolphy-ext dev` too), in any
build of the app, including an installed one, these keys toggle the DevTools of
the main window: `F12`, `Cmd+Alt+I` (macOS) and `Ctrl+Shift+I`. Without the
variable the keys do nothing and an installed app has no DevTools.

- Panels, injected components, answer views and markdown blocks of an extension
  are Vue components in the page of the app window itself. "Elements" shows
  their markup in the page and the Vue DevTools show the component tree; the
  console evaluates in the same page as the app and shows what the client part
  and its components print with `console`.
- `dolphy-ext dev` and `dolphy-ext build --watch` put an inline source map
  (`//# sourceMappingURL=data:application/json…`) into every bundle, so
  "Sources" shows your TypeScript (`src/client.ts` and the files it imports)
  for the client part: set a breakpoint there, `debugger;` works too. A plain
  `dolphy-ext build` (`pnpm build`) and the catalog build never write source
  maps, and the catalog check rejects a submission that has one.
- The code that runs in the extension host (`main.mjs`: `server`, command and
  event handlers, schedules, importers and exporters) is not in this window: see
  section 6 and the log.

## 5. The log

`server.logger` has `debug`, `info`, `warn` and `error`; each takes an object of
fields and an optional message:

```text
s.logger.info({ id: change.id, value: change.value }, 'setting changed');
```

The output goes to the log of the app, not to a console of the window. Log
structured fields, not secrets or the learner's answers. The host writes to the
same log: an exception in a handler, a handler that outlives its time limit, an
event dropped from a full queue, and the failure of a registration. The client
part has no logger: use `console` and the DevTools.

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
| Load failure of the client part | The extension client part failed to load | Клиентская часть расширения не загрузилась | `settings.extensions.clientFailed.title` |
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

### Output of the extension host

What `server` and its handlers print with `console.log`, `console.error` or an
uncaught error goes to the log as `warn` entries of the extension host in
"Details". Use `s.logger` for anything you want to filter by level (its entries
carry the extension id); use `console` only for a quick look.

### The file

The entries are also in `logs/dolphy-YYYY-MM-DD.log` in the app's data folder,
one JSON object per line (`level`, `source`, `message`, `at` and the other
fields). A new file starts every day and at 2 MiB; files older than 7 days are
removed, and the oldest go first while the folder is over 10 MiB. Attach the
relevant lines, or the text of "Copy diagnostics" in the "Diagnostics" block (it
has no paths of your home folder, library content or learning data), to a bug
report.

## 6. Reading a stack trace

The code of the extension host is `dist-ext/<id>/main.mjs`, readable and not
minified. A watch build (`dolphy-ext dev`, `dolphy-ext build --watch`) appends
an inline source map to it, but the app does not turn on source maps for that
process, so a stack trace in the log still points to lines of `main.mjs`: open
that file to find the place and search it for the name from the trace. The
map is for the browser file of section 4. A plain `dolphy-ext build` writes no
maps at all.

## Which limit did I hit?

| Symptom                                         | Limit                                                    |
| ----------------------------------------------- | -------------------------------------------------------- |
| the extension shows `load-failed` with a timeout | `server` must finish in 10 seconds                       |
| an event handler stops mid-way                  | 2 seconds per event; the queue holds 100 events          |
| a command or a schedule handler stops mid-way   | 10 seconds                                               |
| an importer or an exporter stops mid-way        | 30 seconds                                               |
| `StorageQuotaError`                             | key 128 characters, value 64 KiB, 256 keys, 1 MiB total  |
| a command result is rejected                    | `notify` text 1–500 characters; a result up to 64 KiB    |
| a panel or a view fails while it draws          | the card "Retry" replaces it; the window stays up        |
