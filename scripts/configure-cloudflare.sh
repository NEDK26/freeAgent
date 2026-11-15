#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
printf '%s\n' '此操作会将 Cloudflare API Token 保存在 .local/cliproxy/config.json（本机明文，权限 600，已加入 Git 忽略）。'
read -r -p 'Cloudflare Account ID: ' account
read -r -s -p 'Cloudflare Workers AI API Token（输入不显示）: ' token
printf '\n'
if [[ -z "$account" || -z "$token" ]]; then
  printf '%s\n' 'Account ID 和 API Token 均不能为空。' >&2
  exit 1
fi
export FREEAGENT_CF_ACCOUNT="$account" FREEAGENT_CF_TOKEN="$token"
node --input-type=module -e '
import fs from "node:fs";
const file = ".local/cliproxy/config.json";
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config["api-keys"] ??= {};
const providers = config["api-keys"]["openai-compatibility"] ?? [];
const provider = {
  name: "freeagent-cloudflare",
  "base-url": `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.FREEAGENT_CF_ACCOUNT)}/ai/v1`,
  keys: [{ "api-key": process.env.FREEAGENT_CF_TOKEN }],
  models: [{ name: "@cf/openai/gpt-oss-20b", alias: "freeagent-cloudflare" }],
};
config["api-keys"]["openai-compatibility"] = [...providers.filter(p => p.name !== provider.name), provider];
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
'
unset FREEAGENT_CF_ACCOUNT FREEAGENT_CF_TOKEN account token
printf '%s\n' 'Cloudflare 已写入本地代理配置。启动或重启代理后，使用 sh scripts/pi-cliproxy.sh freeagent-cloudflare。'
