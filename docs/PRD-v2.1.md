# 源宝 AI 模型价格榜 PRD v2.1

> **版本属性：v2.0 的增量升级需求，不是重做版本。**
>
> 适用对象：Codex / 前端开发 / 数据脚本开发 / 运营维护
>
> 目标：在 v2.0「中文主流大模型 API 价格排行榜」基础上，补齐**零服务器部署、官方价格自动采集、价格变化检测、历史价格、异常审核、自动构建与 GitHub Pages 发布**能力。

---

## 0. 版本说明

### 0.1 与 v2.0 的关系

- v2.0 已定义的首页榜单、筛选、厂商范围、中文 UI、模型详情、排名逻辑等需求继续有效。
- v2.1 **不得要求重写已经符合 v2.0 的页面和组件**。
- 本版本只新增自动化数据基础设施和价格历史能力；若与 v2.0 有冲突，以 v2.1 为准。
- Codex 开始 v2.1 前必须先检查当前仓库实现，只改新增/受影响模块。

### 0.2 本次新增能力

1. 只依赖 GitHub Repository + GitHub Actions + GitHub Pages 运行 V1。
2. 不使用 VPS、常驻后端、数据库或额外云服务作为 V1 必需依赖。
3. GitHub Actions 定时访问各厂商官方 API 定价来源。
4. 自动解析标准输入价、输出价及必要计费条件。
5. 新旧数据自动 diff，价格变化进入校验流程。
6. 高置信度、低风险变更允许自动发布；异常变更阻止上线并进入人工审核。
7. 永久保存价格历史，支持模型详情页展示价格趋势。
8. 数据更新成功后自动重新计算榜单、构建 Astro 静态站并部署 GitHub Pages。
9. 抓取失败、官网结构变化或异常数据不能污染线上榜单。

---

# 1. 产品目标

## 1.1 核心目标

让「源宝 AI 模型价格榜」从一张人工维护的静态排行榜，升级为：

> **能够长期自动检查主流模型官方 API 定价，并保留可追溯价格历史的中文榜单。**

用户不需要知道后端是否存在。用户只应感知到：

- 榜单价格相对新鲜；
- 每条价格有官方来源和核验时间；
- 厂商降价后，榜单会在下一轮数据更新后重新排序；
- 模型详情页可以看到历史价格变化；
- 异常价格不会因为爬虫误判直接污染线上结果。

## 1.2 V1 技术原则

### 必须

- 静态优先（Static-first）。
- 数据文件优先（Data-as-Code）。
- GitHub 原生自动化优先。
- 所有线上价格必须可追溯到官方来源。
- 页面运行时不得依赖厂商官网实时响应。

### 不做

V1 不引入：

- VPS / ECS / 云服务器；
- Supabase / Firebase / PostgreSQL 等数据库作为必需依赖；
- 常驻 Node/Python 后端；
- 用户登录系统；
- 付费接口；
- 实时 WebSocket；
- 第三方价格聚合站作为生产价格源。

---

# 2. 目标架构

## 2.1 总体数据链路

```text
主流厂商官方 API 定价页 / 官方价格接口
            ↓
GitHub Actions 定时任务
            ↓
Provider Adapter（各厂商解析器）
            ↓
标准化 Normalize
            ↓
Schema 校验 + 异常检测 + 新旧 Diff
            ↓
        ┌───────────────┐
        │ 是否安全发布？ │
        └───────┬───────┘
        是      │      否
        ↓       │      ↓
更新 models.json│   生成审核报告
更新 price-history.json│ 保留线上旧数据
        ↓       │
自动 commit     │
        ↓       │
Astro Build     │
        ↓       │
GitHub Pages Deploy
        ↓
用户看到新价格和新排名
```

## 2.2 V1 基础设施

