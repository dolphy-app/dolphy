import { formatChord, spokenChord } from '@dolphy-app/keybindings';
import type { Chord, Platform, SpokenId } from '@dolphy-app/keybindings';

/** Сочетание для интерфейса: подпись клавишами и озвучивание словами для скринридера. */
export interface ChordText {
  /** Подпись платформы (`⌘K`, `Ctrl+K`, цепочка — через пробел). */
  keys: string;
  /** По одной подписи на нажатие: цепочка выводится двумя `kbd`. */
  strokes: string[];
  /** `⌘K` скринридер читает набором символов: озвучивание словами. */
  spoken: string;
}

export const describeChord = (
  chord: Chord,
  platform: Platform,
  word: (id: SpokenId) => string,
): ChordText => ({
  keys: formatChord(chord, platform),
  strokes: chord.map((stroke) => formatChord([stroke], platform)),
  spoken: spokenChord(chord, platform, word),
});
