/** Extension build/check error; `subject` is the extension id or directory. */
export class BuildError extends Error {
  readonly subject: string;

  constructor(message: string, subject: string) {
    super(message);
    this.name = 'BuildError';
    this.subject = subject;
  }
}

/** Invalid command input (nonexistent directory): exit code 2. */
export class CatalogUsageError extends BuildError {}