| 能力 | 实现 |
|---|---|
| 源代码 | GitHub Repository |
| 定时执行 | GitHub Actions |
| 数据存储 | 仓库内 JSON / YAML |
| 历史版本 | Git + `price-history.json` |
| 前端 | 延续 v2.0，默认 Astro + TypeScript |
| 构建 | GitHub Actions |
| 托管 | GitHub Pages |
| 域名 | 默认 `github.io`；自定义域名为可选项 |
| 常驻服务器 | 无 |
| V1 数据库 | 无 |

> 若仓库保持公开、使用标准 GitHub-hosted runner，且使用量处于 GitHub 免费政策允许范围内，V1 设计目标是无需额外服务器费用。但 PRD 不承诺任何第三方平台的免费政策永久不变。

---

# 3. 自动更新策略

## 3.1 默认更新频率

默认：**每 6 小时检查一次**。

推荐 Cron：

```cron
17 */6 * * *
```

说明：

- 不使用整点，减少 GitHub Actions 高峰期排队概率；
- 模型价格变化频率远低于股票行情，无需分钟级刷新；
- 管理员可以通过 `workflow_dispatch` 手动触发即时检查。

## 3.2 一次自动更新任务必须完成

1. Checkout 仓库；
2. 安装依赖；
3. 加载当前线上价格快照；
4. 并行/串行抓取厂商官方来源；
5. 解析原始价格；
6. Normalize 成统一 Schema；
7. 执行字段完整性检查；
8. 计算新旧 diff；
9. 执行异常检测；
10. 对安全变更写入生产数据；
11. 对异常变更生成 review report；
12. 更新价格历史；
13. 运行单元测试；
14. 运行静态站 build；
15. 仅在全部通过后 commit；
16. 触发/完成 GitHub Pages 部署。

---

# 4. 官方价格来源规则

## 4.1 唯一生产源原则

价格榜生产数据仅允许来自：

1. 厂商官方 API Pricing 页面；
2. 厂商官方开发者文档中的价格表；
3. 厂商官方公开 API / JSON 价格端点（若存在且稳定）；
4. 厂商官方公告中明确生效的新价格。

禁止作为生产价格源：

- OpenRouter；
- Artificial Analysis；
- Calcis；
- 博客；
- 媒体报道；
- 社区帖子；
- 中转商；
- 搜索引擎摘要。

这些网站只能用于人工交叉核验，不可直接覆盖生产数据。

## 4.2 厂商白名单

沿用 v2.0，第一阶段只支持主流厂商：

- OpenAI
- Anthropic / Claude
- Google / Gemini
- xAI / Grok
- DeepSeek
- 字节跳动 / 火山引擎 / 豆包
- 阿里云 / Qwen
- Moonshot AI / Kimi
- 智谱 / GLM
- MiniMax
- 百度智能云 / ERNIE
- 腾讯云 / 混元

新增厂商必须人工修改白名单，不允许爬虫自动发现后直接加入榜单。

---

# 5. Provider Adapter 设计

## 5.1 每家厂商独立解析器

推荐目录：

```text
/scripts/providers/
  openai.ts
  anthropic.ts
  google.ts
  xai.ts
  deepseek.ts
  doubao.ts
  qwen.ts
  kimi.ts
  glm.ts
  minimax.ts
  baidu.ts
  tencent.ts
```

统一接口：

```ts
interface ProviderAdapter {
  providerId: string;
  fetch(): Promise<RawPricingSnapshot>;
  parse(raw: RawPricingSnapshot): NormalizedPrice[];
  validate(items: NormalizedPrice[]): ValidationResult;
}
```

## 5.2 解析优先级

优先：

1. 官方结构化 JSON/API；
2. 官方 HTML 中结构稳定的表格；
3. 官方页面内可稳定定位的嵌入 JSON；
4. 必要时才使用浏览器自动化。

V1 不应把 Playwright/Chromium 作为所有厂商的默认抓取方式，避免任务过重和脆弱。

## 5.3 厂商解析失败原则

任一厂商失败时：

