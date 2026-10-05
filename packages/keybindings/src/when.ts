/**
 * Условие привязки (`when`): ключ, `!ключ`, `ключ == значение`,
 * `ключ != значение`, `&&`, `||`, скобки. `!` стоит только перед ключом или
 * группой в скобках. Приоритет: `!`, затем `&&`, затем `||`.
 */
export type WhenExpr =
  | { readonly type: 'key'; readonly key: string }
  | { readonly type: 'not'; readonly expr: WhenExpr }
  | { readonly type: 'eq'; readonly key: string; readonly value: string }
  | { readonly type: 'neq'; readonly key: string; readonly value: string }
  | { readonly type: 'and'; readonly terms: readonly WhenExpr[] }
  | { readonly type: 'or'; readonly terms: readonly WhenExpr[] };

export const WHEN_MAX_LENGTH = 256;
const MAX_DEPTH = 16;
const MAX_TERMS = 64;

export type WhenReason =
  | 'empty'
  | 'too-long'
  | 'too-deep'
  | 'unexpected-token'
  | 'unexpected-end'
  | 'unterminated-string';

export class WhenSyntaxError extends Error {
  readonly reason: WhenReason;
  /** Позиция ошибки в тексте (индекс символа). */
  readonly position: number;

  constructor(reason: WhenReason, position: number) {
    super(`invalid when clause: ${reason} at ${position}`);
    this.name = 'WhenSyntaxError';
    this.reason = reason;
    this.position = position;
  }
}

type Token = {
  readonly kind: 'ident' | 'value' | 'op' | 'end';
  readonly text: string;
  readonly position: number;
};

const IDENT = /[A-Za-z_][A-Za-z0-9_.-]*/y;
const BARE = /[^\s&|()!='"]+/y;

const matchAt = (
  pattern: RegExp,
  text: string,
  index: number,
): string | null => {
  pattern.lastIndex = index;
  return pattern.exec(text)?.[0] ?? null;
};

/** После `==`/`!=` значение — слово или строка в одинарных кавычках. */
const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  let expectValue = false;
  while (index < text.length) {
    const char = text[index]!;
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    const two = text.slice(index, index + 2);
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ kind: 'op', text: two, position: index });
      expectValue = two === '==' || two === '!=';
      index += 2;
      continue;
    }
    if (char === '(' || char === ')' || char === '!') {
      tokens.push({ kind: 'op', text: char, position: index });
      expectValue = false;
      index++;
      continue;
    }
    if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close < 0) throw new WhenSyntaxError('unterminated-string', index);
      tokens.push({
        kind: 'value',
        text: text.slice(index + 1, close),
        position: index,
      });
      expectValue = false;
      index = close + 1;
      continue;
    }
    const word = matchAt(expectValue ? BARE : IDENT, text, index);
    if (word === null) throw new WhenSyntaxError('unexpected-token', index);
    tokens.push({
      kind: expectValue ? 'value' : 'ident',
      text: word,
      position: index,
    });
    expectValue = false;
    index += word.length;
  }
  tokens.push({ kind: 'end', text: '', position: text.length });
  return tokens;
};

class Parser {
  private index = 0;

