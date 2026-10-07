import type {
  EngineDiagnosticsDto,
  ExtensionHealthDto,
  ExtensionInfoDto,
  ExtensionsDiagnosticsDto,
} from '@dolphy-app/engine-contract';
import type { AppInfo } from '../../../../shared/bridge.ts';

/** Откуда собирается отчёт; в текст попадают только перечисленные ниже поля. */
export interface DiagnosticsReportInput {
  app: AppInfo;
  engine: Pick<EngineDiagnosticsDto, 'contractVersion' | 'engineVersion'>;
  diagnostics: ExtensionsDiagnosticsDto;
  extensions: readonly ExtensionInfoDto[];
}

/** Длиннее текст сбоя в отчёте не нужен: он вставляется в обращение. */
const MAX_TEXT = 500;

const SEPARATOR = String.raw`[\\/]`;
const NAME_CHAR = String.raw`[^\\/\s"'\x60:;,<>|?*]`;
const NAME = `${NAME_CHAR}+`;

/**
 * Домашний каталог в любой записи: `/Users/<имя>`, `/home/<имя>`,
 * `C:\Users\<имя>` (диск в любом регистре, прямые, обратные и удвоенные
 * `\\` слеши). Имя может содержать пробелы, если за ним идёт разделитель.
 */
const HOME_PATH = new RegExp(
  String.raw`(?<![\w.-])(?:[A-Za-z]:)?${SEPARATOR}+(?:Users|home)${SEPARATOR}+(?:${NAME}(?: ${NAME})*(?=${SEPARATOR})|${NAME})`,
  'gi',
);

/** Путь домашнего каталога заменяется на `~`, остаток пути сохраняется. */
export const redactHomePaths = (text: string): string =>
  text.replace(HOME_PATH, '~');

/** Свободный текст: без домашних путей, в одну строку (запись не подделывает строки отчёта), не длиннее предела. */
const clean = (text: string): string => {
  const line = redactHomePaths(text).replace(/\s+/g, ' ').trim();
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT)}…` : line;
};

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

const isoTime = (at: number): string =>
  Number.isFinite(at) ? new Date(at).toISOString() : 'invalid';

const healthLine = (health: ExtensionHealthDto | undefined): string => {
  if (health === undefined) return 'health: unavailable';
  const failure = health.lastFailure;
  const message = failure === null ? '' : clean(failure.message);
  const last =
    failure === null
      ? 'none'
      : `${clean(failure.reason)} at ${isoTime(failure.at)}${message === '' ? '' : `: ${message}`}`;
  const activation =
    health.lastActivationMs === null ? 'none' : `${health.lastActivationMs} ms`;
  const suppressed =
    health.suppressedUntil === null ? 'none' : isoTime(health.suppressedUntil);
  return `health: failures=${health.failures}; last failure: ${last}; last activation: ${activation}; suppressed until: ${suppressed}`;
};

const extensionLines = (
  extension: ExtensionInfoDto,
  health: ExtensionHealthDto | undefined,
): string[] => {
  const codes = extension.diagnostics.map(({ code }) => clean(code));
  return [
    `- ${clean(extension.id)} ${clean(extension.version ?? 'unknown')}`,
    `  origin: ${clean(extension.origin)}; state: ${clean(extension.state)}`,
    `  diagnostics: ${codes.length === 0 ? 'none' : codes.join(', ')}`,
    `  ${healthLine(health)}`,
  ];
};

/**
 * Текст «Скопировать диагностику»: английский, технический, как журнал.
 * Поля выбираются поимённо (DTO целиком не сериализуются), любой свободный
 * текст очищается от домашних путей. Содержимого библиотеки, данных
 * обучения, значений настроек и хранилища расширений в отчёте нет.
 */
export const diagnosticsReport = ({
  app,
  engine,
  diagnostics,
  extensions,
}: DiagnosticsReportInput): string => {
  const { safeMode } = diagnostics;
  const healthById = new Map(
    diagnostics.extensions.map((health) => [health.id, health]),
  );
  const lines = [
    'Dolphy diagnostics',
    `App version: ${clean(app.appVersion)}`,
    `Contract version: ${engine.contractVersion}`,
    `Engine version: ${clean(engine.engineVersion)}`,
    `Electron: ${clean(app.electron)}`,
    `Chrome: ${clean(app.chrome)}`,
    `Node: ${clean(app.node)}`,
    `Platform: ${clean(app.platform)} ${clean(app.arch)}`,
    `Safe mode: active=${yesNo(safeMode.active)}; persisted=${yesNo(safeMode.persisted)}; forced by: ${safeMode.forcedBy === null ? 'none' : clean(safeMode.forcedBy)}`,
    `Extension host: ${clean(diagnostics.host)}`,
    `Extensions (${extensions.length}):`,
    ...extensions.flatMap((extension) =>
      extensionLines(extension, healthById.get(extension.id)),
    ),
  ];
  return `${lines.join('\n')}\n`;
};
