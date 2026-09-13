# 2026-09-13：零价隐藏与性能分类扩展

## 价格榜

原第一名为 **GLM-4.7 Flash**。[智谱官方定价](https://docs.bigmodel.cn/cn/guide/start/pricing.md)中，该型号的输入、输出和缓存读取明确标为“免费”，不是抓取失败生成的 0。付费的 GLM-4.7 FlashX 是另一型号。

根据当前展示要求，排行榜统一排除当前阶梯的输入或输出标准费率为 0、或所选计费模式下输入或输出价为 0 的条目。规则作用于表格、移动卡片、前三卡片、价格名次和相对最低价基准；搜索、厂商筛选、升降序和 `status=all` 不会重新显示这些条目。未启用的免费缓存不影响标准费率排名；自定义输入和输出均为 0 Token 的空任务不等同于模型免费。

目录仍为 66 条、70 个价格历史事件，默认付费榜为 64 条；原免费费率、来源、详情 URL 及价格历史均保留。价格抓取失败不得写入 0 的保护逻辑保持有效。

## 四个独立性能分类

| 分类 | 官方页面 | 上游日期 | 完整来源条数 | 当前收录条数 |
| --- | --- | --- | --- | --- |
| 综合文本 | [Arena Text](https://arena.ai/leaderboard/text) | 2026-09-11 | 401 | 241 |
| 网页编程 | [Arena WebDev](https://arena.ai/leaderboard/code) | 2026-09-11 | 128 | 103 |
| 视觉理解 | [Arena Vision](https://arena.ai/leaderboard/vision) | 2026-08-27 | 148 | 110 |
| 智能体 | [Agent Arena](https://arena.ai/leaderboard/agent) | 2026-09-09 | 43 | 36 |

条数包含不同版本、推理档位和测试配置，不能相加视为独立模型数量。继续使用现有 12 家厂商与官方模型系列白名单。没有出现在某个分类的模型，不会获得其他分类的分数。

- 网页编程对应 WebDev Overall，不能当成所有编程工作的通用分数；视觉理解衡量看图与视觉推理，不是图片生成。
- 综合文本、网页编程和视觉理解分别保留官方分数、票数、整数精度、不确定区间、初步成绩标记与原榜顺序，跨榜分数不可直接比较。
- 智能体保留官方 Overall 综合顺序、评估会话数、净提升、确认完成、好评与抱怨、纠错响应、命令恢复及工具幻觉信号。按 [Arena 方法说明](https://arena.ai/blog/agent-arena-methodology)，百分比为相对基准的估计效应，不是原始成功率；本地不自行生成综合得分，也不依据单个信号重排。前三卡片展示官方综合名次，表格中的净提升仅供参考，展开可看全部信号。
- 编程官网在第 72、89 名均展示 `gpt-5.3-codex (codex-harness)`，无法确认配置区别。这两条暂不收录，原记录和排除原因保留在证据文件及 `excludedModels` 中，页面评分说明同步解释。

排行榜内部“能力分类”按钮沿用价格榜任务场景的样式，切换完整榜单、前三卡片、统计数量、来源、日期、表头和评分说明。搜索、厂商筛选与方向跟随 URL 保存；切换分类保留筛选，重置筛选保留分类。示例：`/performance/?category=agent&providers=openai&order=asc`。现有彩色 Logo、排行版式、价格详情及鹈鹕榜不重写。

## 数据与更新

- 新增完整官方表格证据：`data/performance/arena-code-2026-09-11.json`、`arena-vision-2026-08-27.json`、`arena-agent-2026-09-09.json`。
- 新增分类当前快照：`src/data/performance-categories.json`；追加式历史：`data/performance/categories-history.json`，目前每类各一份。
- 原文本快照 `src/data/performance.json` 和两份文本历史 `data/performance/history.json` 不改写。
- Schema、分类说明：`src/lib/performance-categories.ts`；读取、标准化与异常判断：`scripts/performance/categories.ts`。
- `/data/performance-categories.json` 公开四类有效快照与来源；原 `/data/performance.json` 文本接口仍可用。

`npm run performance:update -- --apply` 独立尝试四类更新；某一类失败不会清空该分类，也不会阻止其他有效候选参与校验和构建。全部失败返回非零状态。有变化才追加相应历史；无变化不写数据。已有模型丢失、日期倒退、跨分类覆盖、分数跳变超过 100、Agent 信号变化超过 20 个百分点等会阻止更新。无法确认的非对称区间进入人工核对，不擅自转换。测试或构建失败会回滚本次全部候选文件。

人工核对后可沿用同一个入口导入：

```sh
npm run performance:update -- --apply --from-file=data/performance/arena-code-2026-09-11.json
npm run performance:update -- --apply --from-file=data/performance/arena-vision-2026-08-27.json
npm run performance:update -- --apply --from-file=data/performance/arena-agent-2026-09-09.json
```

原每 6 小时 GitHub Actions Workflow 已扩展提交及备份新分类快照、历史；仍仅在有有效变化且测试构建通过后部署，部署成功后推送数据提交。没有引入外部数据库、VPS 或付费云服务。

## 实际验证与边界

- 128 项测试通过，覆盖零价隐藏、价格排序、四类数据与映射、信号单位、原榜顺序、过滤与 URL、异常拒绝、旧历史保护及原页面回归。
- Astro 检查为 0 errors / warnings / hints；生产 Build 生成 70 个 HTML 页面。根路径和 `/model-prices/` 子路径构建均通过，各验证 1764 个链接及资源；子路径产物输出到临时目录，本地根路径预览保持可用。
- 新增分类分别实际执行重复 `--apply --from-file` 导入，均返回 `unchanged`，没有重复历史或空数据变化。
- 实际执行四类官方网络同步：文本 API 连接失败，编程、视觉、智能体官网均返回 HTTP 403。报告为 `failed`、`changed=false`；校验哈希确认目录、文本与分类当前快照及历史逐字节不变。本批新增数据明确标记 `reviewed-official-page`，不能宣称脚本抓取已成功。
- 本地 4322 预览服务实际返回新版首页、性能页和四类 JSON；确认默认价格记录 64 条、免费 Flash 不出现、付费 FlashX 保留、四分类入口存在、客户端引用的 DOM 元素齐全。
- 浏览器交互连接不可用；本次没有完成浏览器点击、桌面与手机截图验收。测试、静态产物与 HTTP 检查不替代视觉验收。
- 当前仓库没有 Git remote，本次未在 GitHub runner 上运行，也未线上部署 Pages。已执行的 Workflow 结构校验不等同于线上部署成功。

## 体验审查后的名称与展示修正

- 智能体桌面表格、手机卡片和前三卡片统一以“原榜综合名次”为主指标，本站名次单独标注。净提升仍作为辅助信号保留，不用其重算官方顺序。前三卡片标题带当前能力分类。
- Qwen2.5 Max（文本榜）与 Qwen3.7 Max（智能体榜）保留完整产品名称，移除错误的 Max 测试档位标签；自动名称映射也按该产品规则处理后续版本。其他模型实际的 Max 推理配置保持原样。
- 这两项是本站名称/配置标签校正，不是新一期上游成绩。模型 ID、来源、原始模型名、发布日期、采集日期、分数、名次、票数及会话数全部保持不变；没有运行价格或性能抓取。
- 旧历史快照保持原样，分别追加一份修正后的文本、智能体快照。文本历史现有 3 份；分类历史共 4 份（编程 1、视觉 1、智能体 2）。新增记录沿用原始数据日期，不宣称上游更新。
- 名称/渲染回归及原有性能测试共 34 项通过，性能数据与历史一致性校验通过。页面交互、生产构建及跨端检查由本轮整体修复统一验收。
