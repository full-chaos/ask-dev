#!/usr/bin/env bash
# Pinning test for CHAOS-4509.
#
# `ci/run_checks.sh ci` must exit non-zero when any tier fails, and it must
# stop at the FIRST failing tier (fail-fast) rather than running the rest and
# reporting only the last tier's result. Before the fix, `run_step` captured
# `$?` after the `if` block (always 0 there), so every tier printed
# "failed ... (exit 0)" and the wrapper still returned success; and the `ci`
# case ran all seven tiers unconditionally, so an earlier failure was masked
# by later tiers even if the exit code had been correct.
#
# No real toolchain runs: `pnpm` is stubbed on PATH. FAIL_STEP names the pnpm
# subcommand (its first argument) to fail; every other stubbed invocation is
# logged to CALL_LOG and exits 0.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run_checks="${here}/run_checks.sh"

fail=0

# assert_fails_at STEP_TO_FAIL EARLIER_STEPS... -- LATER_STEPS...
# EARLIER_STEPS must appear in the call log (they ran before the failure);
# LATER_STEPS (including STEP_TO_FAIL's own successors) must NOT appear.
run_case() {
  local fail_step="$1"
  shift
  local -a earlier=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do
    earlier+=("$1")
    shift
  done
  shift # drop --
  local -a later=("$@")

  local work
  work=$(mktemp -d)
  local bin="${work}/bin"
  mkdir -p "${bin}"
  local call_log="${work}/calls.log"
  : >"${call_log}"

  cat >"${bin}/pnpm" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"${CALL_LOG}"
if [[ "$1" == "${FAIL_STEP:-}" ]]; then
  exit 1
fi
exit 0
STUB
  chmod +x "${bin}/pnpm"

  local out="${work}/out.log"
  local status=0
  # Run from an empty scratch cwd, never the real checkout: run_e2e does
  # `rm -rf .next/dev` relative to cwd, which must never touch a real build.
  local scratch="${work}/scratch"
  mkdir -p "${scratch}"
  (cd "${scratch}" && PATH="${bin}:${PATH}" CALL_LOG="${call_log}" FAIL_STEP="${fail_step}" \
    bash "${run_checks}" ci >"${out}" 2>&1) || status=$?

  if [[ "${status}" -eq 0 ]]; then
    echo "FAIL: run_checks.sh ci exited 0 with a failing tier (${fail_step})" >&2
    cat "${out}" >&2
    fail=1
  else
    echo "ok: exit ${status} (non-zero) when ${fail_step} fails"
  fi

  local step
  for step in "${earlier[@]}"; do
    if ! grep -q "^${step}\b" "${call_log}"; then
      echo "FAIL: expected earlier tier '${step}' to have run before ${fail_step} failed" >&2
      fail=1
    fi
  done
  for step in "${later[@]}"; do
    if grep -q "^${step}\b" "${call_log}"; then
      echo "FAIL: tier '${step}' ran after '${fail_step}' failed — no fail-fast" >&2
      cat "${call_log}" >&2
      fail=1
    else
      echo "ok: '${step}' did not run after '${fail_step}' failed"
    fi
  done

  rm -rf "${work}"
}

# Case 1: the FIRST tier fails -> nothing else may run.
run_case "format:check" \
  -- \
  "acr:contracts:check" "lint" "typecheck" "test:unit" "build" "test:e2e"

# Case 2: a MIDDLE tier fails -> earlier tiers ran, later ones did not.
run_case "lint" \
  "format:check" "acr:contracts:check" \
  -- \
  "typecheck" "test:unit" "build" "test:e2e"

# Case 3: a step NESTED inside run_e2e fails (`pnpm exec playwright install
# ...`, first arg "exec"). run_e2e calls this via `run_step` without checking
# its result, so a failure here must still stop the run before `pnpm
# test:e2e` executes and must still make `run_checks.sh ci` exit non-zero.
run_case "exec" \
  "format:check" "acr:contracts:check" "lint" "typecheck" "test:unit" "build" \
  -- \
  "test:e2e"

if [[ "${fail}" -ne 0 ]]; then
  echo "run_checks_fail_fast.test.sh: FAILED" >&2
  exit 1
fi
echo "run_checks_fail_fast.test.sh: PASSED"
