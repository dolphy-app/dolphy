/**
 * Visibility conditions (`when`) of commands, panels and widgets. A condition
 * is a small boolean expression over a closed set of typed keys of the app
 * window (`WHEN_KEYS`). The functions are pure: the manifest check, the app
 * window and `dolphy-ext validate` share them, and so can any dispatcher that
 * can supply a `WhenContext`.
 *
 * Grammar (`!` binds tightest, then `&&`, then `||`):
 *
 * ```
 * expr    := term ('||' term)*
 * term    := factor ('&&' factor)*
 * factor  := '!' factor | '(' expr ')' | 'true' | 'false' | boolean-key | comparison
 * comparison := key ('==' | '!=') literal | key 'in' '(' literal (',' literal)* ')'
 * literal := 'text' | true | false
 * ```
 *
 * `!` stands before a boolean key, a group or another `!`; negate a
 * comparison with a group (`!(route == 'courses')`) or use `!=`.
 */

/** Names of the screens `route` can have: the route names of the app window. */
export const WHEN_ROUTES = [
  'daily-plan',
  'courses',
  'extension-panel',
  'placement',
  'session',
  'settings',
  'settings-learning',
  'settings-library',
  'settings-appearance',
  'settings-shortcuts',
  'settings-extensions',
  'settings-extension-details',
  'settings-about',
] as const;
export type WhenRoute = (typeof WHEN_ROUTES)[number];

/** Interface languages a `locale` condition can name. */
export const WHEN_LOCALES = ['ru', 'en'] as const;

/** Type of a key: a boolean, or a text from a closed list. */
export type WhenKeyType =
  | { readonly type: 'boolean' }
  | { readonly type: 'string'; readonly values: readonly string[] };

/**
 * Closed set of keys with their types.
 *
 * - `route`: the screen shown (a value of `WHEN_ROUTES`).
 * - `course.active`: a course is in focus (the course switcher is not on "all courses").
 * - `session.active`: the learning session screen is open.
 * - `locale`: the interface language after resolving the "system" mode.
 * - `theme.dark`: the current theme is dark.
 */
export const WHEN_KEYS = Object.freeze({
  route: { type: 'string', values: WHEN_ROUTES },
  'course.active': { type: 'boolean' },
  'session.active': { type: 'boolean' },
  locale: { type: 'string', values: WHEN_LOCALES },
  'theme.dark': { type: 'boolean' },
} satisfies Record<string, WhenKeyType>);
export type WhenKey = keyof typeof WHEN_KEYS;

/** Longest condition, in characters. */
export const WHEN_MAX_LENGTH = 200;

/** Values of the keys at one moment. A key may be a getter: only the keys a condition reads are read. */
export interface WhenContext {
  /** Name of the current route; `''` before the first navigation settles. */
  readonly route: string;
  readonly 'course.active': boolean;
  readonly 'session.active': boolean;
  /** `ru` or `en`. */
  readonly locale: string;
  readonly 'theme.dark': boolean;
}

export type WhenLiteral = string | boolean;

export type WhenExpr =
  | { readonly type: 'literal'; readonly value: boolean }
  | { readonly type: 'key'; readonly key: WhenKey }
  | { readonly type: 'not'; readonly expr: WhenExpr }
  | {
      readonly type: 'compare';
      readonly key: WhenKey;
      readonly op: '==' | '!=';
      readonly value: WhenLiteral;
    }
  | {
      readonly type: 'in';
      readonly key: WhenKey;
      readonly values: readonly WhenLiteral[];
    }
  | { readonly type: 'and'; readonly terms: readonly WhenExpr[] }
  | { readonly type: 'or'; readonly terms: readonly WhenExpr[] };

export type WhenReason =
  | 'empty'
  | 'too-long'
  | 'unexpected-character'
  | 'unexpected-token'
  | 'unexpected-end'
  | 'unterminated-string'
  | 'unknown-key'
  | 'unknown-value'
  | 'type-mismatch';

/** A condition that does not parse or does not type-check. */
export class WhenError extends Error {
  readonly reason: WhenReason;
  /** Character index in the text where the problem starts. */
  readonly position: number;
  /** What is wrong, without the position. */
  readonly detail: string;