- 不将对应价格写成 `0`；
- 不删除旧模型；
- 保留上一次成功价格；
- 将该厂商标记为 `stale`；
- 记录 `last_checked_at` 与 `last_success_at`；
- 其余厂商可继续更新，除非全局 Schema / 构建失败。

---

# 6. 数据模型

## 6.1 `models.json`

建议：

```json
{
  "schema_version": 1,
  "generated_at": "2026-09-12T12:00:00Z",
  "models": [
    {
      "id": "provider-model-version",
      "provider_id": "openai",
      "provider_name_zh": "OpenAI",
      "model_name": "示例模型",
      "model_slug": "example-model",
      "status": "active",
      "currency": "USD",
      "unit": "per_1m_tokens",
      "input_price": 1.0,
      "output_price": 5.0,
      "cached_input_price": null,
      "context_window": null,
      "pricing_conditions": [],
      "source_url": "https://official.example/pricing",
      "source_type": "official_pricing_page",
      "last_checked_at": "2026-09-12T12:00:00Z",
      "last_success_at": "2026-09-12T12:00:00Z",
      "verification_status": "auto_verified"
    }
  ]
}
```

## 6.2 不同币种

生产数据保留厂商官方原始币种，不直接把人民币换算结果写成唯一真值。

建议：

- 原始价格字段保留 `currency`；
- 前端根据统一汇率快照换算显示；
- 国内厂商若官方以人民币计价，则保存 RMB 原价；
- 美元厂商保存 USD 原价。

汇率必须：

- 有来源；
- 有更新时间；
- 与模型价格分开存储；
- 汇率变化只影响显示换算，不视为模型官方“涨价/降价”。

## 6.3 `price-history.json`

只在厂商官方价格发生变化时新增记录，不需要每 6 小时写一份完全相同的数据。

```json
{
  "model_id": "provider-model-version",
  "events": [
    {
      "effective_at": "2026-09-12T12:00:00Z",
      "detected_at": "2026-09-12T12:17:00Z",
      "currency": "USD",
      "input_price": 1.0,
      "output_price": 5.0,
      "source_url": "https://official.example/pricing",
      "change_reason": "price_change",
      "verification": "auto_verified"
    }
  ]
}
```

---

# 7. 价格变化检测

## 7.1 Diff 类型

至少识别：

- 新模型新增；
- 模型下架；
- 输入价下降；
- 输入价上涨；
- 输出价下降；
- 输出价上涨；
- 缓存价变化；
- 长上下文分档变化；
- 限时促销开始/结束；
- 时段价变化；
- 模型名称/版本变化；
- 来源 URL 变化。

## 7.2 不应被视为价格变化

- 美元兑人民币汇率变化；
- 表格排序变化；
- 官网页面文案变化但数字不变；
- 更新时间变化但价格不变。

---

# 8. 自动发布与人工审核

## 8.1 设计目标

不是“抓到什么就发什么”，而是：

> **能自动确认的变化自动发布；可疑变化宁可延迟，也不能污染排行榜。**

## 8.2 建议安全规则

以下满足全部条件时，可自动发布：

- 来源域名在官方白名单；
- 所有必需字段通过 Schema 校验；
- 价格为正数；
- 单次价格变动幅度不超过预设阈值；
- 页面抓取到了明确的模型名称与计费单位；
- 不是只出现了缓存价/Batch 价而标准价消失；
- 解析器没有报告结构变化。

建议初始异常阈值：

- 任一核心价格相对上一次变化 **> 60%**：人工审核；
- 价格下降到旧值的 **< 20%**：人工审核；
- 标准价突然为 0：拒绝发布；
- 模型价格字段全部消失：拒绝发布；
- 同一厂商超过 50% 模型同时出现异常变化：整家厂商进入审核。

> 阈值是工程防错规则，不是对真实商业降价幅度的判断。管理员可以在配置文件中调整。

## 8.3 异常变更处理

异常发生：

