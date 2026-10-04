# @dolphy-app/keybindings

Framework-free core of the Dolphy keybinding registry. No DOM, no dependencies: events are described by a structural `KeyEventLike`, so the same code runs in the window, in the engine process and in extension tooling.

- **Key notation**: `Mod+Shift+L`, `Cmd+Option+Enter`, `Mod+K Mod+S` (two-step chords), physical keys `[KeyK]`. `Mod` is ⌘ on macOS and Ctrl elsewhere, strictly. `parseChord`, `chordToText` (canonical storage form), `formatChord` (`⇧⌘L` / `Ctrl+Shift+L`), `spokenChord` (words for screen readers).
- **Matching** (`matchKeystroke`, `eventToKeystroke`): an ASCII letter in `event.key` is authoritative (Dvorak, Colemak, AZERTY); otherwise the physical `event.code` decides (Russian layout, macOS dead keys, `Option+letter`); AltGr is not Ctrl+Alt; IME composition never matches.
- **When clauses**: `!`, `&&`, `||`, `==`, `!=`, parentheses. `evaluateWhen` runs a clause against a context; `whenOverlaps` tells whether two clauses can be true at the same time.
- **Keymap** (`buildKeymap`): bindings from three sources with the precedence `user` > `default` > `extension`; a user set replaces all other bindings of its command. `resolve` walks chords and returns `run`, `pending` or `none`; `conflicts` and `findCandidateConflicts` list overlapping bindings of different commands (`same` keys or a chord `prefix`).
- **Validation** (`validateBinding`, `validateUserKeybindings`, `decodeUserKeybindings`): syntax, limits, duplicates, conflicts, and the rule that a binding that types or edits text must be inactive while an input has focus.

```ts
import { buildKeymap, parseChord } from '@dolphy-app/keybindings';

const keymap = buildKeymap({
  platform: 'mac',
  defaults: [{ command: 'app:go.courses', key: 'Mod+2', when: '!inputFocus' }],
  extensions: [],
  user: {},
});

const result = keymap.resolve(
  [
    {
      key: '2',
      code: 'Digit2',
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: true,
    },
  ],
  (key) => ({ inputFocus: false })[key],
);
// { kind: 'run', binding: { command: 'app:go.courses', ... } }
```
