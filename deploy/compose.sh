#!/bin/sh
# Wrapper so compose always reads the right settings file: ./deploy/compose.sh up -d --build
# Uses the repo-root .env, or MONO_ENV_FILE when set (a test stack with its own settings).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The commit being built, so /api/health can say which version is running.
APP_VERSION="${APP_VERSION:-$(git -C "$ROOT" describe --always --dirty 2>/dev/null || echo unknown)}"
export APP_VERSION
exec docker compose --env-file "${MONO_ENV_FILE:-$ROOT/.env}" -f "$ROOT/deploy/docker-compose.yml" "$@"
