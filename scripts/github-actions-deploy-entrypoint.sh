#!/usr/bin/env bash
set -euo pipefail

repo_dir="$HOME/migrated-compose/sverigeklattraren/repository"

case "${SSH_ORIGINAL_COMMAND:-}" in
  verify)
    exec curl --fail --silent http://127.0.0.1:3086/
    ;;
  deploy\ ghcr.io/nicemd/sverigeklattraren:[0-9a-f]*)
    image_ref="${SSH_ORIGINAL_COMMAND#deploy }"
    if [[ ! "$image_ref" =~ ^ghcr\.io/nicemd/sverigeklattraren:[0-9a-f]{40}$ ]]; then
      echo "Ogiltig image-referens." >&2
      exit 2
    fi
    cd "$repo_dir"
    if [[ -n "$(git status --porcelain)" ]] || [[ "$(git rev-list --count origin/main..main)" != "0" ]]; then
      echo "Serverrepot är inte rent och fast-forwardbart." >&2
      exit 3
    fi
    git fetch origin main
    git checkout main
    git pull --ff-only origin main
    exec bash "$repo_dir/scripts/deploy-from-main.sh" "$image_ref"
    ;;
  *)
    echo "Den här nyckeln får endast deploya Sverigeklättraren." >&2
    exit 126
    ;;
esac
