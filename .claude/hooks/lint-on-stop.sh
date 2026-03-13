#!/bin/bash
# Stop hook: run full lint across the repo before session ends
# If lint fails, Claude is told about the errors and continues working

set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"

ERRORS=""

# Run ESLint across both packages
if ! LINT_OUT=$(pnpm lint 2>&1); then
  ERRORS="ESLint errors found:\n$LINT_OUT"
fi

# Check formatting
if ! FMT_OUT=$(pnpm format:check 2>&1); then
  # Auto-fix formatting issues
  pnpm format >/dev/null 2>&1
  ERRORS="$ERRORS\nPrettier: auto-formatted files. Review the changes."
fi

if [[ -n "$ERRORS" ]]; then
  echo -e "$ERRORS" >&2
  exit 2
fi

exit 0
