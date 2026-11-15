import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { catalog } from "./catalog.ts";
import { normalizeConfig, registerAutoFallback } from "../vendor/pi-auto-fallback/index.ts";

const poolPath = join(process.cwd(), ".pi", "free-model-pool.json");
const verifiedPath = join(process.cwd(), ".pi", "free-model-pool-verified.json");

function getVerified(): Record<string, string> {
  try { return JSON.parse(readFileSync(verifiedPath, "utf8")); }
  catch { return {}; }
}

function readPool(): string[] {
  if (!existsSync(poolPath)) return [];
  const data = JSON.parse(readFileSync(poolPath, "utf8"));
  if (!Array.isArray(data.models) || data.models.some((v: unknown) => typeof v !== "string" || !/^[^/]+\/.+/.test(v))) {
    throw new Error("额度池配置无效：models 必须是 provider/model 字符串数组");
  }
  if (new Set(data.models).size !== data.models.length) throw new Error("额度池配置含重复模型");
  return data.models;
}

function savePool(models: string[]) {
  mkdirSync(join(process.cwd(), ".pi"), { recursive: true });
  writeFileSync(poolPath, JSON.stringify({ models }, null, 2) + "\n", { mode: 0o600 });
}

function getPool(ctx: ExtensionContext): string[] | undefined {
  try { return readPool(); }
  catch (error) { ctx.ui.notify(`读取额度池失败：${String(error)}`, "error"); return undefined; }
}

