# 免费模型助手 PRD

状态：开发中

更新日期：2026-11-15

目标：用户在 Pi 中发现免费模型服务、自己领取额度并完成接入，然后使用模型完成编程或个人助手任务。首个真实接入目标是 Cloudflare Workers AI。

> 以下流程图描述产品目标；具体完成情况见「当前进度」。

## 一、整体架构

```mermaid
flowchart LR
    PI["第一层：Pi + 免费模型助手插件<br/>选厂商、管理接入、执行任务"]
    P["第二层：本机 CLIProxyAPI<br/>统一入口、路由与切换"]
    A["第三层：Cloudflare"]
    B["第三层：其他厂商"]
    PI --> P
    P --> A
    P --> B
```

- 厂商接入模块位于 Pi 插件内；CLIProxyAPI 是独立本机进程，默认仅监听 `127.0.0.1` 并要求客户端密钥。
- “额度池”是已接入厂商及模型的统一视图；真实额度仍在各厂商账号中，不会变成通用 Token。余额不可可靠查询时显示“未知”。
- 插件不能保证免费额度用尽后不会收费；用户需确认厂商的免费范围和超额规则。

## 二、用户完整流程

```mermaid
flowchart TD
    A[打开 Pi 并进入免费模型助手] --> B[查看厂商目录]
    B --> C[选择厂商并查看免费规则]
    C --> D[前往官网自行注册或领取额度]
    D --> E[在厂商接入模块完成授权或配置凭证]
    E --> F[配置 CLIProxyAPI 上游]
    F --> G[测试连接并注册 Pi 模型]
    G --> H{测试通过？}
    H -- 否 --> I[显示失败原因与处理方式]
    I --> E
    H -- 是 --> J[选择模型并在 Pi 中执行任务]
    J --> K[查看接入状态和已知额度信息]
```

目录需提供官方链接、免费额度及刷新周期、API 适用范围、模型、限制、超额行为与核实日期；未知项明确标记。用户自行领取，插件不代签或自动注册。首版入口为 `/free-models`，链接应支持打开浏览器或手动复制。

## 三、厂商接入模块

```mermaid
flowchart TD
    A[选择厂商] --> B[查看规则和支持的接入方式]
    B --> C{厂商支持的方式}
    C -- 浏览器 OAuth --> D[用户在厂商页面确认账号和权限]
    D --> E[本机接收回调并交换令牌]
    C -- API Key --> F[用户输入厂商凭证]
    E --> G[安全保存凭证]
    F --> G
    G --> H[映射厂商模型并配置代理上游]
    H --> I[测试连接并注册 Pi 模型]
    I --> J{验证结果}
    J -- 成功 --> K[标记已验证]
    J -- 失败 --> L[显示原因与重试或手动配置入口]
```

共用厂商选择、规则展示、状态和连接测试；每家厂商分别适配官方链接、授权方式、模型映射、凭证更新和费用规则。目录中出现厂商不代表已经支持自动接入。仅在端到端测试通过后标记“已验证”。

### Cloudflare 接入示例

```mermaid
sequenceDiagram
    actor U as 用户
    participant P as Pi 插件
    participant CF as Cloudflare
    participant L as 本机授权回调
    participant CP as CLIProxyAPI
    U->>P: 选择 Cloudflare 并查看免费规则
    P->>CF: 打开官方授权页面
    U->>CF: 确认账号和 Workers AI 权限
    CF->>L: 返回授权码
    L->>CF: 使用 PKCE 交换令牌
    P->>CP: 保存凭证并配置上游（待实现）
    P->>CP: 测试模型连接（待实现）
    CP->>CF: 调用 Workers AI（待验证）
    P-->>U: 显示接入结果
```

- Cloudflare 目标提供浏览器授权和手动 API Token 两种方式；浏览器授权采用 Authorization Code + PKCE，不读取浏览器 Cookie。授权不等于自动领取或开通额度。
- 授权请求使用 Workers AI Read、Write 权限。测试用私有 OAuth 客户端是否可用于其他用户，以及正式发布的注册、验证和分发要求，仍需核实。
- CLIProxyAPI 当前未发现内置 Cloudflare OAuth 登录；需验证其 OpenAI 兼容上游是否接受该令牌及如何同步更新。必要时再评估扩展或本机适配。

## 四、使用、重试与切换

```mermaid
flowchart TD
    A[用户向 Pi 提交任务] --> B[Pi 请求本机 CLIProxyAPI]
    B --> C[代理调用已配置上游]
    C --> D{请求结果}
    D -- 成功 --> E[Pi 接收结果并执行所需工具]
    D -- 限流、额度或服务故障 --> F{代理有可用的已配置候选？}
    F -- 有 --> G[按代理配置重试或切换]
    G --> C
    F -- 无 --> H[停止并提示原因]
    D -- 认证失效 --> I[按厂商能力尝试刷新或提示重新授权]
    D -- 网络错误 --> J[提示检查网络及代理设置]
```

