#!/usr/bin/env bash
set -euo pipefail

# Run all Case Tests under tests/cases/*
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CASES_DIR="$ROOT_DIR/tests/cases"

echo "[runner] root=$ROOT_DIR"
if [[ ! -d "$CASES_DIR" ]]; then
  echo "[runner][warn] no cases dir: $CASES_DIR"
  exit 0
fi

fail=0
for case_script in "$CASES_DIR"/*.sh; do
  [[ -e "$case_script" ]] || continue
  echo "[runner] running: $case_script"
  bash "$case_script" || { echo "[runner][fail] $case_script"; fail=1; }
done

if [[ "$fail" -eq 0 ]]; then
  echo "[runner][ok] all case tests passed"
else
  echo "[runner][fail] some case tests failed"
  exit 1
fi
