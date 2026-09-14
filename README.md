# 源宝模型排行榜

中文主流 AI 模型价格、性能与鹈鹕作品榜。Astro + TypeScript + 静态 JSON，仅依赖 GitHub Repository / Actions / Pages。

当前产品基线：[PRD v3.0](PRD.md)。发布状态、网址和实跑证据：[发布验收记录](docs/RELEASE-v3.0.md)。

## 当前功能

- 价格：12 家厂商、66 条费率与永久详情，默认显示 64 条。输入、输出、任务成本排序；筛选、场景用量、自定义计算、优惠选项、分享与 URL 恢复。
- 性能：综合文本 241、网页编程 103、视觉理解 110、智能体 36 条模型/配置记录。各自保留官方指标、日期、名次，不跨分类拼分。
- 鹈鹕：从夯到拉的作品榜及[送宝挑战 v2 规则](docs/PELICAN-BENCHMARK-v2.md)。当前没有真实结果，等待源宝交回首批作品；不生成演示成绩。
- 统一彩色厂商 Logo、冠军卡、桌面/手机布局和社区页脚。标志资源及许可见 [Logo 说明](public/logos/README.md)。
- 价格自动更新、异常审核、追加历史及 Pages 自动构建发布；覆盖与失败边界见下文。

数量为 2026-09-13 发布准备时的快照，性能记录包含不同配置，不能相加作为独立型号数。历史 v2 文件仅用于追溯，不覆盖当前 PRD。

## 本地开发与校验

需要 Node.js 22.12+。

```bash
npm ci
npm run dev
# 完整校验
npm run validate:workflows
npm test
npm run build
npm run validate:build
```

项目子路径校验：

```bash
SITE_URL=https://gityuanbao.github.io BASE_PATH=/yuanbao-model-rankings/ npm run build
BASE_PATH=/yuanbao-model-rankings/ npm run validate:build
```

受限环境可设置 `ASTRO_TELEMETRY_DISABLED=1`。`.env`、`outputs/`、`.artifact-work/` 和 `reports/` 不进入公开仓库。

## 数据与目录

| 文件/目录 | 用途 |
| --- | --- |
| `src/data/catalog.json` | 官方原币费率、12 家厂商白名单、来源、模型规格 |
| `src/data/exchange-rates.json` | 独立参考汇率，目前 $1 = ¥7.00，非实时外汇报价 |
| `src/data/verification.json` | 与价格快照对应的核验状态 |
| `src/data/price-history.json` | 追加式历史，当前 66 模型 / 70 事件 |
| `src/data/performance*.json` | 四个独立性能分类快照 |
| `data/performance/` | 性能历史及来源配置 |
| `src/data/pelican.json` | 真实作品索引，目前为空 |
| `src/lib/`、`src/scripts/` | 校验、计价、排序与页面交互 |
| `scripts/providers/`、`scripts/pricing/` | 独立厂商 Adapter、安全门槛、历史与事务 |
| `.github/workflows/` | CI、Pages、价格和性能更新 |

零输入/输出价不参与价格排名，未知价不填 0，退役模型保留 URL。抓取失败保留有效旧价，并展示状态；超过 7 天未成功核验会提示。缓存、Batch、低峰和促销必须明确选择，不自动叠加；请求超出窗口或缺对应阶梯不外推。

## GitHub Pages 发布

1. 默认分支为 `main`，Pages 来源为 **GitHub Actions**。
2. `deploy.yml` 在 `main` 推送或手动触发时执行测试、Build、产物校验与 Pages 部署。域名、子路径使用 `configure-pages` 的输出。
3. 默认通过运行报告和精确变更 ID 人工审核。审核 PR 功能保留但首次发布不启用；只有维护者确认所需仓库权限并将 Actions 变量 `ENABLE_PRICE_REVIEW_PRS` 设为 `true` 后才运行该 job。
4. 普通发布、价格和性能更新共用发布互斥组。检查或 Build 失败不部署；自动数据更新在部署成功后才推送数据提交。

