#!/usr/bin/env bash
# Runs the React (create-react-app) dev server, pointed at the local API.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export PORT="${FRONTEND_PORT:-3000}"
export BROWSER=none
export REACT_APP_API_URL="${REACT_APP_API_URL:-http://localhost:3001}"

exec npx react-scripts start