export default function (pi: ExtensionAPI) {
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    pi.registerProvider("freepool-cloudflare", {
      name: "Cloudflare Workers AI",
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/ai/v1`,
      apiKey: "$CLOUDFLARE_API_TOKEN",
      api: "openai-completions",
      authHeader: true,
      models: [{
        id: "@cf/openai/gpt-oss-20b",
        name: "Cloudflare GPT-OSS 20B",
        input: ["text"],
        reasoning: false,
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0.2, output: 0.3, cacheRead: 0, cacheWrite: 0 },
      }],
    });
  }
  let initial: string[] = [];
  try { initial = readPool(); }
  catch (error) { console.error(`[free-models] ${String(error)}；自动切换已关闭`); }
  registerAutoFallback(pi, normalizeConfig({
    enabled: initial.length >= 2,
    chains: initial.length >= 2 ? [{ name: "free-pool", models: initial }] : [],
    maxFailoversPerRequest: Math.min(Math.max(initial.length - 1, 0), 20),
    requireNoToolCalls: true,
    notify: true,
  }));

  pi.registerCommand("free-models", {
    description: "免费模型目录与个人额度池",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const choice = await ctx.ui.select("免费模型助手", ["查看领取目录", "查看额度池", "添加模型到额度池", "验证池中模型", "移除池中模型", "使用说明"]);
      if (choice === "查看领取目录") {
        const selected = await ctx.ui.select("选择服务（领取由你自行完成）", catalog.map((item) => item.name));
        const item = catalog.find((entry) => entry.name === selected);
        if (!item) return;
        const action = await ctx.ui.select(`${item.name}\n${item.details}\n${item.setup}\n文档：${item.docs}\n价格：${item.pricing}`, ["打开官方领取页面", "返回"]);
        if (action === "打开官方领取页面") {
          const command = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;
          if (!command) { ctx.ui.notify(`请手动打开：${item.url}`, "info"); return; }
          try {
            const result = await pi.exec(command, [item.url]);
            if (result.code !== 0) ctx.ui.notify(`无法打开浏览器，请手动访问：${item.url}`, "warning");
          } catch { ctx.ui.notify(`无法打开浏览器，请手动访问：${item.url}`, "warning"); }
        }
      } else if (choice === "查看额度池") {
        const models = getPool(ctx); if (!models) return;
        const available = new Set(ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`));
        const verified = getVerified();
        ctx.ui.notify(models.length ? models.map((m, i) => `${i + 1}. ${m}：${available.has(m) ? (verified[m] ? `已验证（${verified[m]}）` : "凭证已配置，尚未验证") : "未检测到可用凭证或模型"}；余额未知`).join("\n") : "额度池为空。先按领取目录配置模型，再添加到池中。", "info");
      } else if (choice === "添加模型到额度池") {
        const models = getPool(ctx); if (!models) return;
        const options = ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`).filter((key) => !models.includes(key));
        if (!options.length) { ctx.ui.notify("未发现可添加模型。请先使用 /login 或 models.json 配置。", "warning"); return; }
        const selected = await ctx.ui.select("选择已配置的模型", options);
        if (!selected) return;
        const confirmed = await ctx.ui.confirm("确认免费范围", `请先在服务商处确认 ${selected} 可用于你的免费额度且超额不会产生意外费用。只将你确认可用的模型加入池。`);
        if (!confirmed) return;
        savePool([...models, selected]);
        ctx.ui.notify("已加入额度池；正在重新加载扩展。余额和实际免费资格仍须在厂商处确认。", "info");
        await ctx.reload();
      } else if (choice === "验证池中模型") {
        const models = getPool(ctx); if (!models?.length) { ctx.ui.notify("额度池为空。", "info"); return; }
        const selected = await ctx.ui.select("选择要验证的模型", models);
        if (!selected) return;
        const slash = selected.indexOf("/");
        const model = ctx.modelRegistry.find(selected.slice(0, slash), selected.slice(slash + 1));
        if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) { ctx.ui.notify("未检测到模型或凭证。", "error"); return; }
        const confirmed = await ctx.ui.confirm("验证模型", "将向服务商发起两次小型请求并消耗额度。请确认当前模型的费用规则。继续吗？");
        if (!confirmed) return;
        try {
          const user = { role: "user" as const, content: "请调用 free_pool_probe 工具，传入 text 为 ping。", timestamp: Date.now() };
          const tools = [{ name: "free_pool_probe", description: "返回测试字符串", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }];
          const first = await ctx.modelRegistry.complete(model, { messages: [user], tools });
          const call = first.content.find((part) => part.type === "toolCall" && part.name === "free_pool_probe");
          if (first.stopReason === "error" || !call || call.type !== "toolCall") throw new Error(first.errorMessage || "模型未发出预期工具调用");
          const result = { role: "toolResult" as const, toolCallId: call.id, toolName: call.name, content: [{ type: "text" as const, text: "ping" }], isError: false, timestamp: Date.now() };
          const second = await ctx.modelRegistry.complete(model, { messages: [user, first, result], tools });
          if (second.stopReason === "error" || second.stopReason === "aborted") throw new Error(second.errorMessage || "工具结果返回失败");
          const verified = getVerified(); verified[selected] = new Date().toISOString();
          mkdirSync(join(process.cwd(), ".pi"), { recursive: true });
          writeFileSync(verifiedPath, JSON.stringify(verified, null, 2) + "\n", { mode: 0o600 });
          ctx.ui.notify("模型响应及工具调用往返验证成功；余额仍需向厂商查询。", "info");
        } catch (error) { ctx.ui.notify(`验证失败：${String(error)}`, "error"); }
      } else if (choice === "移除池中模型") {
        const models = getPool(ctx); if (!models?.length) { ctx.ui.notify("额度池为空。", "info"); return; }
        const selected = await ctx.ui.select("选择要移除的模型", models);
        if (!selected) return;
        savePool(models.filter((m) => m !== selected));
        ctx.ui.notify("已移除；正在重新加载扩展。", "info");
        await ctx.reload();
      } else if (choice === "使用说明") {
        ctx.ui.notify("先自行领取额度、配置 Pi 模型，再将已确认免费模型按优先顺序加入池。用 /model 选择池中模型；至少两个模型时启用自动回退。/fallback-status 查看状态。余额未知，免费规则以厂商为准。", "info");
      }
    },
  });
}
