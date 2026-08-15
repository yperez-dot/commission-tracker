#!/usr/bin/env bash
# Runs the Express API. Dev-only defaults are used unless overridden by real
# secrets/env vars (e.g. ANTHROPIC_API_KEY for AI parsing, or a real NOTION_TOKEN).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export NODE_ENV="${NODE_ENV:-development}"
export PORT="${PORT:-3001}"
export DATABASE_URL="${DATABASE_URL:-postgres://postgres@localhost:5432/olicomm}"
export JWT_SECRET="${JWT_SECRET:-dev-secret-local}"
# Dev seed passwords so the two admin accounts can be used locally.
export SEED_PASSWORD_YAHOSKA="${SEED_PASSWORD_YAHOSKA:-devpass123}"
export SEED_PASSWORD_KATY="${SEED_PASSWORD_KATY:-devpass123}"
# Placeholder so the optional Notion sales-tracker route can load. Replace with a
# real NOTION_TOKEN secret only if you need the Notion integration.
export NOTION_TOKEN="${NOTION_TOKEN:-dev-placeholder}"

exec node server.js