  constructor(reason: WhenReason, position: number, detail: string) {
    super(`${detail} at ${position}`);
    this.name = 'WhenError';
    this.reason = reason;
    this.position = position;
    this.detail = detail;
  }
}

type Token =
  | { readonly kind: 'word'; readonly text: string; readonly at: number }
  | { readonly kind: 'string'; readonly text: string; readonly at: number }
  | {
      readonly kind: 'punct';
      readonly text: '(' | ')' | ',' | '!' | '&&' | '||' | '==' | '!=';
      readonly at: number;
    }
  | { readonly kind: 'end'; readonly at: number };

const WORD = /[A-Za-z][A-Za-z0-9._-]*/y;

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const two = text.slice(index, index + 2);
    if (two === '&&' || two === '||' || two === '==' || two === '!=') {
      tokens.push({ kind: 'punct', text: two, at: index });
      index += 2;
      continue;
    }
    if (char === '(' || char === ')' || char === ',' || char === '!') {
      tokens.push({ kind: 'punct', text: char, at: index });
      index += 1;
      continue;
    }
    if (char === "'") {
      const close = text.indexOf("'", index + 1);
      if (close === -1) {
        throw new WhenError('unterminated-string', index, 'unterminated string');
      }
      tokens.push({
        kind: 'string',
        text: text.slice(index + 1, close),
        at: index,
      });
      index = close + 1;
      continue;
    }
    WORD.lastIndex = index;
    const word = WORD.exec(text);
    if (word !== null) {
      tokens.push({ kind: 'word', text: word[0], at: index });
      index += word[0].length;
      continue;
    }
    throw new WhenError(
      'unexpected-character',
      index,
      `unexpected character '${char}'`,
    );
  }
  tokens.push({ kind: 'end', at: text.length });
  return tokens;
};

const isKey = (name: string): name is WhenKey => Object.hasOwn(WHEN_KEYS, name);

const describe = (token: Token): string => {
  if (token.kind === 'end') return 'end of the condition';
  if (token.kind === 'string') return `string '${token.text}'`;
  return `'${token.text}'`;
};

