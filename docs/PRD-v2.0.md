# 源宝 AI 模型价格榜 PRD v2.0

> 面向中文用户的主流大模型 API 价格排行榜。参考 Calcis 的价格目录逻辑与 Artificial Analysis 的 Leaderboard-first 结构，但只收录头部厂商，默认人民币。

## 一句话定位

做一个**原生中文、主流厂商限定、榜单优先**的 LLM API 价格排行榜。用户进入首页第一眼看到的是名次，而不是工具说明。

## 首发厂商白名单

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

不自动收录小型初创厂商、社区部署端点、无官方 API 费率卡的模型。

## 首页结构

1. 三张冠军卡：输入最便宜 / 输出最便宜 / 标准任务最便宜
2. 主排行榜：排名、模型、厂商、输入价、输出价、缓存价、上下文、标准任务成本、相对最便宜倍数、核验时间、官方来源
3. 筛选：厂商 / 价格 / 上下文 / 模型状态 / 地区 / 使用场景
4. 场景：日常聊天 / 长文本 / AI 编程 / 自定义
5. URL 持久化筛选条件，便于分享

## 默认排名

- 输入榜：标准非缓存输入价升序
- 输出榜：标准输出价升序
- 标准任务榜：`总成本 = 输入 Token × 输入单价 + 输出 Token × 输出单价`
- 缓存、Batch、峰谷、限时促销不参与默认榜，用户主动开启后才纳入
- 并列价格采用并列名次

## 原生中文要求

- 默认币种：人民币
- 默认单位：¥ / 百万 Token
- 全部核心 UI 简体中文
- 日期：YYYY-MM-DD
- 国内厂商优先中文品牌名
- 首次出现复杂计费概念时给中文解释

## 数据原则

- 价格生产源仅允许厂商官方 API 定价页
- 每条价格都有官方 URL + 最后核验日期
- GitHub Actions 定时检查，发生变化后生成 diff 并审核
- 抓取失败保留旧值，绝不自动写 0
- 下架模型保留历史 URL，但默认隐藏

## GitHub Pages

- Astro + TypeScript 静态构建
- JSON/YAML 作为单一事实源
- 页面运行时不抓厂商官网
- 字体/Logo/JS/CSS 本地化，不依赖关键第三方 CDN
- 中国大陆访问以多地、多运营商实测为准；必要时相同构建产物可镜像到国内静态托管

## 参考

- Calcis: https://www.calcis.dev/models
- Artificial Analysis: https://artificialanalysis.ai/leaderboards/models

> 详细字段、验收标准、路线图请以 DOCX 正式版为准。
