# 价格榜扩充记录 · 2026-09-12

本文记录最初扩充至 55 条的阶段。同日后续已补齐豆包、Kimi、智谱，当前共 66 条；下文三家的“暂缺原因”已经被后续接入解决，详见[后续接入记录](PROVIDER-RECOVERY-2026-09-12.md)。

本轮补齐价格排行榜，原 24 条目录增加 31 条至 **55 条 API 价格记录**。每条新增型号生成永久详情页及初始历史；首页输入、输出、任务成本排行、筛选和升降序直接使用扩充后的目录。性能榜的 241 条评测记录保持不变。

不同榜单不能机械一一复制：性能榜的推理档位、日期快照和匿名测试名称不一定是可计费 API ID；同一 API 的不同推理档位通常也不应在价格榜重复计数。55 条为目录总数，默认排行仍排除已下架与价格未确认记录。

## 本轮已补型号

| 厂商 | 新增 | 官方核价来源 |
| --- | --- | --- |
| OpenAI（6 条） | GPT-6 Astra、GPT-5.6 Terra、GPT-5.5、GPT-5.4、GPT-5.4 Mini、GPT-5.3 Codex | [API 定价](https://developers.openai.com/api/docs/pricing)及各型号的官方模型价格页 |
| Anthropic（8 条） | Fable 5.1、Fable 5、Opus 4.8 / 4.7 / 4.6 / 4.5、Sonnet 4.6 / 4.5 | [第一方 Claude API 定价](https://platform.claude.com/docs/en/about-claude/pricing) |
| Google（7 条） | Gemini 3.5 Flash、3.5 Flash-Lite、3.1 Flash-Lite、3.1 Pro Preview、3 Flash Preview、2.5 Pro、2.5 Flash | [Gemini 付费 Standard 定价](https://ai.google.dev/gemini-api/docs/pricing) |
| 阿里（9 条） | Qwen3.7 Max、3.7 Max Preview、3.6 Max Preview、3.6 Flash、3.7 Plus、3.6 Plus、Qwen3 Coder Plus / Flash / Next | [百炼北京地域原价](https://help.aliyun.com/zh/model-studio/model-pricing) |
| MiniMax（1 条） | MiniMax M3 | [普通 API 按量计费](https://platform.minimax.cn/docs/guides/pricing-paygo) |

已有 DeepSeek V4.1 Flash / V4 Pro、Grok 4.6、Claude Opus 5 / Sonnet 5 / Haiku 4.5、Qwen3.8 Max / Flash、MiniMax M2.7 等保留，无重复添加。

## 关键计费核对

- **GPT-6 Astra** 使用 API ID `gpt-6-astra`，不从性能榜的 `gpt-6-astra-max` 推测新接口。美元 / 百万 Token：输入 10、输出 50、缓存读取 1；输入超过 272,000 后整次请求分别为 20、75、2。上下文 1,050,000、最大输出 128,000。Batch 仅主动选择时采用半价。[Astra 官方模型页](https://developers.openai.com/api/docs/models/gpt-6-astra)
- OpenAI 国际标准服务与数据驻留、Fast 服务分开；缓存写入不冒充缓存读取。未核验的可选优惠字段保持 null。
- Claude Fable 5.1 缓存读取为 0.25 美元，不能沿用 Fable 5 的 1 美元。第一方全球路由不混入 AWS、Google Cloud、US-only 或 Fast 费率。Opus/Sonnet 4.5 只在已核验的输入 ≤200K 范围报价；未核验规格不推测。
- Gemini 采用付费层文本 Token 标准价，不采用免费配额、音视频 Token 或工具费。Pro 在 200K 输入边界切换整次请求费率。Google 规格为独立输入与输出上限，不按二者之和误判。
- Qwen 完整保留北京地域所有计价阶梯。Plus 的思考与非思考输出列必须等价才允许使用同一记录；不等价会停止解析。Qwen3.7 Plus 明确标注“原价”与限时八折，此处保存原价；优惠有效期未完整核验，未擅自启用促销。
- MiniMax M3 区分普通/优先通道、划线旧价与永久五折现价。标准通道在输入 ≤512K 为人民币 2.1 / 8.4 / 0.42，>512K 为 4.2 / 16.8 / 0.84。永久现价不再叠加一次五折。官方称最高 1M 上下文、保障至少 512K，详情注明实际可用性边界。

## 仍未收录及原因

以下是本轮重点核对后的待办，不表示这些模型没有官方价格，也不是完整的全球模型名单。

| 型号或系列 | 当前阻碍及后续处理 |
| --- | --- |
| GPT-5.6 Sol | [官方页](https://developers.openai.com/api/docs/models/gpt-5.6-sol)明确把 4 / 20 美元标为至少持续至 2026-11-21 的促销价，没有同时提供该型号的非促销基准；不能用 GPT-5.5 的价格替代，也不能把促销冒充默认原价。需补齐该型号的优惠与基准处理。 |
| Gemini 3.8 / 3.7 / 3.6 Flash | [官方页](https://ai.google.dev/gemini-api/docs/pricing)分别列出截至 2026-12-31 的当期费率与 2027-01-01 起的新费率。报价是公开的，但本轮暂未实现这类分期生效记录；不能提前把未来价投入当前排行。 |
| Kimi K3、K2.7 Code、K2.6 | [官方计费页](https://platform.kimi.com/docs/pricing/chat)的可读 HTML 和文档视图只有计费说明，没有完整价格表。腾讯等第三方平台的 Kimi 价格不能替代 Kimi 自家 API 价格。 |
| GLM-5.3 / 5.3 Flash / 5.2 | [官方价格页](https://open.bigmodel.cn/pricing)返回需要 JavaScript 的页面壳；模型介绍可以确认版本与规格，但不能据此生成费率。 |
| Hy4 Preview、Hy3 新平台计费 | 本轮可读的官方资料包含 Token Plan 积分或 PU 折算，尚未完成具体 API ID、地域和直接按量费率的对应核验。不能将订阅积分直接当人民币 API 单价。 |
| 豆包新型号 | 官方价格页本次读取失败/仅动态内容；原来的索引价格仍保持未确认，不用搜索摘要补新价。 |
| Claude Mythos 系列、OpenAI 专用受限模型 | 不属于当前通用可用 API 范围，存在受限访问、特殊用途或未来计费条件；暂未纳入通用标准价榜。 |

这次完成的是“已核实可比较型号的扩充”，没有宣称所有主流厂商所有版本全覆盖。

## 数据和维护入口

`data/pricing/reviewed-additions-2026-09-12.json` 保存本轮完整型号、原币费率、官方 URL、核验时间、计费说明与收录理由。只保存必要事实，不复制整篇官网内容；初始记录明确标为 `manual_verified`。

```bash
# 检查已核价新增清单，不写生产数据
npm run prices:add-reviewed -- --from-file=data/pricing/reviewed-additions-2026-09-12.json
# 添加新型号、初始历史及核验状态，测试和构建失败时一起恢复
npm run prices:add-reviewed -- --apply --from-file=data/pricing/reviewed-additions-2026-09-12.json
```

此入口专用于明确核对过的新增数据，禁止修改同 ID 的既有价格、禁止同厂商/API/地区重复、非官方源、搜索索引、未来核验日期和零值占位。相同清单重复执行返回 unchanged，不写文件也不追加历史；后续改价仍走已有 Diff/审核或 `prices:record-manual`。

Qwen Adapter 已扩展到 Plus 的双输出列、Coder 的长度范围表和明确标注的原价单元格，新增 9 款均用本次直接读取的官方页面验证解析成功。对应最小证据为 `tests/fixtures/providers/alibaba-expanded.html`。M3 当前保留人工维护，不套用 M2 单档解析器。

## 验证

- 101 项测试通过，包含新增数据、历史与幂等、重复/覆盖阻止、Astra 272K、Google 200K、MiniMax 512K、Qwen 原价/模式价/阶梯错误等检查。
- 已实际执行新增清单的完整 apply 流程：Schema、工作流结构、测试、Astro check、生产构建与本地资源验证通过；生成 58 个 HTML 页面。
- 原 24 条价格与历史在新增操作中保留；31 条新增型号各有一条初始历史。
- 重复执行同一清单，catalog、history、verification 三份文件逐字节相同。
- 实际执行扩充后的 `prices:update --apply`：DeepSeek 2 条、Qwen 15 条、MiniMax M2.7 两条、百度 2 条、腾讯 1 条解析成功，共 22 条。M3 的两档人工价格继续保留；其余厂商仍受 403、地区不可用、网络失败或动态页面影响。报告中的待处理项不等同于已发布改价。
- 本轮真实更新 `dataChanged=false`，catalog 与 price-history 逐字节不变；101 项测试、生产构建及静态资源检查通过，未产生空价格提交。
- 根路径和 `/model-prices/` 子路径均完成生产 Build，58 个 HTML 页面、1512 个本地链接/资源通过校验。
- 本地 HTTP 已确认首页包含全部 50 条默认可见排名，公开目录有 55 条；Astra 详情页、55 条价格历史可访问，性能榜仍为 241 条。
- 仍未连接 Git remote，不能把本地 Workflow 入口或结构检查称为 GitHub runner / Pages 线上发布成功。
- 浏览器连接尚未恢复；页面验收使用本地 HTTP 和静态产物，不宣称本轮已完成浏览器点击测试。
