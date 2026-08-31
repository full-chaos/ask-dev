#!/usr/bin/env bash
# Single entry point for every gate, so CI and a local run execute the SAME
# commands. Modeled on dev-health-web's ci/run_tests.sh.
#
#   bash ci/run_checks.sh ci   # everything, in CI order
#
set -euo pipefail

usage() {
  echo "Usage: ci/run_checks.sh <format|contracts|lint|typecheck|unit|build|e2e|ci>" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

export TZ=UTC
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export NODE_ENV=test
export FORCE_COLOR=0

is_ci() {
  [[ "${CI:-}" == "true" || "${CI:-}" == "1" ]]
}

run_step() {
  local phase="$1"
  shift
  local started_at="${SECONDS}"
  local status
  echo "==> ${phase} started"
  if "$@"; then
    echo "==> ${phase} passed in $((SECONDS - started_at))s"
    return 0
  else
    status=$?
    echo "==> ${phase} failed in $((SECONDS - started_at))s (exit ${status})" >&2
    return "${status}"
  fi
}

run_format() {
  pnpm format:check
}

# Exact-diff regeneration guard. Runs with no acr checkout: it verifies the
# committed copies against the manifest digests and regenerates the types from
# them. A hand-edited copy, a hand-edited generated type, or a stale type after
# a pin bump all fail here.
run_contracts() {
  pnpm acr:contracts:check
}

run_lint() {
  pnpm lint
}

run_typecheck() {
  pnpm typecheck
}

run_unit() {
  pnpm test:unit
}

run_build() {
  NODE_ENV=production pnpm build
}

install_playwright_browser() {
  if is_ci && [[ "$(uname -s)" == "Linux" ]]; then
    pnpm exec playwright install --with-deps chromium
    return
  fi
  pnpm exec playwright install chromium
}

# The smoke suite serves the production build through `next start`, so the
# build must have run first. `ci` guarantees that ordering; a bare `e2e` builds
# on demand.
#
# Drop the dev server's compiled chunks first. dev-health-web learned this the
# hard way: a stale .next/dev makes `next dev` serve chunks that do not match
# the tree, and the symptom is unrelated PRODUCT specs failing, not a build
# error. Scoped to .next/dev so the production build this tier just made
# survives.
run_e2e() {
  rm -rf .next/dev
  if [[ ! -d .next ]]; then
    run_step "build (required by e2e)" run_build || return "$?"
  fi
  run_step "playwright browser installation" install_playwright_browser || return "$?"
  pnpm test:e2e
}

case "$1" in
  format) run_step format run_format ;;
  contracts) run_step contracts run_contracts ;;
  lint) run_step lint run_lint ;;
  typecheck) run_step typecheck run_typecheck ;;
  unit) run_step unit run_unit ;;
  build) run_step build run_build ;;
  e2e) run_step e2e run_e2e ;;
  ci)
    export CI=true
    # Stop at the first failing tier. `set -e` would also catch a bare
    # `run_step ...` failing here, but that relies on function-call errexit
    # propagation, which has well-known gotchas (e.g. inside `&&`/`||`,
    # command substitution, or a future edit to this case). Fail-fast is
    # made explicit so a later failure can never be masked by tiers that
    # run after it.
    run_step format run_format || exit "$?"
    run_step contracts run_contracts || exit "$?"
    run_step lint run_lint || exit "$?"
    run_step typecheck run_typecheck || exit "$?"
    run_step unit run_unit || exit "$?"
    run_step build run_build || exit "$?"
    run_step e2e run_e2e || exit "$?"
    ;;
  *)
    usage
    exit 1
    ;;
esac
