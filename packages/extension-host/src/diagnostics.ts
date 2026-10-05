import type {
  ExtensionDiagnosticCode,
  ExtensionDiagnosticDto,
  ExtensionDiagnosticValue,
} from '@dolphy-app/engine-contract';

type Data = Record<string, ExtensionDiagnosticValue>;

const text = (data: Data, key: string): string => {
  const value = data[key];
  return Array.isArray(value) ? value.join(', ') : String(value ?? '');
};

const rangeSuffix = (data: Data): string =>
  data.range === undefined ? '' : ` ${text(data, 'range')}`;

const FORMATTERS: Record<ExtensionDiagnosticCode, (data: Data) => string> = {
  'manifest-unreadable': (data) =>
    `extension.json is unreadable: ${text(data, 'reason')}`,
  'manifest-invalid': (data) =>
    Array.isArray(data.issues) ? data.issues.join('; ') : text(data, 'issues'),
  'id-mismatch': (data) =>
    `directory name '${text(data, 'expected')}' does not match manifest id '${text(data, 'actual')}'`,
  'requires-app': (data) => `requires app >= ${text(data, 'minAppVersion')}`,
  'unavailable-platform': (data) =>
    `not available on ${text(data, 'platform')}`,
  'claim-clash': (data) =>
    `${text(data, 'kind')} '${text(data, 'name')}' is already provided by '${text(data, 'by')}'`,
  'load-failed': (data) => text(data, 'reason'),
  'overridden-by': (data) =>
    `overridden by ${text(data, 'origin')} ${text(data, 'version')}`,
  'safe-mode': () => 'disabled in safe mode',
  'dependency-missing': (data) =>
    `requires extension '${text(data, 'id')}'${rangeSuffix(data)}, which is not installed`,
  'dependency-disabled': (data) =>
    `requires extension '${text(data, 'id')}'${rangeSuffix(data)}, which is disabled`,
  'dependency-version': (data) =>
    `requires extension '${text(data, 'id')}' ${text(data, 'range')}, found ${text(data, 'found')}`,
  'dependency-unmet': (data) =>
    `requires extension '${text(data, 'id')}'${rangeSuffix(data)}, which is not loaded because its own dependencies are not met`,
  'dependency-cycle': (data) =>
    `extensions depend on each other: ${text(data, 'cycle')}`,
  'locale.missing-key': (data) =>
    `key '${text(data, 'key')}' is missing in locales/en.json`,
  'locale.invalid-file': (data) =>
    `${text(data, 'file')} is ignored: ${text(data, 'reason')}`,
};

/**
 * English text of a diagnostic: the single place that renders it for the CLI,
 * logs and the installer. The app window builds its own localized text from
 * the code and data.
 */
export const formatDiagnostic = ({
  code,
  data,
}: ExtensionDiagnosticDto): string => FORMATTERS[code](data);
