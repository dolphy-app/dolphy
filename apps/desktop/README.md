# Dolphy desktop

The [Dolphy](../../README.md) app: Electron, Vue 3 and Vuetify on the surface, the learning engine in a separate `utilityProcess`, progress in a local SQLite file.

```sh
pnpm install
pnpm dev:seed   # copy the sample courses into the library
pnpm dev        # start the app
```

|                               |                                               |
| ----------------------------- | --------------------------------------------- |
| `pnpm build`                  | type-check, bundle and package the app        |
| `pnpm smoke`                  | end-to-end smoke test in a real Electron      |
| `pnpm -F @dolphy/desktop e2e` | learner-level scenarios in a real Electron    |
| `pnpm screenshots`            | regenerate the screenshots used in the README |

How the app is put together (processes, layers, extensions, security, tests): [ARCHITECTURE.md](ARCHITECTURE.md).

Released under the [MIT License](LICENSE).
