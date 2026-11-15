#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec ./.local/cliproxy/cli-proxy-api -local-model -config "$PWD/.local/cliproxy/config.json"
