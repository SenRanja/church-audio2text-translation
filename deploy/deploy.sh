#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPO_DIR="${REPO_DIR:-/opt/church-translation/repo}"
readonly DEPLOY_ENV="${DEPLOY_ENV:-/etc/church-translation/deploy.env}"
readonly REVISION_FILE="${REVISION_FILE:-/var/lib/church-translation/current-revision}"
readonly DEPLOY_BRANCH="${DEPLOY_BRANCH:-deploy/production}"
readonly LOCK_FILE="${LOCK_FILE:-/run/lock/church-translation-deploy.lock}"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

cd "$REPO_DIR"
git fetch --quiet origin "$DEPLOY_BRANCH"
target_revision="$(git rev-parse FETCH_HEAD)"
current_revision="$(cat "$REVISION_FILE" 2>/dev/null || true)"

container_id="$(docker compose --env-file "$DEPLOY_ENV" ps -q church-translation 2>/dev/null || true)"
container_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
if [[ "$target_revision" == "$current_revision" && "$container_health" == "healthy" ]]; then
  exit 0
fi

git checkout --quiet --force -B "$DEPLOY_BRANCH" "$target_revision"

export IMAGE_TAG="$target_revision"
export VCS_REF="$target_revision"
docker compose --env-file "$DEPLOY_ENV" build --pull church-translation
docker compose --env-file "$DEPLOY_ENV" up -d --no-build church-translation

healthy=false
for _ in {1..30}; do
  container_id="$(docker compose --env-file "$DEPLOY_ENV" ps -q church-translation)"
  container_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  if [[ "$container_health" == "healthy" ]]; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "$healthy" != "true" ]]; then
  docker compose --env-file "$DEPLOY_ENV" logs --tail=100 church-translation >&2 || true
  if [[ -n "$current_revision" ]] && docker image inspect "church-translation:$current_revision" >/dev/null 2>&1; then
    export IMAGE_TAG="$current_revision"
    docker compose --env-file "$DEPLOY_ENV" up -d --no-build church-translation
  fi
  exit 1
fi

install -d -m 0755 "$(dirname "$REVISION_FILE")"
printf '%s\n' "$target_revision" >"$REVISION_FILE"

while read -r image_id revision; do
  [[ -n "$image_id" ]] || continue
  if [[ "$revision" != "$target_revision" && "$revision" != "$current_revision" ]]; then
    docker image rm "$image_id" >/dev/null 2>&1 || true
  fi
done < <(
  docker image ls --filter label=org.opencontainers.image.title=church-translation --format '{{.ID}}' |
    sort -u |
    while read -r image_id; do
      printf '%s %s\n' "$image_id" "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id")"
    done
)

docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null