  private readonly tokens: readonly Token[];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  parse(): WhenExpr {
    const result = this.parseOr(0);
    if (this.peek().kind !== 'end') this.fail();
    return result;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private isOp(text: string): boolean {
    const token = this.peek();
    return token.kind === 'op' && token.text === text;
  }

  private fail(): never {
    const token = this.peek();
    throw new WhenSyntaxError(
      token.kind === 'end' ? 'unexpected-end' : 'unexpected-token',
      token.position,
    );
  }

  private parseOr(depth: number): WhenExpr {
    if (depth > MAX_DEPTH) {
      throw new WhenSyntaxError('too-deep', this.peek().position);
    }
    const terms = [this.parseAnd(depth)];
    while (this.isOp('||')) {
      this.index++;
      terms.push(this.parseAnd(depth));
    }
    return terms.length === 1 ? terms[0]! : { type: 'or', terms };
  }

  private parseAnd(depth: number): WhenExpr {
    const terms = [this.parseUnary(depth)];
    while (this.isOp('&&')) {
      this.index++;
      terms.push(this.parseUnary(depth));
    }
    return terms.length === 1 ? terms[0]! : { type: 'and', terms };
  }

  private parseUnary(depth: number): WhenExpr {
    if (this.isOp('!')) {
      this.index++;
      if (this.isOp('(')) return { type: 'not', expr: this.parseGroup(depth) };
      const token = this.peek();
      if (token.kind !== 'ident') return this.fail();
      this.index++;
      return { type: 'not', expr: { type: 'key', key: token.text } };
    }
    if (this.isOp('(')) return this.parseGroup(depth);
    const token = this.peek();
    if (token.kind !== 'ident') return this.fail();
    this.index++;
    if (this.isOp('==') || this.isOp('!=')) {
      const operator = this.peek().text;
      this.index++;
      const value = this.peek();
      if (value.kind !== 'value') return this.fail();
      this.index++;
      return {
        type: operator === '==' ? 'eq' : 'neq',
        key: token.text,
        value: value.text,
      };
    }
    return { type: 'key', key: token.text };
  }

  private parseGroup(depth: number): WhenExpr {
    this.index++;
    const inner = this.parseOr(depth + 1);
    if (!this.isOp(')')) return this.fail();
    this.index++;
    return inner;
  }
}

/** Текст условия → выражение; ошибка — `WhenSyntaxError` с причиной и позицией. */
export const parseWhen = (text: string): WhenExpr => {
  if (text.length > WHEN_MAX_LENGTH) throw new WhenSyntaxError('too-long', 0);
  if (text.trim() === '') throw new WhenSyntaxError('empty', 0);
  return new Parser(tokenize(text)).parse();
};

/** `null` вместо ошибки. */
export const tryParseWhen = (text: string): WhenExpr | null => {
  try {
    return parseWhen(text);
  } catch (error) {
    if (error instanceof WhenSyntaxError) return null;
    throw error;
  }
};

const needsQuotes = (value: string): boolean => !/^[^\s&|()!='"]+$/.test(value);

/** Каноническая запись выражения (скобки только где нужны). */
export const whenToText = (expr: WhenExpr, parent = 0): string => {
  switch (expr.type) {
    case 'key':
      return expr.key;
    case 'not':
      return expr.expr.type === 'key'
        ? `!${expr.expr.key}`
        : `!(${whenToText(expr.expr)})`;
    case 'eq':
    case 'neq': {
      const value = needsQuotes(expr.value) ? `'${expr.value}'` : expr.value;
      return `${expr.key} ${expr.type === 'eq' ? '==' : '!='} ${value}`;
    }
    case 'and': {
      const text = expr.terms.map((term) => whenToText(term, 2)).join(' && ');
      return parent > 2 ? `(${text})` : text;
    }
    default: {
      const text = expr.terms.map((term) => whenToText(term, 1)).join(' || ');
      return parent > 1 ? `(${text})` : text;
    }
  }
};

/** Значение контекстного ключа; `undefined` — ключ не задан. */
export type ContextLookup = (key: string) => unknown;

const isTruthy = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  value !== false &&
  value !== '' &&
  value !== 0;

/**
 * Выражение истинно в контексте. `null` (нет условия) — всегда истина;
 * неизвестный ключ — ложь; сравнение — по строковому виду значения, у
 * незаданного ключа `==` ложно, а `!=` истинно.
 */
export const evaluateWhen = (
  expr: WhenExpr | null,
  lookup: ContextLookup,
): boolean => {
  if (expr === null) return true;
  switch (expr.type) {
    case 'key':
      return isTruthy(lookup(expr.key));
    case 'not':
      return !evaluateWhen(expr.expr, lookup);
    case 'eq': {
      const value = lookup(expr.key);
      return value !== undefined && String(value) === expr.value;
    }
    case 'neq': {
      const value = lookup(expr.key);
      return value === undefined || String(value) !== expr.value;
    }
    case 'and':
      return expr.terms.every((term) => evaluateWhen(term, lookup));
    default:
      return expr.terms.some((term) => evaluateWhen(term, lookup));
  }
};

type Literal =
  | { readonly kind: 'truthy'; readonly key: string }
  | { readonly kind: 'falsy'; readonly key: string }
  | { readonly kind: 'eq'; readonly key: string; readonly value: string }
  | { readonly kind: 'neq'; readonly key: string; readonly value: string };

type Term = readonly Literal[];

/** Дизъюнкция конъюнкций литералов; `null` — слишком много термов. */
const toDnf = (expr: WhenExpr, negated: boolean): Term[] | null => {
  switch (expr.type) {
    case 'key':
      return [[{ kind: negated ? 'falsy' : 'truthy', key: expr.key }]];
    case 'eq':
    case 'neq': {
      const positive = (expr.type === 'eq') !== negated;
      return [
        [{ kind: positive ? 'eq' : 'neq', key: expr.key, value: expr.value }],
      ];
    }
    case 'not':
      return toDnf(expr.expr, !negated);
    default: {
      const isConjunction = (expr.type === 'and') !== negated;
      let result: Term[] | null = isConjunction ? [[]] : [];
      for (const part of expr.terms) {
        const dnf = toDnf(part, negated);
        if (dnf === null || result === null) return null;
        const current: Term[] = result;
        result = isConjunction
          ? dnf.flatMap((right) => current.map((left) => [...left, ...right]))
          : [...current, ...dnf];
        if (result.length > MAX_TERMS) return null;
      }
      return result;
    }
  }
};

/** Значение `value`, при котором `ключ == value` истинно, обязательно истинно или ложно как условие. */
const forcedTruth = (value: string): boolean | null => {
  if (value === '') return false;
  if (value === 'false' || value === '0') return null;
  return true;
};

interface KeyState {
  truthy: boolean | null;
  eq: string | null;
  neq: Set<string>;
}

const isConsistent = (term: Term): boolean => {
  const states = new Map<string, KeyState>();
  for (const literal of term) {
    let state = states.get(literal.key);
    if (state === undefined) {
      state = { truthy: null, eq: null, neq: new Set() };
      states.set(literal.key, state);
    }
    if (literal.kind === 'truthy' || literal.kind === 'falsy') {
      const wanted = literal.kind === 'truthy';
      if (state.truthy !== null && state.truthy !== wanted) return false;
      state.truthy = wanted;
    } else if (literal.kind === 'eq') {
      if (state.eq !== null && state.eq !== literal.value) return false;
      state.eq = literal.value;
    } else {
      state.neq.add(literal.value);
    }
  }
  for (const state of states.values()) {
    if (state.eq === null) continue;
    if (state.neq.has(state.eq)) return false;
    const forced = forcedTruth(state.eq);
    if (forced !== null && state.truthy !== null && state.truthy !== forced) {
      return false;
    }
  }
  return true;
};

/**
 * Могут ли оба условия быть истинными одновременно. `null` — нет условия.
 * Сверх 64 термов в нормальной форме ответ «да» (лучше лишнее предупреждение,
 * чем молчание).
 */
export const whenOverlaps = (
  left: WhenExpr | null,
  right: WhenExpr | null,
): boolean => {
  if (left === null || right === null) return true;
  const leftDnf = toDnf(left, false);
  const rightDnf = toDnf(right, false);
  if (leftDnf === null || rightDnf === null) return true;
  return leftDnf.some((a) => rightDnf.some((b) => isConsistent([...a, ...b])));
};
