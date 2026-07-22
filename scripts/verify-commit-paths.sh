#!/usr/bin/env bash
# Dry-run: check whether paths violate the publish policy.
#
# Usage:
#   bash scripts/verify-commit-paths.sh              # staged files
#   bash scripts/verify-commit-paths.sh path1 path2  # explicit paths

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=../.githooks/lib/phase-only-policy.sh
source "$REPO_ROOT/.githooks/lib/phase-only-policy.sh"

cd "$REPO_ROOT"

if [[ $# -gt 0 ]]; then
  FILES=$(printf '%s\n' "$@")
else
  FILES=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
  if [[ -z "$FILES" ]]; then
    echo "No staged files. Nothing to verify."
    exit 0
  fi
fi

if printf '%s\n' "$FILES" | phase_only_check_stdin; then
  echo "OK: all paths are allowed (phase<N>/, README.md, LICENSE, .github/, scripts/, .githooks/)"
  exit 0
fi

exit 1
