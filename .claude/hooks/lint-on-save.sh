#!/bin/bash
# PostToolUse hook: lint and format files after Edit/Write
# Receives JSON on stdin with tool_input.file_path (Write) or tool_input.file_path (Edit)

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only lint TypeScript/JavaScript files
if [[ -z "$FILE_PATH" ]] || [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  exit 0
fi

# Determine which package the file belongs to
if [[ "$FILE_PATH" == *"packages/server"* ]]; then
  PKG="@agency/server"
elif [[ "$FILE_PATH" == *"packages/client"* ]]; then
  PKG="@agency/client"
else
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

ERRORS=""

# Run ESLint on the file
if ! LINT_OUT=$(pnpm --filter "$PKG" exec eslint --no-warn-ignored "$FILE_PATH" 2>&1); then
  ERRORS="ESLint errors in $FILE_PATH:\n$LINT_OUT"
fi

# Run Prettier check on the file
if ! FMT_OUT=$(pnpm exec prettier --check "$FILE_PATH" 2>&1); then
  # Auto-fix formatting
  pnpm exec prettier --write "$FILE_PATH" >/dev/null 2>&1
  ERRORS="$ERRORS\nPrettier: auto-formatted $FILE_PATH"
fi

if [[ -n "$ERRORS" ]]; then
  echo -e "$ERRORS" >&2
  exit 2
fi

exit 0