1. 保持线上旧价格；
2. 生成 `review-report.json` 或 Markdown 报告；
3. GitHub Actions Job 标记为需要人工处理；
4. 在 workflow summary 中打印：旧值、新值、变化比例、官方来源；
5. 不自动删除历史数据；
6. 允许管理员确认后重新执行手动发布。

## 8.4 V1 人工审核入口

为了保持零服务器，V1 不开发后台管理系统。

采用 GitHub 原生方式之一：

- 手工修改审核状态后 commit；或
- 工作流创建 Pull Request，由维护者 review/merge；或
- `workflow_dispatch` 传入被确认的变更 ID。

推荐实现：**异常更新自动创建 PR，普通安全更新直接 commit。**

---

# 9. 价格历史与前端需求

## 9.1 模型详情页新增

若已有模型详情页，在不破坏 v2.0 UI 的情况下增加：

### 价格变化卡片

- 当前输入价
- 当前输出价
- 上一次价格
- 相对变化百分比
- 最近一次官方价格变化日期

### 价格历史

至少支持：

- 时间轴；
- 输入价格历史；
- 输出价格历史；
- 涨价/降价标记；
- 官方来源链接。

图表可作为 v2.1 P1；若影响开发进度，V1.1 可先使用时间轴表格。

## 9.2 首页可选新增

“近期价格变化”模块：

```text
最近 30 天
↓ 某模型 输入价下降 20%
↓ 某模型 输出价下降 33%
↑ 某模型 促销结束，恢复标准价
```

此模块不影响主排行榜上线，可作为 P1。

---

# 10. 推荐仓库结构

不得为了符合本目录而无意义重构现有 v2.0 工程；以当前仓库结构为基础映射即可。

```text
/
├─ src/
│  └─ ... v2.0 已有前端
├─ data/
│  ├─ models.json
│  ├─ providers.json
│  ├─ exchange-rates.json
│  ├─ price-history.json
│  └─ review-report.json
├─ scripts/
│  ├─ fetch-prices.ts
│  ├─ normalize-prices.ts
│  ├─ validate-prices.ts
│  ├─ diff-prices.ts
│  ├─ update-history.ts
│  └─ providers/
│     ├─ openai.ts
│     ├─ anthropic.ts
│     ├─ google.ts
│     └─ ...
├─ tests/
│  ├─ fixtures/
│  ├─ provider-parsers/
│  └─ pricing-pipeline.test.ts
├─ .github/
│  └─ workflows/
│     ├─ update-prices.yml
│     └─ deploy-pages.yml
└─ PRD.md
```

---

# 11. GitHub Actions 要求

## 11.1 `update-prices.yml`

触发方式：

```yaml
on:
  schedule:
    - cron: '17 */6 * * *'
  workflow_dispatch:
```

功能：

- 定时检查；
- 可手动运行；
- 支持单独指定 provider 调试（可选）；
- 写入数据前必须跑验证；
- 没有价格变化时不创建无意义 commit；
- 有安全变化时提交数据；
- 有异常变化时按审核策略处理。

## 11.2 防止重复运行

使用 Actions `concurrency`，避免两次价格更新同时修改数据：

```yaml
concurrency:
  group: pricing-update
  cancel-in-progress: false
```

## 11.3 权限最小化

Workflow 仅申请必需权限。

若需要自动 commit：

- `contents: write`

若异常变化自动创建 PR：

- 按 GitHub 当前 Actions 权限模型配置最小必要权限。

不得把个人 PAT 硬编码到仓库。

## 11.4 Secrets

公开价格页面原则上不需要 API Key。

若某个官方来源必须使用 token：

- 使用 GitHub Actions Secrets；
- 前端代码不得包含 Secret；
- 静态构建产物不得包含 Secret；
- 没有可靠官方数据获取方式时，宁可暂时人工维护该厂商，不允许为了“全自动”引入不可信抓取。

---

# 12. 构建与发布

## 12.1 发布原则

