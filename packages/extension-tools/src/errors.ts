/** Ошибка сборки/проверки расширения; `subject` — id расширения или каталог. */
export class BuildError extends Error {
  readonly subject: string;

  constructor(message: string, subject: string) {
    super(message);
    this.name = 'BuildError';
    this.subject = subject;
  }
}

/** Неверные входные данные команды (несуществующий каталог): код выхода 2. */
export class CatalogUsageError extends BuildError {}
