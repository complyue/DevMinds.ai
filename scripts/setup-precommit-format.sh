#!/usr/bin/env bash
set -euo pipefail

# Hard-disable Corepack to avoid interactive prompts and proxy issues
export COREPACK_ENABLE=0
if command -v corepack >/dev/null 2>&1; then corepack disable || true; fi

# Ensure pnpm available in this shell
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
# Avoid corepack to prevent interactive/network proxy issues; install pnpm globally
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    npm install -g pnpm@9
  else
    echo "npm not found; please ensure Node/npm installed (nvm with LTS)"; exit 1
  fi
fi

echo "Using: node=$(command -v node || true) npm=$(command -v npm || true) pnpm=$(command -v pnpm || true)"
node -v || true
npm -v || true
pnpm -v || true
echo "Corepack disabled (env COREPACK_ENABLE=$COREPACK_ENABLE)"

# Install dev deps at workspace root (husky + lint-staged)
pnpm -w add -D husky@^9 lint-staged@^15

# Ensure lint-staged config exists in root package.json (already added earlier)
# Create .husky and pre-commit hook
mkdir -p .husky
cat > .husky/pre-commit << 'HOOK'
#!/bin/sh
# Pre-commit: format staged TS files via lint-staged
pnpm exec lint-staged
HOOK
chmod +x .husky/pre-commit

# Point Git hooks to .husky
git config core.hooksPath .husky

# Install workspace deps
pnpm -w install
pnpm -r run format || true

echo "git hooksPath: $(git config --get core.hooksPath || echo unset)"
echo "Husky directory:"
ls -la .husky || true
echo "lint-staged version:"
pnpm exec lint-staged --version || true
