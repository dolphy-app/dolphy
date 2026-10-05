import { create, nextId, text, toNodes } from './dom.ts';
import type { Child } from './dom.ts';

export interface CardOptions {
  /** Visible heading; it names the card (a `region`). */
  title: string;
  /** Heading level, 2 by default (level 1 belongs to the page). */
  level?: 2 | 3 | 4 | 5 | 6;
  children?: readonly Child[];
}

/** A surface with a heading; strings in `children` become text nodes. */
export const card = (options: CardOptions): HTMLElement => {
  const node = create('section', 'dui-card');
  const heading = text(
    `h${options.level ?? 2}` as 'h2',
    'dui-title',
    options.title,
  );
  heading.id = nextId();
  node.setAttribute('aria-labelledby', heading.id);
  node.append(heading, ...toNodes(options.children ?? []));
  return node;
};
