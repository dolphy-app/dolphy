import { compareSemver, parseSemver } from '@dolphy-app/extension-catalog';

/** Раздел журнала изменений: версия из заголовка `## [v]<semver>` и его текст. */
export interface ChangelogSection {
  version: string;
  /** Заголовок как написал автор (без `## `): `[1.2.0] - 2026-10-01`. */
  title: string;
  /** Текст раздела до следующего заголовка второго уровня. */
  body: string;
}

// `## 1.2.0`, `## v1.2.0`, `## [1.2.0] - 2026-10-01`, `## [1.2.0](url) (2026-10-01)`
const HEADING =
  /^ {0,3}##[ \t]+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?![0-9A-Za-z.])(.*)$/;
const ANY_H2 = /^ {0,3}##(?:[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Все разделы с версией в заголовке, в порядке файла; повтор версии не учитывается. Заголовки внутри блоков кода не считаются. */
const sectionsOf = (markdown: string): ChangelogSection[] => {
  const sections: ChangelogSection[] = [];
  const seen = new Set<string>();
  let current = null as {
    version: string;
    title: string;
    lines: string[];
  } | null;
  let fence: string | null = null;

  const close = () => {
    if (current === null) return;
    sections.push({
      version: current.version,
      title: current.title,
      body: current.lines.join('\n').trim(),
    });
    current = null;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
    }
    if (fence === null && marker === undefined && ANY_H2.test(line)) {
      close();
      const match = HEADING.exec(line);
      const version = match?.[1];
      if (version !== undefined && !seen.has(version)) {
        seen.add(version);
        current = {
          version,
          title: line.replace(/^ {0,3}##[ \t]+/, '').trimEnd(),
          lines: [],
        };
      }
      continue;
    }
    current?.lines.push(line);
  }
  close();
  return sections;
};

/**
 * Разделы журнала для обновления `from` → `to`: версии новее `from` и не новее
 * `to`, новые сверху. Версия не semver — разделов нет.
 */
export const changelogBetween = (
  markdown: string,
  from: string,
  to: string,
): ChangelogSection[] => {
  if (parseSemver(from) === null || parseSemver(to) === null) return [];
  return sectionsOf(markdown)
    .filter(
      ({ version }) =>
        compareSemver(version, from) > 0 && compareSemver(version, to) <= 0,
    )
    .sort((a, b) => compareSemver(b.version, a.version));
};