class Parser {
  private index = 0;
  private readonly tokens: readonly Token[];

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    const token = this.tokens[this.index]!;
    if (token.kind !== 'end') this.index += 1;
    return token;
  }

  private fail(token: Token, expected: string): never {
    throw new WhenError(
      token.kind === 'end' ? 'unexpected-end' : 'unexpected-token',
      token.at,
      `expected ${expected}, found ${describe(token)}`,
    );
  }

  private isPunct(text: string): boolean {
    const token = this.peek();
    return token.kind === 'punct' && token.text === text;
  }

  private isWord(text: string): boolean {
    const token = this.peek();
    return token.kind === 'word' && token.text === text;
  }

  parse(): WhenExpr {
    const expr = this.or();
    const token = this.peek();
    if (token.kind !== 'end') this.fail(token, "'&&', '||' or the end");
    return expr;
  }

  private or(): WhenExpr {
    const terms = [this.and()];
    while (this.isPunct('||')) {
      this.next();
      terms.push(this.and());
    }
    return terms.length === 1 ? terms[0]! : { type: 'or', terms };
  }

  private and(): WhenExpr {
    const terms = [this.factor()];
    while (this.isPunct('&&')) {
      this.next();
      terms.push(this.factor());
    }
    return terms.length === 1 ? terms[0]! : { type: 'and', terms };
  }

  private factor(): WhenExpr {
    const token = this.peek();
    if (token.kind === 'punct' && token.text === '!') {
      this.next();
      return { type: 'not', expr: this.negated() };
    }
    if (token.kind === 'punct' && token.text === '(') {
      this.next();
      const expr = this.or();
      const close = this.peek();
      if (!(close.kind === 'punct' && close.text === ')')) {
        this.fail(close, "')'");
      }
      this.next();
      return expr;
    }
    if (token.kind !== 'word') this.fail(token, 'a key, true, false, ! or (');
    if (token.text === 'true' || token.text === 'false') {
      this.next();
      return { type: 'literal', value: token.text === 'true' };
    }
    return this.keyed();
  }

  /** The operand of `!`: a boolean key, a group or another `!`. */
  private negated(): WhenExpr {
    const token = this.peek();
    if (token.kind === 'word' && isKey(token.text)) {
      const expr = this.keyed();
      if (expr.type !== 'key') {
        throw new WhenError(
          'unexpected-token',
          token.at,
          "'!' applies to a key or a group; write !(…) around a comparison",
        );
      }
      return expr;
    }
    return this.factor();
  }

  /** A key alone (boolean keys only), or a comparison with it. */
  private keyed(): WhenExpr {
    const token = this.next();
    if (token.kind !== 'word') this.fail(token, 'a key');
    if (!isKey(token.text)) {
      throw new WhenError(
        'unknown-key',
        token.at,
        `unknown key '${token.text}' (known: ${Object.keys(WHEN_KEYS).join(', ')})`,
      );
    }
    const key = token.text;
    const spec: WhenKeyType = WHEN_KEYS[key];
    const op = this.peek();
    if (op.kind === 'punct' && (op.text === '==' || op.text === '!=')) {
      this.next();
      const literal = this.literal(key, spec);
      return { type: 'compare', key, op: op.text, value: literal };
    }
    if (this.isWord('in')) {
      this.next();
      const open = this.peek();
      if (!(open.kind === 'punct' && open.text === '(')) {
        this.fail(open, "'(' after in");
      }
      this.next();
      const values = [this.literal(key, spec)];
      while (this.isPunct(',')) {
        this.next();
        values.push(this.literal(key, spec));
      }
      const close = this.peek();
      if (!(close.kind === 'punct' && close.text === ')')) {
        this.fail(close, "',' or ')'");
      }
      this.next();
      return { type: 'in', key, values };
    }
    if (spec.type !== 'boolean') {
      throw new WhenError(
        'type-mismatch',
        token.at,
        `'${key}' is a text key: compare it ('${key} == …') or use 'in'`,
      );
    }
    return { type: 'key', key };
  }

  /** A string or `true`/`false` that fits the key's type. */
  private literal(key: WhenKey, spec: WhenKeyType): WhenLiteral {
    const token = this.next();
    if (token.kind === 'string') {
      if (spec.type === 'boolean') {
        throw new WhenError(
          'type-mismatch',
          token.at,
          `'${key}' is a boolean: compare it with true or false, not '${token.text}'`,
        );
      }
      if (!spec.values.includes(token.text)) {
        throw new WhenError(
          'unknown-value',
          token.at,
          `unknown value '${token.text}' for '${key}' (known: ${spec.values.join(', ')})`,
        );
      }
      return token.text;
    }
    if (
      token.kind === 'word' &&
      (token.text === 'true' || token.text === 'false')
    ) {
      if (spec.type !== 'boolean') {
        throw new WhenError(
          'type-mismatch',
          token.at,
          `'${key}' is a text key: compare it with a 'string', not ${token.text}`,
        );
      }
      return token.text === 'true';
    }
    return this.fail(
      token,
      spec.type === 'boolean' ? 'true or false' : "a 'string'",
    );
  }
}

/**
 * Parses and type-checks a condition. Throws `WhenError` (reason and
 * character position) for an empty or longer than `WHEN_MAX_LENGTH`
 * condition, a syntax error, an unknown key or value, and a type mismatch.
 */
export const parseWhen = (text: string): WhenExpr => {
  if (text.trim() === '') throw new WhenError('empty', 0, 'empty condition');
  if (text.length > WHEN_MAX_LENGTH) {
    throw new WhenError(
      'too-long',
      WHEN_MAX_LENGTH,
      `condition longer than ${WHEN_MAX_LENGTH} characters`,
    );
  }
  return new Parser(tokenize(text)).parse();
};

/**
 * Value of the condition in a context. `null` (no condition) is true. The
 * function is pure and reads each context key only when the condition needs it,
 * so a context built from reactive sources tracks exactly those.
 */
export const evaluateWhen = (
  expr: WhenExpr | null,
  context: WhenContext,
): boolean => {
  if (expr === null) return true;
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'key':
      return context[expr.key] === true;
    case 'not':
      return !evaluateWhen(expr.expr, context);
    case 'compare':
      return (context[expr.key] === expr.value) === (expr.op === '==');
    case 'in':
      return expr.values.some((value) => context[expr.key] === value);
    case 'and':
      return expr.terms.every((term) => evaluateWhen(term, context));
    case 'or':
      return expr.terms.some((term) => evaluateWhen(term, context));
  }
};
