#!/bin/sh
# Links every skill of the vendor/metaskills submodule for coding agents.
#   .agents/skills/<name> -> ../../vendor/metaskills/skills/<name>   (real links into the submodule)
#   .claude/skills/<name> -> ../../.agents/skills/<name>             (same convention as ~/.claude/skills)
# Agents discover skills exactly one level below skills/ (<root>/skills/<name>/SKILL.md), so the
# single-symlink layout of `npx metaskills` (skills/metaskills/<name>/SKILL.md) is not used.
# Idempotent: run after `git submodule update --init` or after updating the submodule.
set -eu
cd "$(dirname "$0")/.."

SRC=vendor/metaskills/skills
[ -d "$SRC" ] || { echo "missing $SRC: run 'git submodule update --init'" >&2; exit 1; }

mkdir -p .agents/skills .claude/skills

# drop stale links created by this script (never touches real directories or foreign links)
for link in .agents/skills/* .claude/skills/*; do
  [ -L "$link" ] || continue
  case "$(readlink "$link")" in
    ../../vendor/metaskills/skills/*|../../.agents/skills/*) [ -e "$link" ] || rm "$link" ;;
  esac
done

for dir in "$SRC"/*/; do
  name=$(basename "$dir")
  [ -f "$dir/SKILL.md" ] || continue
  ln -sfn "../../vendor/metaskills/skills/$name" ".agents/skills/$name"
  ln -sfn "../../.agents/skills/$name" ".claude/skills/$name"
  echo "linked $name"
done
