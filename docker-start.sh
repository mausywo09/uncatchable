#!/bin/sh
# Runs the launch API and nginx side by side. If either one stops, the container exits so Coolify restarts it.
set -u

su-exec nginx node /srv/uncatchable/server/api.mjs &
API=$!
/docker-entrypoint.sh nginx -g 'daemon off;' &
WEB=$!

stop() {
  kill -TERM "$API" "$WEB" 2>/dev/null
  wait
  exit 0
}
trap stop TERM INT

while kill -0 "$API" 2>/dev/null && kill -0 "$WEB" 2>/dev/null; do
  sleep 2 &
  wait $!
done
echo "uncatchable: a process stopped (api or nginx); exiting so the container restarts" >&2
kill -TERM "$API" "$WEB" 2>/dev/null
wait
exit 1
