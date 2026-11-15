import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Pi sends the configured model and client key to the proxy", { timeout: 15000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "freeagent-proxy-test-"));
  let request;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    request = { path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"proxy-ok"},"finish_reason":null}]}\n\n');
    res.end('data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  try {
    await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
    const env = { ...process.env, PI_CODING_AGENT_DIR: temp, CLIPROXY_API_KEY: "local-test-key", CLIPROXY_MODEL: "test-model", CLIPROXY_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` };
    const child = spawn("pi", ["--offline", "--no-session", "--no-tools", "-e", resolve("extensions/index.ts"), "--model", "cliproxy/test-model", "-p", "hello"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((done, fail) => {
      const timer = setTimeout(() => { child.kill(); fail(new Error(`Pi timed out: ${stderr} ${stdout}; request: ${request?.path ?? "none"}`)); }, 10000);
      child.once("error", (error) => { clearTimeout(timer); fail(error); });
      child.once("close", (code) => { clearTimeout(timer); done(code); });
    });
    assert.equal(code, 0, stderr);
    assert.match(stdout, /proxy-ok/);
    assert.equal(request.path, "/v1/chat/completions");
    assert.equal(request.auth, "Bearer local-test-key");
    assert.equal(request.body.model, "test-model");
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(temp, { recursive: true, force: true });
  }
});

test("Pi reaches an OpenAI-compatible upstream through CLIProxyAPI", { timeout: 20000, skip: !existsSync(".local/cliproxy/cli-proxy-api") }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "freeagent-proxy-e2e-"));
  let request;
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    request = { auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"upstream-model","choices":[{"index":0,"delta":{"role":"assistant","content":"upstream-ok"},"finish_reason":null}]}\n\n');
    res.end('data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"upstream-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  let proxy;
  try {
    await new Promise((done, fail) => { upstream.once("error", fail); upstream.listen(0, "127.0.0.1", done); });
    const reservation = createServer();
    await new Promise((done, fail) => { reservation.once("error", fail); reservation.listen(0, "127.0.0.1", done); });
    const port = reservation.address().port;
    await new Promise((done) => reservation.close(done));
    const config = { "config-version": 8, server: { host: "127.0.0.1", port }, access: { "api-keys": ["local-test-key"] }, oauth: { "auth-dir": join(temp, "auth") }, "api-keys": { "openai-compatibility": [{ name: "test", "base-url": `http://127.0.0.1:${upstream.address().port}/v1`, keys: [{ "api-key": "upstream-test-key" }], models: [{ name: "upstream-model", alias: "pool-model" }] }] } };
    const configPath = join(temp, "config.json");
    await writeFile(configPath, JSON.stringify(config));
    proxy = spawn(resolve(".local/cliproxy/cli-proxy-api"), ["-local-model", "-config", configPath], { stdio: ["ignore", "pipe", "pipe"] });
    let proxyLog = "";
    proxy.stdout.on("data", (chunk) => { proxyLog += chunk; });
    proxy.stderr.on("data", (chunk) => { proxyLog += chunk; });
    let available = false;
    for (let i = 0; i < 50; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: "Bearer local-test-key" } });
        const body = await response.json();
        if (response.ok && body.data?.some((m) => m.id === "pool-model")) { available = true; break; }
      } catch {}
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(available, `代理未启动或未注册模型：${proxyLog}`);
    const env = { ...process.env, PI_CODING_AGENT_DIR: temp, CLIPROXY_API_KEY: "local-test-key", CLIPROXY_MODEL: "pool-model", CLIPROXY_BASE_URL: `http://127.0.0.1:${port}/v1` };
    const child = spawn("pi", ["--offline", "--no-session", "--no-tools", "-e", resolve("extensions/index.ts"), "--model", "cliproxy/pool-model", "-p", "hello"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((done, fail) => {
      const timer = setTimeout(() => { child.kill(); fail(new Error(`Pi timed out: ${stderr}`)); }, 10000);
      child.once("error", (error) => { clearTimeout(timer); fail(error); });
      child.once("close", (code) => { clearTimeout(timer); done(code); });
    });
    assert.equal(code, 0, stderr);
    assert.match(stdout, /upstream-ok/);
    assert.equal(request.auth, "Bearer upstream-test-key");
    assert.equal(request.body.model, "upstream-model");
  } finally {
    proxy?.kill();
    upstream.closeAllConnections();
    await new Promise((done) => upstream.close(done));
    await rm(temp, { recursive: true, force: true });
  }
});
