#!/usr/bin/env bash
set -euo pipefail

# Collect root *.md/*.mdx and docs/design MDX/MD files if they exist
files=()
# Root MD/MDX
while IFS= read -r -d '' f; do files+=("$f"); done < <(find . -maxdepth 1 -type f \( -name "*.md" -o -name "*.mdx" \) -print0)
# Docs MD/MDX
while IFS= read -r -d '' f; do files+=("$f"); done < <(find docs -type f \( -name "*.md" -o -name "*.mdx" \) -print0 2>/dev/null || true)
# Design MD/MDX
while IFS= read -r -d '' f; do files+=("$f"); done < <(find design -type f \( -name "*.md" -o -name "*.mdx" \) -print0 2>/dev/null || true)

# Run Prettier only if there are files
if [ "${#files[@]}" -gt 0 ]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm exec prettier -w "${files[@]}"
  else
    npx --no-install prettier -w "${files[@]}"
  fi
fi
