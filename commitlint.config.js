const fs = require('node:fs');

// scope = имя каталога в apps/ или packages/ (без префикса @spirula/) либо один из служебных
const WORKSPACE_DIRS = ['apps', 'packages'];
const EXTRA_SCOPES = [
  'deps',
  'docs',
  'engine-ts',
  'packages',
  'release',
  'repo',
  'skills',
];

const workspaceScopes = () =>
  WORKSPACE_DIRS.flatMap((dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', [...workspaceScopes(), ...EXTRA_SCOPES]],
    // тела коммитов содержат ссылки и вывод команд
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
  // коммит релиза создаёт semantic-release, его сообщение содержит заметки релиза
  ignores: [(message) => message.startsWith('chore(release):')],
};
