#!/usr/bin/env bash
# One-command local launch for the Ask Dev Workbench (CHAOS-3738).
#
# Brings up a real local ACR Context Fabric backend (FalkorDB + acr-projector
# + acr-api) as plain Docker containers joined to the shared `dev-health`
# Compose network, reusing the ALREADY-RUNNING dev-health-postgres /
# dev-health-clickhouse containers and their real seeded data. This does NOT
# touch dev-health/compose.yml or dev-health/.env (shared, another lane's
# territory) -- it only adds new, independently-named containers.
#
# Requires:
#   - The dev-health docker compose stack already up (postgres + clickhouse
#     healthy) -- `docker compose up -d` in dev-health/ if not.
#   - The dev-health-acr:dev image built locally:
#       (cd dev-health/acr && docker build -t dev-health-acr:dev --target acr-api .)
#   - dev-health/.acr-dev/{evidence-kid,evidence-keys,web-assertion.key,web-jwks.json}
#     -- a reusable local dev keypair/evidence-key fixture. Generate once if
#     missing; see that directory's own file shapes for the expected format
#     (Ed25519 JWKS + matching PKCS8 private key, ACR evidence signing keys).
#
# Requires OPENAI_API_KEY in the environment (ACR's model provider is
# openai; without it acr-api starts but every investigation 503s).
#
# Fixed 2026-08-26: investigations were intermittently coming back as
# "ACR could not be reached" / acr_unreachable even though ACR itself had
# completed the work (`docker logs acr-dev-acr-api` showed a real 200).
# Two compounding causes, both fixed below:
#   1. ACR_WRITE_TIMEOUT (Go's http.Server.WriteTimeout) defaults to 20s.
#      Any investigation whose response takes longer than that to WRITE gets
#      its connection forcibly closed mid-handler -- confirmed live: 6/6
#      deliberately-slow (30-90s) investigations succeeded once this was
#      raised to match ACR_REQUEST_TIMEOUT (490s), set on acr-api below.
#   2. The stale pre-CHAOS-3855 model (gpt-5-nano, CHAOS-4136) made every
#      investigation slow enough (30-90s) to hit issue 1 constantly. The
#      correct model (gpt-5.6-luna, chris ruling 08-23) answers in 2-8s,
#      well under even the OLD 20s ceiling, and is what this script sets.
#
# Usage: OPENAI_API_KEY=sk-... bash scripts/dev-launch.sh
set -euo pipefail

DEV_HEALTH_ROOT="${DEV_HEALTH_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../dev-health" && pwd)}"
ACR_DEV_SECRETS="$DEV_HEALTH_ROOT/.acr-dev"
NETWORK="dev-health_dev-health"
ORG_ID="${ACR_DEV_ORG_ID:-70d529e0-3c06-4597-8480-794fd02328b6}"
REPO_SCOPES="${ACR_DEV_REPOSITORY_SCOPES:-full.chaos/dev-health-ops,full.chaos/chaos-ops}"

note() { printf '[ask-dev-launch] %s\n' "$*" >&2; }

for c in postgres clickhouse; do
  cid="$(docker ps -q --filter "name=^dev-health-${c}-1$")"
  if [[ -z "$cid" ]]; then
    note "dev-health-${c}-1 is not running. Start the dev-health stack first:"
    note "  (cd $DEV_HEALTH_ROOT && docker compose up -d postgres clickhouse valkey api web)"
    exit 1
  fi
done

for f in web-assertion.key evidence-kid evidence-keys web-jwks.json; do
  if [[ ! -f "$ACR_DEV_SECRETS/$f" ]]; then
    note "Missing $ACR_DEV_SECRETS/$f -- see this script's header comment."
    exit 1
  fi
done

