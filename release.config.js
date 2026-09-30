/* eslint-disable no-template-curly-in-string -- шаблоны lodash semantic-release, не JS */
// Релиз только из main: push в main запускает .github/workflows/release.yml.
// Версия считается по Conventional Commits: feat — minor, fix и perf — patch,
// `!` после типа или BREAKING CHANGE в теле — major; остальные типы релиз не создают.
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    // пакет private: версия пишется в package.json, публикации в npm нет
    ['@semantic-release/npm', { npmPublish: false }],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json'],
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    ['@semantic-release/github', { successComment: false, failComment: false }],
    // версия нового релиза нужна следующим jobs workflow (сборка установщиков)
    [
      '@semantic-release/exec',
      {
        publishCmd: 'echo "version=${nextRelease.version}" >> "$GITHUB_OUTPUT"',
      },
    ],
  ],
};
