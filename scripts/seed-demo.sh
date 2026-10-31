#!/usr/bin/env bash
set -euo pipefail

# seed-demo.sh — create and seed the "haunted-candy-shop" demo repository.
#
# Builds a brand-new public repo, pushes demo/base/ as the initial `main` commit,
# then opens a PR from feature/candy-distribution carrying the five planted bugs
# and the hidden "possession" note in the PR description (demo/pr/pr-description.md).
#
# Uses only the `gh` CLI for every GitHub action — no tokens or secrets in this
# file, no hand-rolled API calls.
#
# Usage:
#   ./scripts/seed-demo.sh USER/haunted-candy-shop

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$SCRIPT_DIR/../demo"

REPO_FULL_NAME="${1:-}"
PR_TITLE="Add candy distribution endpoint"
PR_BRANCH="feature/candy-distribution"
DESCRIPTION="🏚️ haunted-candy-shop — a fake repo with planted bugs for demoing Bug Hunter"

usage() {
  echo "Usage: $0 <owner>/<repo>" >&2
  echo "Example: $0 your-user/haunted-candy-shop" >&2
  exit 1
}

if [[ -z "$REPO_FULL_NAME" ]]; then
  echo "error: missing repo name" >&2
  usage
fi

if [[ ! "$REPO_FULL_NAME" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "error: '$REPO_FULL_NAME' is not a valid <owner>/<repo> name" >&2
  usage
fi

# --- Prerequisites ------------------------------------------------------------
if ! command -v gh >/dev/null 2>&1; then
  echo "error: 'gh' CLI not found. Install it (https://cli.github.com) and run 'gh auth login'." >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "error: 'gh' is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

# --- Idempotent-ish: never clobber an existing repo ---------------------------
if gh repo view "$REPO_FULL_NAME" >/dev/null 2>&1; then
  echo "warning: $REPO_FULL_NAME already exists — leaving it untouched." >&2
  exit 0
fi

# --- 1. Create the repo --------------------------------------------------------
echo "🕯️  Creating repo $REPO_FULL_NAME ..."
gh repo create "$REPO_FULL_NAME" --public --description "$DESCRIPTION"

# --- 2. Initial commit on main, built inside a temp dir ------------------------
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "🕯️  Cloning into a temp worktree ..."
gh repo clone "$REPO_FULL_NAME" "$TMP_DIR/repo"
cd "$TMP_DIR/repo"

# An empty-repo clone has an unborn HEAD; pin it to `main` explicitly.
git symbolic-ref HEAD refs/heads/main

# Give commits an identity local to this throwaway repo only.
git config user.name  "Bug Hunter"
git config user.email "bughunter@example.com"

echo "🕯️  Committing base files (src/costumes.ts, src/db.ts, AGENTS.md) ..."
cp -R "$DEMO_DIR/base/." .
git add -A
git commit -q -m "Initial commit: costume checker, fake DB wrapper, repo rules"
git push -q -u origin main

# --- 3. Feature branch with the planted bugs -----------------------------------
echo "🕯️  Creating branch $PR_BRANCH ..."
git checkout -q -b "$PR_BRANCH"
mkdir -p src
cp "$DEMO_DIR/pr/src/candy.ts" src/candy.ts
git add -A
git commit -q -m "$PR_TITLE"
git push -q -u origin "$PR_BRANCH"

# --- 4. Open the PR (body carries the hidden possession note) ------------------
echo "🕯️  Opening the pull request ..."
PR_URL="$(gh pr create \
  --title "$PR_TITLE" \
  --body-file "$DEMO_DIR/pr/pr-description.md" \
  --base main \
  --head "$PR_BRANCH")"

echo
echo "✅ Demo repo seeded: https://github.com/$REPO_FULL_NAME"
echo "🔮 Pull request:     $PR_URL"
echo
echo "Next, trigger the hunt. Replace <secret> with your N8N_SHARED_SECRET value:"
echo
echo "  curl -sS -X POST http://localhost:3000/api/hunt \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'X-BugHunter-Secret: <secret>' \\"
echo "    -d '{\"pr_url\": \"$PR_URL\"}'"
echo
echo "Or, if the repo webhook is wired to your server, just reopen the PR and the"
echo "hunt runs automatically."