if [[ -z "$(printf '%s' "${OPENAI_API_KEY:-}" | tr -d '[:space:]')" ]]; then
  note "OPENAI_API_KEY is not set. ACR's model provider is openai; without a key"
  note "  acr-api starts but every investigation 503s. Export it and rerun:"
  note "  OPENAI_API_KEY=sk-... bash scripts/dev-launch.sh"
  exit 1
fi

# Contract-pin sanity check: this repo's contracts are byte-pinned to one acr
# commit (see README's "Currently pinned"). Building acr-api from a DIFFERENT
# commit of the local dev-health-acr checkout is USUALLY fine, but a commit
# that has since added a new structure_needs.missing enum value (or any other
# additive contract change) makes this Workbench reject an otherwise-valid
# ACR response as `acr_contract_violation` -- observed live 2026-08-26 between
# main and the CHAOS-3927-era pin. Warn, don't block: most local iteration is
# unaffected.
PINNED_SHA="$(grep -oE 'Currently pinned: `[0-9a-f]{40}`' "$(dirname "${BASH_SOURCE[0]}")/../README.md" | grep -oE '[0-9a-f]{40}' || true)"
if [[ -n "$PINNED_SHA" ]] && command -v git >/dev/null && [[ -d "$DEV_HEALTH_ROOT/acr/.git" ]]; then
  LOCAL_SHA="$(git -C "$DEV_HEALTH_ROOT/acr" rev-parse HEAD 2>/dev/null || true)"
  if [[ -n "$LOCAL_SHA" && "$LOCAL_SHA" != "$PINNED_SHA" ]]; then
    note "WARNING: dev-health/acr is at $LOCAL_SHA, not this repo's pinned $PINNED_SHA."
    note "  A structure_needs value newer than the pin can surface as acr_contract_violation."
    note "  Fine for most questions; if you hit that failure, rebuild from the pinned commit."
  fi
fi

if ! docker image inspect dev-health-acr:dev >/dev/null 2>&1; then
  note "Building dev-health-acr:dev (one-time)..."
  docker build -t dev-health-acr:dev --target acr-api "$DEV_HEALTH_ROOT/acr"
fi

# --- acr schema (idempotent: acr-migrate only applies pending migrations) ---
note "Running acr-migrate..."
docker run --rm --network "$NETWORK" \
  -e ACR_ENVIRONMENT=development \
  -e ACR_POSTGRES_CONNECTION_KIND=direct \
  -e ACR_POSTGRES_MIGRATION_DSN="postgresql://devhealth:devhealth@postgres:5432/acr?sslmode=disable" \
  --entrypoint /usr/local/bin/acr-migrate \
  dev-health-acr:dev up

# --- FalkorDB (Context Fabric graph backend) ---
# Reused rather than recreated (unlike acr-api/acr-projector below): it takes
# no config from this script, so there is no stale-config risk, and
# recreating it would discard the standing graph for no reason. Same
# ownership check as the other two, though -- codex round 3 finding.
falkordb_image="$(docker inspect acr-dev-falkordb --format '{{.Config.Image}}' 2>/dev/null || true)"
if [[ -n "$falkordb_image" && "$falkordb_image" != "falkordb/falkordb@sha256:ad09d5051bbda1cfee8cef9d7f41ffe1bcb1c5327b82c442c989e84ab8cc33d3" ]]; then
  note "acr-dev-falkordb exists but is not our image ($falkordb_image) -- not touching it."
  note "  Remove it yourself if it's safe to: docker rm -f acr-dev-falkordb"
  exit 1
fi
if ! docker ps -q --filter "name=^acr-dev-falkordb$" | grep -q .; then
  if [[ -n "$falkordb_image" ]]; then
    note "Starting existing acr-dev-falkordb..."
    docker start acr-dev-falkordb >/dev/null
  else
    note "Creating acr-dev-falkordb..."
    docker run -d --name acr-dev-falkordb --network "$NETWORK" \
      falkordb/falkordb@sha256:ad09d5051bbda1cfee8cef9d7f41ffe1bcb1c5327b82c442c989e84ab8cc33d3 >/dev/null
  fi