只有以下条件全部通过，才允许覆盖线上 Pages：

- 数据 Schema 校验通过；
- 价格异常规则通过或已人工确认；
- 单元测试通过；
- Astro build 成功；
- 核心页面静态生成成功。

## 12.2 页面运行时

用户打开榜单后：

- 从站内静态 JSON / 构建时数据读取；
- 不直接请求 OpenAI/Anthropic/Google 等价格页；
- 厂商官网临时宕机不影响已发布榜单访问；
- 不暴露抓取凭据。

## 12.3 失败回滚

若 build / deploy 失败：

- 线上继续保留上一版可用站点；
- 失败任务明确输出原因；
- 不覆盖最后一次成功数据。

---

# 13. 状态与新鲜度

每条模型价格显示/记录状态：

- `fresh`：最近检查成功；
- `stale`：最近检查失败，展示上一次成功数据；
- `manual_review`：检测到异常变化；
- `deprecated`：官方下架/停止提供；
- `unknown`：无法确认状态，不参与默认排名。

前端至少展示：

> 数据核验：2026-09-12 18:17

若某模型已经超过设定时长没有成功核验，例如 7 天：

> ⚠ 价格超过 7 天未成功核验

并降低视觉可信度，但不要自动写 0 或删除。

---

# 14. 排名更新规则

价格数据更新成功后：

- 输入价榜自动重新排序；
- 输出价榜自动重新排序；
- 标准任务价格榜自动重新计算；
- 并列价格继续沿用 v2.0 并列名次规则；
- `stale` 数据仍可显示，但需有标记；
- `manual_review` 的新值在确认前不得进入排名；
- 汇率变化可改变人民币展示金额，但不生成“厂商降价”事件。

---

# 15. 测试要求

## 15.1 Provider Parser Fixture

每个厂商至少保存一份脱敏/合法的解析测试 Fixture 或最小 HTML 片段，保证页面结构轻微变化时能通过 CI 发现解析器失效。

## 15.2 必测场景

1. 正常降价 20%，自动发布；
2. 正常涨价 10%，自动发布；
3. 价格突然变为 0，阻止发布；
4. 把缓存价格误识别为标准输入价格，校验失败；
5. 官网返回 403/500，保留旧数据；
6. HTML 结构变化导致无法解析，标记 stale；
7. 一个厂商失败，其他厂商仍可更新；
8. 新模型出现，进入新增流程；
9. 模型下架，不删除历史记录；
10. 汇率变化，不写入模型 price history；
11. 没有任何变化，不产生空 commit；
12. 同一 workflow 重复触发，不出现并发覆盖；
13. build 失败，不破坏当前线上页面；
14. 异常变化产生审核报告；
15. 人工确认后能够发布新值。

---

# 16. 监控与维护

V1 不建立独立监控服务器。

使用 GitHub 原生能力：

- Actions 运行历史；
- Workflow Summary；
- 失败状态；
- 自动创建 Issue（可选）；
- 自动创建 PR（推荐用于异常变更）。

建议增加：

- 连续 2 次某 provider 抓取失败时创建/更新 GitHub Issue；
- 恢复成功后自动关闭或标记恢复；
- 所有 Issue 标记 `pricing-pipeline`。

---

# 17. 中国大陆访问与零服务器边界

## 17.1 产品原则

V1 以 GitHub Pages 为唯一必需托管平台，不购买额外服务器。

但产品文案和团队内部不得声称：

> “GitHub Pages 保证中国大陆全国任何地区永久稳定访问。”

实际可访问性受网络、运营商、GitHub 服务状态等影响。

## 17.2 V1 验收

至少实测：

- PC / 手机；
- 中国大陆多个地区；
- 电信 / 联通 / 移动中的多个网络样本；
- 首页、榜单筛选、模型详情、静态 JSON 加载。

静态资源尽量本地化，不依赖 Google Fonts 等关键境外第三方 CDN。

