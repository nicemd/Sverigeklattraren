#!/usr/bin/env bash
set -euo pipefail

app_dir="${APP_DIR:-$HOME/migrated-compose/sverigeklattraren}"
repo_dir="$app_dir/repository"
published_dir="$app_dir/published"
releases_dir="$published_dir/releases"
state_dir="$published_dir/state"
current_link="$published_dir/current"
env_file="$app_dir/.env"
compose_file="$app_dir/docker-compose.yml"
image_repo="ghcr.io/nicemd/sverigeklattraren-app"

test -d "$repo_dir/.git"
test -f "$env_file"
mkdir -p "$releases_dir" "$state_dir"

exec 9>"$app_dir/publish-main.lock"
if ! flock -n 9; then
  echo "En publicering kör redan."
  exit 0
fi

cd "$repo_dir"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Serverrepot har lokala ändringar; publiceringen avbryts." >&2
  exit 3
fi

git fetch --quiet origin main
target_sha="$(git rev-parse origin/main)"
published_sha="$(cat "$state_dir/published-sha" 2>/dev/null || true)"
app_sha="$(cat "$state_dir/app-sha" 2>/dev/null || true)"

if [[ -z "$app_sha" ]]; then
  local_sha="$(git rev-parse main)"
  if curl --fail --silent http://127.0.0.1:3086/ >/dev/null; then
    app_sha="$local_sha"
    printf '%s\n' "$app_sha" > "$state_dir/app-sha"
    echo "Befintlig frisk container registrerad på $app_sha."
  else
    echo "Kan inte fastställa befintlig appversion utan frisk container." >&2
    exit 4
  fi
fi

if [[ "$published_sha" == "$target_sha" && "$app_sha" == "$target_sha" ]]; then
  exit 0
fi

app_changed=false
while IFS= read -r changed_path; do
  case "$changed_path" in
    web/tests/*)
      ;;
    web/*|Dockerfile|docker-compose.yml|.dockerignore)
      app_changed=true
      break
      ;;
  esac
done < <(git diff --name-only "$app_sha" "$target_sha" --)

static_changed=false
if [[ -z "$published_sha" || ! -e "$current_link/content/areas.json" ]]; then
  static_changed=true
else
  while IFS= read -r changed_path; do
    case "$changed_path" in
      content/*)
        static_changed=true
        break
        ;;
    esac
  done < <(git diff --name-only "$published_sha" "$target_sha" --)
fi

image_ref="$image_repo:$target_sha"
if [[ "$app_changed" == true ]]; then
  if ! sudo docker pull "$image_ref" >/dev/null; then
    echo "App-imagen $image_ref är inte färdig ännu; försöker igen vid nästa intervall."
    exit 0
  fi
fi

old_link="$(readlink "$current_link" 2>/dev/null || true)"
release_tmp=""
cleanup() {
  if [[ -n "$release_tmp" ]]; then
    case "$release_tmp" in
      "$releases_dir"/[0-9a-f]*.tmp.*) rm -rf -- "$release_tmp" ;;
    esac
  fi
}
trap cleanup EXIT

if [[ "$static_changed" == true ]]; then
  release_dir="$releases_dir/$target_sha"
  if [[ ! -e "$release_dir/content/areas.json" ]]; then
    release_tmp="$releases_dir/$target_sha.tmp.$$"
    mkdir "$release_tmp"
    git archive "$target_sha" content | tar -x -C "$release_tmp"
    test -s "$release_tmp/content/areas.json"
    printf '%s\n' "$target_sha" > "$release_tmp/REVISION"
    mv "$release_tmp" "$release_dir"
    release_tmp=""
  fi
  next_link="$published_dir/current.next"
  rm -f "$next_link"
  ln -s "releases/$target_sha" "$next_link"
  mv -Tf "$next_link" "$current_link"
fi

rollback_app() {
  echo "Appdeploy misslyckades; återställer föregående compose och content-länk." >&2
  if [[ -n "$old_link" ]]; then
    rollback_link="$published_dir/current.rollback"
    rm -f "$rollback_link"
    ln -s "$old_link" "$rollback_link"
    mv -Tf "$rollback_link" "$current_link"
  fi
  if [[ -f "$env_file.previous" && -f "$compose_file.previous" ]]; then
    cp "$env_file.previous" "$env_file"
    cp "$compose_file.previous" "$compose_file"
    chmod 600 "$env_file"
    cd "$app_dir"
    sudo docker-compose up -d --force-recreate --no-build || true
  fi
}

if [[ "$app_changed" == true ]]; then
  cp "$env_file" "$env_file.previous"
  cp "$compose_file" "$compose_file.previous"
  git show "$target_sha:docker-compose.yml" > "$compose_file.next"
  mv "$compose_file.next" "$compose_file"
  awk -v image="$image_ref" '
    BEGIN { replaced = 0 }
    /^GHCR_IMAGE=/ { print "GHCR_IMAGE=" image; replaced = 1; next }
    { print }
    END { if (!replaced) print "GHCR_IMAGE=" image }
  ' "$env_file" > "$env_file.next"
  chmod 600 "$env_file.next"
  mv "$env_file.next" "$env_file"

  cd "$app_dir"
  if ! sudo docker-compose up -d --force-recreate --no-build; then
    rollback_app
    exit 5
  fi
  healthy=false
  for _ in $(seq 1 30); do
    if curl --fail --silent http://127.0.0.1:3086/ >/dev/null; then
      healthy=true
      break
    fi
    sleep 2
  done
  if [[ "$healthy" != true ]]; then
    rollback_app
    exit 6
  fi
  printf '%s\n' "$target_sha" > "$state_dir/app-sha"
fi

cd "$repo_dir"
git checkout --quiet main
git merge --ff-only --quiet "$target_sha"
printf '%s\n' "$target_sha" > "$state_dir/published-sha"
printf '%s\n' "$target_sha" > "$state_dir/app-sha"

if [[ -f "$repo_dir/scripts/publish-main.sh" ]]; then
  install -m 700 "$repo_dir/scripts/publish-main.sh" "$app_dir/publish-main.sh.next"
  mv "$app_dir/publish-main.sh.next" "$app_dir/publish-main.sh"
fi

echo "Main $target_sha publicerad. app_changed=$app_changed static_changed=$static_changed"