fi

# --- acr-projector (projects real dev-health-ops data into the graph) ---
# Always stopped and recreated fresh, rather than reused: an already-running
# container from a PRIOR version of this script (a different model, a
# different secret mount, a different env var set entirely) would otherwise
# silently keep serving its stale config forever -- codex round 2 finding.
# Ownership check first: only remove a container by this name if it was
# actually built from OUR image -- never blind-remove a same-named container
# something else created (dev-launch.sh's own containers are the only thing
# that should ever be named acr-dev-*, but "should be" isn't "is").
existing_image="$(docker inspect acr-dev-acr-projector --format '{{.Config.Image}}' 2>/dev/null || true)"
if [[ -n "$existing_image" && "$existing_image" != "dev-health-acr:dev" ]]; then
  note "acr-dev-acr-projector exists but is not our image ($existing_image) -- not touching it."
  note "  Remove it yourself if it's safe to: docker rm -f acr-dev-acr-projector"
  exit 1
fi
if [[ -n "$existing_image" ]]; then
  docker rm -f acr-dev-acr-projector >/dev/null
  note "Recreating acr-dev-acr-projector for org $ORG_ID (picks up this run's config)..."
else
  note "Creating acr-dev-acr-projector for org $ORG_ID..."
fi
docker run -d --name acr-dev-acr-projector --network "$NETWORK" \
  -e ACR_ENVIRONMENT=development \
  -e ACR_REQUIRE_BACKING_STORES=true \
  -e ACR_POSTGRES_CONNECTION_KIND=direct \
  -e ACR_POSTGRES_DSN="postgresql://devhealth:devhealth@postgres:5432/acr?sslmode=disable" \
  -e ACR_CLICKHOUSE_DSN="clickhouse://ch:ch@clickhouse:9000/default" \
  -e ACR_CONTEXT_FABRIC_PROJECTION_ENABLED=true \
  -e ACR_CONTEXT_FABRIC_PROJECTOR_ORG_IDS="$ORG_ID" \
  -e ACR_CONTEXT_FABRIC_PROJECTION_POLL_INTERVAL=5s \
  -e ACR_CONTEXT_FABRIC_FALKOR_ADDR=acr-dev-falkordb:6379 \
  -e ACR_CONTEXT_FABRIC_FALKOR_TLS=false \
  -e ACR_CONTEXT_FABRIC_FALKOR_ALLOW_INSECURE=true \
  -e ACR_CONTEXT_FABRIC_FALKOR_GRAPH_PREFIX=acr-cf \
  --entrypoint /usr/local/bin/acr-projector \
  dev-health-acr:dev serve >/dev/null

# acr-api's own /readyz below only proves acr-api itself is up -- it says
# nothing about whether the projector is actually feeding the graph. A crash
# loop here would otherwise launch the Workbench silently against missing or
# stale graph data (codex round 3 finding). This is a liveness check, not a
# progress check: it does not prove the graph is fully caught up, only that
# the container didn't immediately die.
sleep 3
if [[ "$(docker inspect acr-dev-acr-projector --format '{{.State.Running}}' 2>/dev/null)" != "true" ]]; then
  note "acr-dev-acr-projector exited right after starting. Check: docker logs acr-dev-acr-projector"
  exit 1
fi

# --- acr-api (the Workbench's server hop talks to this) ---
# Same always-recreate discipline as acr-projector above: an already-running
# container from a PRIOR version of this script would otherwise silently
# keep serving a stale model/mount/env forever (codex round 2 finding).
existing_image="$(docker inspect acr-dev-acr-api --format '{{.Config.Image}}' 2>/dev/null || true)"
if [[ -n "$existing_image" && "$existing_image" != "dev-health-acr:dev" ]]; then
  note "acr-dev-acr-api exists but is not our image ($existing_image) -- not touching it."
  note "  Remove it yourself if it's safe to: docker rm -f acr-dev-acr-api"
  exit 1
