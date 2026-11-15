# Pi 免费模型助手

在 Pi 中查看免费 API 入口、维护个人模型池，并在可重试故障发生时按顺序尝试备用模型。额度仍属于各服务商；本项目不会自动注册或签到。

## 启动

需要 Pi 1.5.2 和 Node.js 22.19 或更新版本。进入本目录运行：

```sh
cd ~/Desktop/freeAgent
pi -e ./extensions/index.ts
```

在 Pi 里输入 `/free-models` 查看目录、打开官方领取页面及管理模型池。先自行领取额度并在 Pi 配置模型，再按顺序添加到额度池。模型列表来自 Pi 已配置凭证的模型，添加前需要自行确认其免费资格和超额计费规则。

## 接入 CLIProxyAPI

插件是 Pi 的入口；CLIProxyAPI 是需要单独安装、配置和启动的本地代理服务，负责其自身支持的上游管理和路由。本插件不安装或启动 CLIProxyAPI，也不会自动配置上游。按照 [CLIProxyAPI 官方项目](https://github.com/router-for-me/CLIProxyAPI) 启动服务、设置本地客户端 API Key，并配置至少一个已获得额度的上游；建议只监听 `127.0.0.1`。模型、账号和切换规则在 CLIProxyAPI 中设置。

本项目当前工作区已准备 CLIProxyAPI 8.0.72 macOS Apple Silicon 发行包及仅监听本机的配置，文件在 Git 忽略的 `.local/cliproxy/`。启动代理：

```sh
sh scripts/start-cliproxy.sh
```

配置 Cloudflare 上游需要先在 [Workers AI 控制台](https://dash.cloudflare.com/?to=/:account/ai/workers-ai) 创建 Workers AI API Token、获取 Account ID。然后在另一终端运行：

```sh
bash scripts/configure-cloudflare.sh
```

脚本会在终端隐藏 Token 输入，并将其以明文保存在权限为 600 的 `.local/cliproxy/config.json`；该目录不会提交到 Git。随后启动或重启代理，在另一终端执行：

```sh
sh scripts/pi-cliproxy.sh freeagent-cloudflare
```

此项目内安装文件不会随 GitHub 仓库上传；其他机器需自行安装 CLIProxyAPI 并参考下方环境变量配置。

在启动 Pi 的终端设置下列变量，`CLIPROXY_API_KEY` 是 CLIProxyAPI 配置里的**客户端密钥**，不是上游厂商密钥；`CLIPROXY_MODEL` 必须是代理 `/v1/models` 实际列出的模型 ID 或别名。不要把密钥发到聊天或提交仓库。

```sh
export CLIPROXY_API_KEY='你的代理客户端密钥'
export CLIPROXY_MODEL='代理中已配置的模型ID或别名'
# 默认为 http://127.0.0.1:8317/v1；端口不同时自行设置
export CLIPROXY_BASE_URL='http://127.0.0.1:8317/v1'
cd ~/Desktop/freeAgent
pi -e ./extensions/index.ts
```

在 Pi 中使用 `/model` 选择 `cliproxy/模型ID`；`/free-models` 可查看接入状态或对模型进行工具调用验证。服务未启动、上游未配置、密钥错误或模型 ID 不存在时不能使用。注册时的 8192 上下文、2048 输出上限只是保守的占位值，实际模型能力和价格需以服务商为准；Pi 显示的零成本元数据不能证明免费。通过代理管理候选和自动切换时，应避免同时依赖插件的另一套回退链产生重复尝试。

本接入尚未用真实 CLIProxyAPI 和厂商凭证完成端到端验证；不代表所有模型支持工具调用、流式响应或跨模型切换。

使用 `/model` 选择池中的模型；池里至少有两个模型才启用自动回退。`/fallback-status` 显示回退状态。池保存在当前工作目录的 `.pi/free-model-pool.json`，仅记录模型名称，不保存密钥。

## Cloudflare Workers AI 接入

1. 打开 `/free-models` 中的 Workers AI 控制台入口，自行注册或登录。每天的免费额度自动提供，无需签到或单独领取。在 Workers AI 页面选择 “Use REST API”，创建 Workers AI API Token 并取得 Account ID。参见 [官方步骤](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)。
2. 在启动 Pi 的终端设置环境变量（替换为自己的值，不要粘贴到聊天或提交到仓库）：

   ```sh
   export CLOUDFLARE_ACCOUNT_ID='你的账号 ID'
   export CLOUDFLARE_API_TOKEN='你的 API Token'
   pi -e ./extensions/index.ts
   ```

3. 插件会注册 `freepool-cloudflare/@cf/openai/gpt-oss-20b`。在 `/model` 中选择它；再通过 `/free-models` 加入额度池。
4. 在 `/free-models` 中选择“验证池中模型”，插件会在确认后发送两次请求，验证模型响应及无副作用的工具调用往返。该模型的工具调用能力见 [Cloudflare 文档](https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/)；本项目尚未使用真实账号验证端到端兼容性。验证记录是历史结果，不能保证当前凭证和额度仍可用。

此模型已列出公开按量价格，免费计划每日额度用完后停止；付费计划可能继续收费。以 [Cloudflare 定价](https://developers.cloudflare.com/workers-ai/platform/pricing/) 和账户实际配置为准。

## 切换限制

自动切换复用 MIT 许可的 [pi-auto-fallback](https://github.com/mengcody/pi-auto-fallback)，源码与许可证在 `vendor/pi-auto-fallback/`，来源提交 `495d3426c7068e5bb7150aaf6e600551018cdae6`。它先等待 Pi 自身重试；对于可识别的限流或临时错误，再切换到链中的下一个模型。出现已执行工具的请求时，默认停止自动重放，避免重复执行。并非每个厂商的额度错误都会触发切换，也不保证实时余额、任务不中断或零费用。

上游声明兼容 Pi 小于 1.0；本项目已在 1.5.2 做本地加载和模拟测试，但尚未完成真实服务商端到端验证。请勿同时加载独立的 pi-auto-fallback 扩展，以免重复处理。
