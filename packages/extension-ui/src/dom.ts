import { ensureStyles } from './style.ts';

export type Child = Node | string;

let counter = 0;

/** A document-unique id for the `for`/`aria-labelledby`/`aria-describedby` links of one element. */
export const nextId = (): string => {
  counter += 1;
  return `dui-${counter}`;
};

/** Creates an element with the given classes; the stylesheet is inserted on first use. */
export const create = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] => {
  ensureStyles(document);
  const node = document.createElement(tag);
  node.className = `dui ${className}`;
  return node;
};

/** Text is always set as `textContent`: the kit never parses markup. */
export const text = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content: string,
): HTMLElementTagNameMap[K] => {
  const node = create(tag, className);
  node.textContent = content;
  return node;
};

export const toNodes = (children: readonly Child[]): Node[] =>
  children.map((child) =>
    typeof child === 'string' ? document.createTextNode(child) : child,
  );
