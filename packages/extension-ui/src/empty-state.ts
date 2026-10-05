import { create, nextId, text } from './dom.ts';

export interface EmptyStateOptions {
  /** Visible heading; it names the group. */
  title: string;
  description?: string;
  /** An element offering the next step, usually a `button()`. */
  action?: HTMLElement;
  /** Heading level, 3 by default. */
  level?: 2 | 3 | 4 | 5 | 6;
}

/** A placeholder for a view that has nothing to show yet. */
export const emptyState = (options: EmptyStateOptions): HTMLElement => {
  const node = create('div', 'dui-empty');
  node.setAttribute('role', 'group');
  const heading = text(
    `h${options.level ?? 3}` as 'h3',
    'dui-title',
    options.title,
  );
  heading.id = nextId();
  node.setAttribute('aria-labelledby', heading.id);
  node.append(heading);
  if (options.description !== undefined) {
    node.append(text('p', 'dui-text', options.description));
  }
  if (options.action !== undefined) node.append(options.action);
  return node;
};