fi
if [[ -n "$existing_image" ]]; then
  docker rm -f acr-dev-acr-api >/dev/null
  note "Recreating acr-dev-acr-api (picks up this run's config)..."
else
  note "Creating acr-dev-acr-api..."
fi
# Individual secret mounts, not the whole .acr-dev directory: acr-api only
# needs the evidence files and the PUBLIC jwks, not every file that happens
# to live alongside them (this dir also holds ca.key etc.).
#
# ACR_CONTEXT_FABRIC_MODEL_FALLBACK is deliberately UNSET: ACR rejects a
# fallback identical to the primary model (modelprovider config.go's own
# validate()), which a fresh acr-api would hit at startup and never become
# ready -- codex round 2 caught this. gpt-5.6-luna is the correct primary
# with no fallback post-CHAOS-3855 (see the model's own rejection message).
#
# ACR_WRITE_TIMEOUT=490s matches ACR_REQUEST_TIMEOUT below. Go's
# http.Server.WriteTimeout (this env var) defaults to 20s -- confirmed live
# 2026-08-26 as the actual mechanism behind "ACR could not be reached" on a
# slow (nano-era, 30-90s) investigation: the server forcibly closes the
# response write at 20s, mid-handler, while ACR's own app-level log still
# claims success (it measures handler duration, not the wire write outcome).
# Raising this let 6/6 deliberately-slow (nano) investigations succeed past
# the old 20s ceiling in the same session that found it.
docker run -d --name acr-dev-acr-api --network "$NETWORK" \
  -p 127.0.0.1:18080:8080 \
  -v "$ACR_DEV_SECRETS/evidence-kid:/secrets/evidence-kid:ro" \
  -v "$ACR_DEV_SECRETS/evidence-keys:/secrets/evidence-keys:ro" \
  -v "$ACR_DEV_SECRETS/web-jwks.json:/secrets/web-jwks.json:ro" \
  -e ACR_ENVIRONMENT=development \
  -e ACR_ADDR=:8080 \
  -e ACR_WRITE_TIMEOUT=490s \
  -e ACR_REQUIRE_BACKING_STORES=true \
  -e ACR_POSTGRES_CONNECTION_KIND=direct \
  -e ACR_POSTGRES_DSN="postgresql://devhealth:devhealth@postgres:5432/acr?sslmode=disable" \
  -e ACR_CLICKHOUSE_DSN="clickhouse://ch:ch@clickhouse:9000/default" \
  -e ACR_EVIDENCE_ID_ACTIVE_KID_FILE=/secrets/evidence-kid \
  -e ACR_EVIDENCE_ID_KEYS_FILE=/secrets/evidence-keys \
  -e ACR_WEB_ASSERTION_ISSUER=dev-health-web \
  -e ACR_WEB_ASSERTION_AUDIENCE=dev-health-acr \
  -e ACR_WEB_ASSERTION_JWKS_FILE=/secrets/web-jwks.json \
  -e ACR_DEVICE_VERIFICATION_URL=http://localhost:3000/acr/device \
  -e ACR_REQUEST_TIMEOUT=490s \
  -e ACR_CONTEXT_FABRIC_GRAPH_READS_ENABLED=true \
  -e ACR_CONTEXT_FABRIC_GRAPH_LIFECYCLE_ENABLED=false \
  -e ACR_CONTEXT_FABRIC_FALKOR_ADDR=acr-dev-falkordb:6379 \
  -e ACR_CONTEXT_FABRIC_FALKOR_TLS=false \
  -e ACR_CONTEXT_FABRIC_FALKOR_ALLOW_INSECURE=true \
  -e ACR_CONTEXT_FABRIC_FALKOR_GRAPH_PREFIX=acr-cf \
  -e ACR_CONTEXT_FABRIC_MODEL_PROVIDER=openai \
  -e ACR_CONTEXT_FABRIC_MODEL=gpt-5.6-luna \
  -e ACR_CONTEXT_FABRIC_MODEL_API_KEY="${OPENAI_API_KEY:-}" \
  dev-health-acr:dev serve >/dev/null