## 17.3 未来兜底

若后续实际流量或大陆可用性无法达到目标，可在不改产品数据层的情况下，把同一个静态构建产物镜像到其他托管平台。

**此项不属于 v2.1 V1 必做，不允许 Codex 因此主动引入云服务。**

---

# 18. 安全与合规

- 只抓公开官方价格信息；
- 尊重网站访问限制与合理频率；
- 不绕过登录、验证码、付费墙或访问控制；
- 不存用户敏感数据；
- 不在客户端暴露 Secrets；
- 外部 URL 必须验证协议与来源；
- 对抓取文本只提取价格所需字段，不复制整页内容进入仓库。

---

# 19. 开发迁移要求

因为 v2.0 已经由 Codex 开始开发，v2.1 必须遵守：

## 19.1 开始开发前

Codex 必须：

1. 完整阅读 v2.0 / 当前 PRD；
2. 检查当前仓库结构；
3. 识别已经完成的 v2.0 功能；
4. 输出“无需修改 / 需要扩展 / 需要新增”的文件清单；
5. 再开始编码。

## 19.2 禁止

- 不得因为 v2.1 重写整个前端；
- 不得更换前端框架，除非当前实现无法满足需求并明确说明；
- 不得删除符合 v2.0 的功能；
- 不得私自引入数据库、VPS 或付费 SaaS；
- 不得为了自动抓取而使用非官方价格聚合网站作为生产源；
- 不得把异常价格自动上线。

---

# 20. 优先级

## P0 - v2.1 必须完成

- GitHub Actions 定时任务；
- Provider Adapter 架构；
- 官方价格抓取；
- 标准化与 Schema 校验；
- 新旧价格 Diff；
- 异常阻断；
- 安全变化自动更新；
- `models.json`；
- `price-history.json`；
- 无变化不 commit；
- 自动 build + GitHub Pages deploy；
- 抓取失败保留旧数据；
- 核验时间和状态展示。

## P1 - 推荐完成

- 异常变化自动创建 PR；
- 最近 30 天价格变化区；
- 模型详情价格时间轴；
- 连续抓取失败自动 Issue；
- 单 provider 手动更新参数。

## P2 - 未来版本

- 价格走势图；
- 用户订阅降价提醒；
- 邮件/微信/Telegram 通知；
- 多托管镜像；
- 后台管理页面；
- 更复杂的历史分析。

---

# 21. v2.1 验收标准（Definition of Done）

满足以下条件才算 v2.1 完成：

- [ ] 当前 v2.0 页面和主要交互没有被无理由重写或破坏；
- [ ] 项目不依赖独立服务器即可运行；
- [ ] GitHub Actions 每 6 小时自动检查价格；
- [ ] 支持手动触发更新；
- [ ] 至少 5 家核心厂商的自动抓取流程跑通，其他白名单厂商允许先保持人工适配状态，但架构必须可扩展；
- [ ] 所有生产价格均带官方来源 URL；
- [ ] 价格变化会生成 Diff；
- [ ] 明显异常数据无法自动覆盖生产价格；
- [ ] 某一家抓取失败不会把价格清空；
- [ ] 正常降价后榜单在下一次成功构建中自动重新排序；
- [ ] 历史价格不会因更新而丢失；
- [ ] 无数据变化时不产生空 commit；
- [ ] Build 或 Deploy 失败不会破坏最后一个线上成功版本；
- [ ] GitHub Pages 能正常访问并读取最新构建数据；
- [ ] 核心页面展示最近核验时间/状态；
- [ ] README 说明如何手动触发更新、如何处理异常 PR、如何新增 Provider Adapter。

---

# 22. 一句话交付要求

> **在不推翻 v2.0 现有实现的前提下，把源宝 AI 模型价格榜升级成一个仅依赖 GitHub 就能定时检查主流厂商官方 API 价格、自动安全更新榜单、保存历史价格并自动部署的静态站。**

