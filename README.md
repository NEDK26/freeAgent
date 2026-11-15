# Pi 免费模型助手

在 Pi 中查看免费 API 入口、维护个人模型池，并在可重试故障发生时按顺序尝试备用模型。额度仍属于各服务商；本项目不会自动注册或签到。

## 启动

需要 Pi 1.5.2 和 Node.js 22.19 或更新版本。进入本目录运行：

```sh
cd ~/Desktop/freeAgent
pi -e ./extensions/index.ts
```

在 Pi 里输入 `/free-models` 查看目录、打开官方领取页面及管理模型池。先自行领取额度并在 Pi 配置模型，再按顺序添加到额度池。模型列表来自 Pi 已配置凭证的模型，添加前需要自行确认其免费资格和超额计费规则。

使用 `/model` 选择池中的模型；池里至少有两个模型才启用自动回退。`/fallback-status` 显示回退状态。池保存在当前工作目录的 `.pi/free-model-pool.json`，仅记录模型名称，不保存密钥。

## Cloudflare Workers AI 接入

1. 打开 `/free-models` 中的 Cloudflare 控制台入口，自行注册并创建 Workers AI API Token，取得 Account ID。参见 [官方步骤](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)。
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
