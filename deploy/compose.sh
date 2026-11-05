#!/bin/sh
# Wrapper so compose always reads the right settings file: ./deploy/compose.sh up -d --build
# Uses the repo-root .env, or MONO_ENV_FILE when set (a test stack with its own settings).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec docker compose --env-file "${MONO_ENV_FILE:-$ROOT/.env}" -f "$ROOT/deploy/docker-compose.yml" "$@"
