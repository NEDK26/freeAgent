export const catalog = [
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    url: "https://dash.cloudflare.com/",
    docs: "https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/",
    pricing: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    details: "API 可用；免费计划每天 10,000 Neurons，北京时间 08:00 刷新（非 Token 数）。gpt-oss-20b 支持工具调用；部分模型需要付费。免费计划超额后请求失败；付费计划超额可能收费。需要账号、API Token 和 Account ID。地区与注册限制以厂商为准。2026-11-15 核实。",
    setup: "打开官方控制台自行注册、创建 API Token；按 README 设置环境变量后重启 Pi，再用 /model 选择 freepool-cloudflare 模型。",
  },
  {
    id: "gemini",
    name: "Google Gemini API",
    url: "https://aistudio.google.com/",
    docs: "https://ai.google.dev/gemini-api/docs/api-key",
    pricing: "https://ai.google.dev/gemini-api/docs/pricing",
    details: "API 可用；部分模型提供免费层，额度和速率依模型及地区而异。免费层内容可能用于改进产品；计费和超额行为以账号及厂商规则为准。需要可用地区的 Google 账号和 API Key。2026-11-15 核实。",
    setup: "打开 Google AI Studio 自行创建 API Key；在 Pi 中使用 /login 选择 Google 或配置对应环境变量，再用 /model 选择支持免费层的模型。",
  },
];