无需购买域名或服务器。大陆多地区、多运营商的实际可用性仍需测试；不承诺全国稳定访问。

## 价格更新和人工审核

**Update official prices** 每 6 小时运行，也可在 Actions → Run workflow 手动运行；`provider` 留空检查全部，或填写单个厂商 ID。

```bash
# 真实抓取和报告，不修改生产数据
npm run prices:update
npm run prices:update -- --provider=deepseek
# 抓取、判定、暂存、测试及 Build；本地不会 commit/push
npm run prices:update -- --apply
```

自动 Adapter 共 8 家：DeepSeek、豆包、千问、Kimi、智谱、MiniMax、百度、腾讯。智谱免费型号及 MiniMax 未匹配型号仍需人工处理。

人工维护 4 家：OpenAI（直连 403）、Anthropic（地区跳转）、Google（超时、解析未验证）、xAI（超时、长输入条件未完整适配）。这些是当前适配限制，不能据此断言官网一直不可访问，也不能声称全量自动更新已成功。

安全阈值位于 `scripts/pricing/policy.json`：任一核心价格变化 >60% 或降至旧价 <20% 进入审核；零标准价、字段缺失或错误计费列直接阻止；同厂商超过一半模型异常则保留整家旧值。

处理审核：

1. 查看 Workflow Summary、`pricing-review` artifact 或 `codex/pricing-review` PR，核对旧值、新值、单位、地区、阶梯及官方来源。
2. 对可审核且证据完整的条目，在 Run workflow 的 `approve_change_ids` 填精确 ID，多个以逗号分隔。
3. 工作流重新抓取，候选或旧数据改变后原 ID 无效；`blocked`、缺字段或不完整新模型不能用 ID 强行放行。
4. 审核 PR 只保存报告，合并它不会发布异常价格。

`attention` job 将待审核候选显示为 warning，不再把已知人工待办算作任务失败。人工 Adapter 本轮不运行自动抓取，也不刷新模型核验日期。真正的自动抓取故障仍使任务失败，测试、构建和部署失败也继续报错；异常价格仍被拦住并保留报告，未放宽数据校验。

无语义价格变化时不创建价格 commit、不重复历史。每轮状态保存在 90 天 `pricing-run-state` artifact，只有价格快照哈希匹配才恢复；普通部署也恢复匹配状态。事务校验/测试/构建失败，本地入口还原生产文件。

## 人工维护或新增型号

核对官方原币、标准列、完整阶梯和地区后编辑数据，并记录真实核验：

```bash
npm run prices:record-manual -- --model=模型ID --source=https://厂商官方定价地址 --reason='已核对标准价格、地区及完整阶梯'
npm test
npm run build
```

直接修改价格而不更新历史会被校验阻止。退役模型标记 `retired`，不要删除历史。已核对的新型号可用 `prices:add-reviewed -- --apply --from-file=文件路径` 原子导入，重复导入不写文件。

新增 Adapter 时实现 `fetch / parse / validate`，返回 `NormalizedPrice`，采用公开的厂商官方源；补充最小解析 Fixture 和边界测试，完成真实读取验证后才标记 `automatic`。不能用搜索摘要或旧价补齐解析失败字段。

## 性能与鹈鹕维护

性能 **Update Arena performance leaderboard** 每 6 小时尝试更新，也可手动触发。`npm run performance:update` 默认只出报告，追加 `--apply` 才进入更新事务。只接受有效且不落后的官方快照，保留历史；接口失败继续使用已有日期的快照。自动同步实际成功范围见发布记录，不能将“已写工作流”当作“已全量跑通”。

鹈鹕采用[统一提示词](docs/鹈鹕测试_统一提示词_v2.0.txt)：每款只生成一次，最高可设置档，不能设置时默认。测试者交回原作及配置信息，AI 逐项评分，源宝复核发布。首批仍需完成真实测试及导入字段扩展，网站没有在线上传或自动评分后台。
