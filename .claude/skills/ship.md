---
name: ship
description: Lint, commit, and push the current phase's work. Use when a phase is complete and ready to ship.
user_invocable: true
---

# Ship

Run these steps in order. Stop and report if any step fails.

## 1. Lint and format

Run `pnpm --filter @agency/server lint` and `pnpm --filter @agency/client lint` to check for ESLint errors. If there are errors, fix them before continuing.

Run `pnpm format:check`. If files need formatting, run `pnpm format` to auto-fix, then stage the formatted files.

## 2. Build check

Run `pnpm --filter @agency/server build` to verify TypeScript compiles cleanly.

## 3. Review changes

Run `git status` and `git diff --stat` to see what changed. Review the changes to understand what's being shipped.

## 4. Commit

Stage all relevant files (do NOT use `git add -A` — be selective, avoid committing .env, .db files, or other artifacts).

Write a commit message that:
- Has a short title line describing the phase or change
- Includes a body with bullet points of what was built
- Ends with `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`

Use a HEREDOC to pass the message:
```
git commit -m "$(cat <<'EOF'
Title here

- bullet points

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

## 5. Push

Run `git push` to push to the remote.

## 6. Confirm

Show the user the commit hash, title, and a one-line confirmation that it's pushed.
