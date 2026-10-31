#!/bin/sh
# Wrapper so compose always reads the repo-root .env: ./deploy/compose.sh up -d --build
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec docker compose --env-file "$ROOT/.env" -f "$ROOT/deploy/docker-compose.yml" "$@"
