#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$#" -ne 1 ]; then
  printf '%s\n' '用法：sh scripts/pi-cliproxy.sh 代理模型ID' >&2
  exit 2
fi
export CLIPROXY_MODEL="$1"
export CLIPROXY_API_KEY="$(node -p 'JSON.parse(require("node:fs").readFileSync(".local/cliproxy/config.json", "utf8")).access["api-keys"][0]')"
exec pi -e ./extensions/index.ts --model "cliproxy/$CLIPROXY_MODEL"