note "Waiting for acr-api readiness on http://127.0.0.1:18080 ..."
acr_ready=false
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:18080/readyz >/dev/null 2>&1; then
    note "acr-api ready."
    acr_ready=true
    break
  fi
  sleep 1
done
if [[ "$acr_ready" != "true" ]]; then
  note "acr-api never became ready after 30s. Not launching the Workbench against a"
  note "  dead backend. Check: docker logs acr-dev-acr-api"
  exit 1
fi

# .env.local is fully owned and regenerated by THIS script every run --
# deliberately, not an oversight (codex round 3 flagged the full-replace as
# a P2 without that context). If you've hand-added unrelated local overrides
# to this file, move them to a `.env.local.d`-style separate mechanism this
# script doesn't touch, or expect them to be gone on the next launch.
ENV_LOCAL="$(dirname "${BASH_SOURCE[0]}")/../.env.local"
if [[ -L "$ENV_LOCAL" ]]; then
  note "$ENV_LOCAL is a symlink -- refusing to overwrite it."
  exit 1
fi
ENV_LOCAL_TMP="$(mktemp "${ENV_LOCAL}.XXXXXX")"
# printf, not a heredoc: Homebrew's bash 5.3.15 (whatever `env bash` resolves
# to on this host) deadlocks on small heredocs/here-strings -- reproduced
# live 2026-08-26, this exact step hung indefinitely. A previously-known
# issue on this host (see repo memory), not specific to this script, but a
# heredoc here would hit it every single launch.
{
  printf 'ACR_API_ORIGIN=http://127.0.0.1:18080\n'
  printf 'ACR_ORG_ID=%s\n' "$ORG_ID"
  printf 'ACR_WEB_ASSERTION_KEY_FILE=%s/web-assertion.key\n' "$ACR_DEV_SECRETS"
  printf 'ACR_REPOSITORY_SCOPES=%s\n' "$REPO_SCOPES"
  printf 'ACR_WEB_ASSERTION_ISSUER=dev-health-web\n'
  printf 'ACR_WEB_ASSERTION_AUDIENCE=dev-health-acr\n'
  printf 'ACR_WEB_ASSERTION_KID=acr-dev-web\n'
  # Matches the server's ACR_REQUEST_TIMEOUT=490s below -- without this the
  # Workbench's own 120s default can report "timeout" while ACR is still
  # genuinely working.
  printf 'ACR_TIMEOUT_MS=490000\n'
} > "$ENV_LOCAL_TMP"
mv "$ENV_LOCAL_TMP" "$ENV_LOCAL"

# Port 3000 is held by the dev-health stack's own traefik (dev-health-web).
# Run the Workbench on 3100 to avoid the collision.
PORT="${ASK_DEV_PORT:-3100}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# `next dev`'s Turbopack HMR websocket failed to handshake in this
# environment (repeatable: every reconnect gets ERR_INVALID_HTTP_RESPONSE),
# which in turn caused the page to lose in-progress composer state on the
# reconnect-retry cadence. Root cause not yet isolated (reproduces across
# Node 22 and Node 26). `next start` (a real build) sidesteps it entirely and
# is what this script runs. If you want dev-mode live-reload instead, run
# `pnpm dev` yourself and expect the composer to occasionally eat your input.
note "Building (next start needs a build)..."
pnpm build
note "Launching the Workbench: http://127.0.0.1:$PORT"
# -H 127.0.0.1: `next start` defaults to 0.0.0.0 (LAN-reachable) otherwise --
# this route holds the ACR signing key and has no auth of its own, so it
# must not be reachable from other machines on the network.
exec pnpm exec next start -p "$PORT" -H 127.0.0.1
