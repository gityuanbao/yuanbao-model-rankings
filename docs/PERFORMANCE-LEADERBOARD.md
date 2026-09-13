# 性能排行榜

> 2026-09-13 已扩展为四个独立分类。本文保留最初文本榜接入记录；当前分类覆盖、同步行为和验证情况见 [分类扩展说明](PERFORMANCE-CATEGORIES-2026-09-13.md)。

价格榜右侧的 `/performance/` 沿用 Astro、彩色本地厂商 Logo、头像和社区页脚。此次扩充不改动价格费率、价格历史和模型详情页。

## 当前来源与覆盖范围

- 来源：[Arena 官方文本榜](https://arena.ai/leaderboard/text)，榜单日期 **2026-09-11**，核对日期 **2026-09-12**。
- 完整核对官网 **401 条**记录，收录现有 **12 家主流厂商的 241 条模型与测试配置**。不同版本、日期快照和推理档位分别计数，不能理解成 241 款不同产品。
- 包含 OpenAI 45 条、Anthropic 31 条、Google 40 条、xAI 17 条、DeepSeek 21 条、字节 1 条、阿里 42 条、月之暗面 7 条、智谱 16 条、MiniMax 6 条、百度 4 条、腾讯 11 条。
- **GPT-6 Astra（Max）**：官方名称 `gpt-6-astra-max`，原榜第 24 名，1478 ± 13 分，2059 票。Grok 4.6（High）、MiniMax M2.7、Claude Haiku 4.5 等原先未选中的记录一并加入。
- 采用同一份文本榜的风格控制 overall 数据，反映用户对回答的偏好；不是速度、百分制或万能综合能力分数。未将 Agent 分类的 IPS 得分混入文本 Bradley–Terry 排名。
- 官网只展示整数分和 ± 区间。本地保存原值和原榜名次，不推测隐藏小数或精确置信区间端点；相同整数分按照官方先后显示，不自行合并为并列。厂商筛选和升降序不改写名次。
- 本站保留官方署名、来源链接和整理说明。公开数据集的 CC BY 4.0 许可仅用于来自该数据集的记录，不擅自给官网页面数据声明同一许可。

## 为什么上一版漏了新模型

上一版使用 2026-09-02 的官方公开数据集视图，同时人工固定挑选了 30 款代表型号。官网 9 月 11 日已出现 Astra，而本次核对时可读的 Hugging Face `text_style_control/latest` 视图仍显示 9 月 2 日数据。旧日期和固定清单共同造成遗漏。

现在 `data/performance/models.json` 中的 30 条仅保留原有 ID 和显示名称映射；`includeProviderFamilies` 开启后，`scripts/performance/selection.ts` 按官方组织及模型系列纳入同厂商的其他已上榜型号，不再限制总数。新增型号 ID 根据官方名称稳定生成，版本标点和推理档位不会意外合并。不自动扩展厂商白名单，也不收录第三方仿名、匿名测试或社区微调型号。

仍未参与此文本榜的例子：

| 型号 | 暂未收录原因 |
| --- | --- |
| GPT-6 Astra 的其他推理档位 | 本次官方文本榜只找到 Max，不能把 Max 的成绩复制给其他档位 |
| DeepSeek V4.1 Flash | 完整文本榜未找到该精确版本；已收录的 V4 Flash 不能冒充 V4.1 |
| Hy4 Preview | 本次完整文本榜未找到该型号；其他评测类别的成绩不能直接混入 |

“没在这份榜单出现”不表示模型不存在、能力为零或其他榜单也没有成绩。性能型号也不会因名称相近就自动获得价格榜另一型号的费率。

## 数据证据与历史

- `data/performance/arena-text-2026-09-11.json`：此次从官方页面核对的全部 401 条记录、发布日期、原榜名次和来源 URL；`retrieval` 明确为 `reviewed-official-page`，不冒充 API 抓取成功。
- `data/performance/initial-source.json`：保留初始 9 月 2 日公开数据集视图前 100 条证据。它不是完整上游快照，初始 30 款均位于这 100 条中，浮点数保留视图展示的六位小数。
- `tests/fixtures/performance/initial-selection.json`：冻结初版映射，用于旧精确分数格式的回归测试。
- `src/data/performance.json`：当前 241 条有效快照。
- `data/performance/history.json`：追加式完整历史，目前两份，分别为 9 月 2 日的 30 条和 9 月 11 日的 241 条。旧记录未被覆盖。
- `/data/performance.json`：公开当前收录成绩和对应来源；完整原始证据与历史不打包进前端脚本。

同一快照不混用日期、不混用官网整数与数据集精确分，不用旧行填补新榜缺项。缺少官方成绩时不生成零分。

## 更新方式

```bash
# 真实读取官方数据集 API，仅检查，不改生产数据
npm run performance:update
# 读取、校验、Diff，有变化才暂存并执行测试、生产构建
npm run performance:update -- --apply
# 导入已人工核对的完整官网证据，明确记录人工导入来源
npm run performance:update -- --apply --from-file=data/performance/arena-text-2026-09-11.json
```

`scripts/performance/arena.ts` 使用官方 Dataset Viewer API，每页 100 条读取 `lmarena-ai/leaderboard-dataset` 的 `text_style_control / latest / overall`。新型号进入该数据接口后，可按厂商系列自动收录；官网与数据集存在发布时间差时，API 同步不会退回旧日期，也不会静默删除已有型号。

分页缺项、数量变化、日期混杂、重复型号、字段被截断、已有型号消失、厂商错配、零分、无效区间或分数跳变超过 100 分会阻止候选更新。完整官网导入还校验总行数、连续原榜名次、发布日期和原始整数精度。报告写入 `reports/performance-update.json`，失败继续保留有效数据和历史。

仅抓取时间、来源总数变化不会写快照。成绩、票数、区间、原榜名次、收录内容或发布日期变化才追加历史；测试或构建失败恢复两份数据文件。相同证据重复运行返回 `unchanged`，无空提交。

`.github/workflows/update-performance.yml` 每 6 小时执行（UTC 00:43、06:43、12:43、18:43），支持手动触发；与价格更新和部署共用互斥组。变化通过测试、Astro Build、子路径校验后才部署 Pages，再推送非空提交。无变化不提交、不部署。未引入服务器、数据库或付费服务。

## 验证与剩余限制

- 91 项测试通过，涵盖完整收录、Astra 数据、未来型号识别、版本身份、整数排名、过滤排序、异常阻止、历史保留及已有价格回归。
- 实际执行完整官网证据的 `performance:update --apply`，完成 241 条数据更新、追加历史、工作流结构校验、测试和生产 Build；Astro check 为 0 errors / warnings / hints。
- 根路径与 `/model-prices/` 子路径的生产构建均通过，分别验证 27 个 HTML 页面和 985 个本地链接 / 资源。
- 重复运行相同导入，当前数据与历史逐字节不变，仍只有两份快照。
- 本机真实 API 检查仍受网络连接限制；本次新成绩来自人工核对官网，不宣称线上自动抓取已经成功。官网领先公开数据集时，需要等待数据集跟进，或核对后导入完整官网证据。
- 仓库没有 Git remote，GitHub Actions runner 和线上 Pages 部署尚未执行；工作流结构检查不能代替线上运行。
- 浏览器连接尚未恢复，本次使用测试及本地 HTTP 响应检查，不宣称已经完成桌面/移动端交互验收。
- 本地 `/performance/` HTTP 响应已确认 241 条服务端记录和 GPT-6 Astra；公开 JSON 的日期、数量和官网来源正确，首页导航保持可用。

部署子路径可验证：

```bash
ASTRO_TELEMETRY_DISABLED=1 SITE_URL=https://example.github.io BASE_PATH=/model-prices/ npm run build
BASE_PATH=/model-prices/ npm run validate:build
```
