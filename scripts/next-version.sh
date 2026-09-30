#!/bin/sh
# Prints the next release version that semantic-release computes from Conventional Commits.
#   scripts/next-version.sh            for origin/develop (in a temporary clone)
#   scripts/next-version.sh <branch>   for the current checkout; <branch> must be pushed to origin
# Exit 1 (details on stderr) when the commits do not warrant a release.
# The last release is found by tag: tags live on main, so develop must contain main
# (the "sync main into develop" PR after every release), otherwise the version is stale.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
bin="$root/node_modules/semantic-release/bin/semantic-release.js"

dry_run() {
  # env-ci must not see a CI or pull request context: it would replace the branch
  env -u GITHUB_ACTIONS -u CI node "$bin" --dry-run --no-ci \
    --branches "$1" --plugins @semantic-release/commit-analyzer 2>&1 || true
}

if [ $# -ge 1 ]; then
  output=$(dry_run "$1")
else
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  git clone -q --branch develop --single-branch "$(git -C "$root" remote get-url origin)" "$tmp"
  ln -s "$root/node_modules" "$tmp/node_modules"
  output=$(cd "$tmp" && dry_run develop)
fi

next=$(printf '%s\n' "$output" | grep -oiE 'next release version is [0-9]+\.[0-9]+\.[0-9]+' | awk '{print $NF}' | tail -1 || true)
if [ -z "$next" ]; then
  printf '%s\n' "$output" >&2
  echo 'no release: the commits since the last tag do not include feat, fix, perf or a breaking change' >&2
  exit 1
fi
printf '%s\n' "$next"