此图是目标行为：CLIProxyAPI 的切换条件及不同厂商错误分类需要测试，不能假设所有错误都能切换。用户需事先确认候选厂商与模型；只有一个上游时无法切换。

代理可能在一次请求内部重试；代理返回失败后 Pi 也可能按自身配置重试。现有 `pi-auto-fallback` 是独立机制，需控制两层重试的延迟和消耗。若工具已写文件或执行命令，恢复时不得盲目重放；无法安全恢复则停止并提示。

## 五、凭证与接入状态

```mermaid
flowchart LR
    A[未接入] --> B[已授权或已填写凭证]
    B --> C[代理已配置]
    C --> D[端到端调用已验证]
    B --> E[凭证失效或授权撤销]
    C --> E
    D --> E
    E --> F{厂商支持刷新且刷新成功？}
    F -- 是 --> C
    F -- 否或未知 --> G[提示重新授权或配置]
    G --> B
```

- 凭证不写入代码、仓库或日志；优先评估系统密钥链，并确认 CLIProxyAPI 如何安全读取。当前手动配置脚本把 Cloudflare API Token 明文保存于权限为 `600` 的本地配置，需告知用户。
- Cloudflare 是否返回刷新令牌、有效期和刷新行为均未验证，不能承诺无感续期。重启、撤销与刷新失败均需测试。
- 网络代理可配置；OAuth 交换、刷新和模型上游请求的网络路径分别验证，不默认要求用户使用代理。

## 六、当前进度

```mermaid
flowchart LR
    subgraph DONE[已验证]
        A[模拟上游：Pi 到代理的请求]
        B[Cloudflare 浏览器授权和令牌交换]
        C[OAuth 令牌直接调用 Workers AI：HTTP 200]
    end
    subgraph TODO[待实现或待验证]
        D[OAuth 凭证持久化和刷新]
        E[Cloudflare 令牌接入 CLIProxyAPI]
        F[Pi 到 Cloudflare 的真实工具调用]
        G[双上游自动切换]
    end
    B --> D --> E --> F --> G
```

- 2026-11-15 使用私有 OAuth 客户端、本机回调和本机 HTTP 代理，直接调用 `@cf/openai/gpt-oss-20b` 成功；令牌仅在测试进程内使用，没有写入文件。该调用未经过 Pi 或 CLIProxyAPI。
- 已准备 CLIProxyAPI 8.0.72 macOS Apple Silicon 本地发行包、配置和启动脚本；本地二进制和配置不随仓库分发。插件可通过环境变量注册代理模型，模型参数目前为占位信息，不代表能力或费用已验证。
- 当前 Cloudflare 仍通过脚本手动输入 Account ID 和 API Token；插件内浏览器授权、凭证管理及真实额度查询尚未实现。公开 GitHub 仓库尚未同步这些本地修改。

## 七、验收流程

```mermaid
flowchart TD
    A[目录展示官方链接、规则与未知项] --> B[用户自行领取额度并选择接入方式]
    B --> C[完成 Cloudflare 授权或凭证配置]
    C --> D[无需手工复制 OAuth Token 即可配置代理]
    D --> E[Pi 经 CLIProxyAPI 调用真实模型]
    E --> F[完成一次真实工具调用并记录结果]
    F --> G[重启后验证凭证和接入状态]
    G --> H[验证取消授权、过期、撤销与网络故障提示]
    H --> I[用两个模拟上游验证限流、重试与切换]
    I --> J[验证全部不可用及工具已执行时安全停止]
```

验收需记录模型、日期和限制；真实厂商的错误识别、费用规则与切换行为需分别验证。若无法刷新令牌，需清楚提示重新授权。

## 八、范围与待确认

首版不包含自动注册或签到、对外转售中转服务、承诺永久免费、接入邮件或日历、DeepSeek Harness 接入。目录以人工核实的官方信息为准，AIHOT 仅作为发现线索；复用第三方数据或代码前需核查许可。

待确认：Cloudflare OAuth 客户端分发资格、令牌刷新规则、CLIProxyAPI 兼容性与凭证更新方案；第二家可验证厂商；密钥链与代理进程管理方案。公开发布前需核查相关数据与品牌许可。

自动切换备选参考：[pi-ccswitch-auto-switch](https://github.com/errorje/pi-ccswitch-auto-switch)、[pi-auto-fallback](https://github.com/mengcody/pi-auto-fallback)、[pi-high-availability](https://github.com/burggraf/pi-high-availability)、[Pi 虚拟模型](https://docs.pi.dev/latest/virtual-models)。它们是独立方案，不能等同于 CLIProxyAPI 的自动路由；兼容性及安全恢复行为均需验证。已复用的 `pi-auto-fallback` 上游声明支持 Pi 1.0 以下，Pi 1.5.2 仅完成本地加载和模拟测试。
