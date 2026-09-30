const MAX_ISSUES = 10;

export class CatalogFormatError extends Error {
  readonly issues: string[];

  constructor(issues: readonly string[]) {
    const kept = issues.slice(0, MAX_ISSUES);
    super(`invalid catalog: ${kept.join('; ')}`);
    this.name = 'CatalogFormatError';
    this.issues = kept;
  }
}
