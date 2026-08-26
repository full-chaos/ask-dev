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
# Known issue (2026-08-26): investigations intermittently come back as
# "ACR could not be reached" / acr_unreachable even though ACR itself
# completed the work (visible in `docker logs acr-dev-acr-api`) -- a
# connection drop between this server and acr-api across the Docker
# port-forward, not yet root-caused. Just click Ask again; it usually
# succeeds within a retry or two. See the UX walkthrough report for detail.
#
# Usage: bash scripts/dev-launch.sh
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

if [[ ! -f "$ACR_DEV_SECRETS/web-assertion.key" ]]; then
  note "Missing $ACR_DEV_SECRETS/web-assertion.key -- see this script's header comment."
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
if ! docker ps -q --filter "name=^acr-dev-falkordb$" | grep -q .; then
  if docker ps -aq --filter "name=^acr-dev-falkordb$" | grep -q .; then
    note "Starting existing acr-dev-falkordb..."
    docker start acr-dev-falkordb >/dev/null
  else
    note "Creating acr-dev-falkordb..."
    docker run -d --name acr-dev-falkordb --network "$NETWORK" \
      falkordb/falkordb@sha256:ad09d5051bbda1cfee8cef9d7f41ffe1bcb1c5327b82c442c989e84ab8cc33d3 >/dev/null
  fi
fi

# --- acr-projector (projects real dev-health-ops data into the graph) ---
if ! docker ps -q --filter "name=^acr-dev-acr-projector$" | grep -q .; then
  docker rm -f acr-dev-acr-projector >/dev/null 2>&1 || true
  note "Starting acr-dev-acr-projector for org $ORG_ID..."
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
fi

# --- acr-api (the Workbench's server hop talks to this) ---
if ! docker ps -q --filter "name=^acr-dev-acr-api$" | grep -q .; then
  if docker ps -aq --filter "name=^acr-dev-acr-api$" | grep -q .; then
    note "Starting existing acr-dev-acr-api..."
    docker start acr-dev-acr-api >/dev/null
  else
    note "Creating acr-dev-acr-api..."
    docker run -d --name acr-dev-acr-api --network "$NETWORK" \
      -p 127.0.0.1:18080:8080 \
      -v "$ACR_DEV_SECRETS:/secrets:ro" \
      -e ACR_ENVIRONMENT=development \
      -e ACR_ADDR=:8080 \
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
      -e ACR_CONTEXT_FABRIC_MODEL=gpt-5-nano \
      -e ACR_CONTEXT_FABRIC_MODEL_FALLBACK=gpt-5.6-luna \
      -e ACR_CONTEXT_FABRIC_MODEL_API_KEY="${OPENAI_API_KEY:-}" \
      dev-health-acr:dev serve >/dev/null
  fi
fi

note "Waiting for acr-api readiness on http://127.0.0.1:18080 ..."
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:18080/readyz >/dev/null 2>&1; then
    note "acr-api ready."
    break
  fi
  sleep 1
done

cat > "$(dirname "${BASH_SOURCE[0]}")/../.env.local" <<EOF
ACR_API_ORIGIN=http://127.0.0.1:18080
ACR_ORG_ID=$ORG_ID
ACR_WEB_ASSERTION_KEY_FILE=$ACR_DEV_SECRETS/web-assertion.key
ACR_REPOSITORY_SCOPES=$REPO_SCOPES
ACR_WEB_ASSERTION_ISSUER=dev-health-web
ACR_WEB_ASSERTION_AUDIENCE=dev-health-acr
ACR_WEB_ASSERTION_KID=acr-dev-web
EOF

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
exec pnpm exec next start -p "$PORT"
