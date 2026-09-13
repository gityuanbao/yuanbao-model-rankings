# v3.0 公开测试版发布验收

日期：2026-09-13。公开站点与价格更新后的重新部署均已成功；性能候选被校验阻止，保留有效旧榜。下文区分本地交互、公网读取及未完整验证的部分。

- 产品基线：[PRD v3.0](../PRD.md)
- 仓库：[gityuanbao/yuanbao-model-rankings](https://github.com/gityuanbao/yuanbao-model-rankings)
- 公开网址：[源宝模型排行榜](https://gityuanbao.github.io/yuanbao-model-rankings/)

| 项目 | 状态 |
| --- | --- |
| 本地完整测试 | 153 项通过，0 失败 |
| 工作流、数据与 Astro 校验 | 通过；88 个文件 0 错误、0 警告 |
| 生产子路径 Build | 70 页、1,759 个本地链接/资源通过，base 为 `/yuanbao-model-rankings/` |
| 桌面与手机交互 | 本地三榜主要布局与交互通过（剪贴板复核除外）；公网浏览器导航可加载，但截图/交互检查超时，未完整验收 |
| GitHub CI | [34754126809](https://github.com/gityuanbao/yuanbao-model-rankings/actions/runs/34754126809) 成功 |
| GitHub Pages 首次部署 | [34754126792](https://github.com/gityuanbao/yuanbao-model-rankings/actions/runs/34754126792) 第 2 次尝试成功 |
| 公网 HTTPS | 三榜与 GPT-6 Astra 详情完整 HTML、价格 JSON、历史 JSON 读取成功：12 厂商、66 记录、70 历史事件；canonical 正确 |
| GitHub 价格更新 | [34754264491](https://github.com/gityuanbao/yuanbao-model-rankings/actions/runs/34754264491)：update 成功，Pages 再部署成功；attention 提醒待处理 |
| GitHub 性能更新 | [34754340150](https://github.com/gityuanbao/yuanbao-model-rankings/actions/runs/34754340150)：候选校验失败，未覆盖旧数据、未提交或部署 |

## 本次发布改动

- 生成当前三榜的 PRD v3.0，归档旧 v2.0，整理 README 的旧数量和过时描述。
- 鹈鹕公开说明改为已确认的 v2：一次生成、最高可设置档/不能设置时默认、20 秒送宝、AI 评分与源宝复核；继续保留空榜。
- 补齐页面标题、canonical 和分享预览元数据，保持现有页面布局。
- 排除 `.artifact-work/`、`outputs/`、环境文件与报告，不将本地工作材料公开。
- 创建独立公开仓库，启用 Actions Pages。首次自动环境误用 `master`，已将唯一允许发布的分支准确改为 `main` 后重跑成功，未取消分支限制。

## 价格更新的实际证据

| 厂商 | 本轮成功解析已收录记录 |
| --- | ---: |
| DeepSeek | 2 |
| 豆包 | 6 |
| 千问 | 15 |
| Kimi | 4 |
| 智谱 | 4 |
| MiniMax | 2 |
| 百度 | 2 |
| 腾讯 | 1 |

共 8 家、36 条。OpenAI、Anthropic、Google、xAI 仍为人工 Adapter，代码保存的历史网络限制不能当作本轮新测得的 HTTP 结果。

本轮 `dataChanged=false`、`applied=[]`：没有实际安全调价，价格 commit 和 push 均跳过，没有空提交。原有 66 模型 / 70 历史事件保留；真实调价后的历史追加、异常阻断、失败回退由 GitHub runner 的 153 项回归测试验证，本轮没有用真实调价重演这些事件。

59 条待处理记录：57 个发现的新型号需人工补齐计费与规格元数据，2 个已知不可自动发布项（GLM-4.7 Flash 免费、MiniMax M3 复杂费率）。旧价及隐藏规则保留。`update` 的构建、校验、Pages 全部成功，`attention` 按设计标红提示处理，因此整体 run 显示 failure，不代表网站发布失败。

审核报告可从该 run 的 `pricing-review` artifact 下载，核验状态为 `pricing-run-state` artifact。本次通过报告 + 人工精确 ID 审核；审核 PR 模块保留但未启用。自动审批审核拒绝了开启 Actions 创建/批准 PR 的仓库权限，因此没有改动该权限；无需该权限即可继续阻止异常并人工确认。

## 性能更新的实际证据

本轮四分类候选都被校验拒绝：文本候选的 `organization` 字段为空，网页编程、视觉理解与智能体候选缺少已收录型号。报告为 `changed=false`，数据 commit、Pages 上传、部署和推送全部跳过，已有快照与历史继续保留。

这属于数据质量门槛阻止更新，不能写成全分类自动同步已成功，也不能把本轮原因误写为 403。完整原因见该 run 的 `performance-update-report` artifact。后续应核对官方候选与原快照的覆盖差异，不直接允许缺字段或批量删模型。

## 验证边界与后续

- 本地浏览器已操作价格厂商/搜索/场景/双向排序/分享/刷新/详情往返和历史恢复，性能四分类和配置筛选，手机 390px 的筛选、排序、空结果、布局；没有整页横向溢出或抽查破图，读取到的 console 无 warning/error。使用过正式项目子路径进行操作，随后恢复原本地根路径预览。
- 本地鹈鹕桌面与手机已确认 0 条结果、三卡待公布、v2 说明和完整提示词可展开，包含单次、最高档/默认兜底、20 秒和 AI 评分。复制按钮已点击，但内容正确性没有确认；后续读取剪贴板被自动审批以可能涉及未知敏感内容为由拒绝，未绕过，不把复制验证记为通过。
- 公网浏览器可加载 URL 与标题，但进一步检查发生连接超时，未完整验证公网浏览器交互。HTTP 读取不替代浏览器操作；不据此声称所有设备全部通过。
- 没有跨地区、跨运营商或真实手机设备测试；手机结论来自浏览器 390px 视口，公网 HTTPS 结果只代表当前网络。
- 无真实鹈鹕作品，首批 14 模型测试、逐项证据、数据字段扩展、同分/失败作品和实际 GIF 验收待完成。
- 4 家价格 Adapter 继续人工维护；新发现型号与复杂计费项待核对。性能自动同步验收未通过。
- 未对线上站点故意制造 Build/Deploy 故障；失败回滚有代码与自动测试证据，首次部署分支失败未产生有效线上版本。
- 定时配置已在默认分支启用；本轮验收采用手动触发，尚未等待首个每 6 小时调度事件。不把手动成功称为已观察到定时执行。
