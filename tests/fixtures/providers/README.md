# Provider 解析 Fixture

取样日期：2026-09-12。仅保存价格表需要的最小片段，不保存整页文档、脚本、登录信息或用户内容。

| 文件 | 官方来源 | 覆盖范围 |
| --- | --- | --- |
| deepseek.html | https://api-docs.deepseek.com/quick_start/pricing/ | 标准峰时、缓存命中/未命中、低峰、合并单元格与单位 |
| alibaba.html | https://help.aliyun.com/zh/model-studio/model-pricing | 北京与新加坡，同名模型地区区分、全部已收录输入阶梯 |
| alibaba-expanded.html | https://help.aliyun.com/zh/model-studio/model-pricing | 2026-09-12 直接读取的北京地域新增 Max / Flash / Plus / Coder 九款价格行；双输出列、明确原价标签与完整阶梯，表格跨度展开 |
| minimax.html | https://platform.minimax.cn/docs/guides/pricing-paygo | M2.7 与 highspeed 的输入、输出、缓存读取 |
| baidu.html | https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya | Turbo 32K / 128K 标准、缓存、Batch、元/千 Token |
| tencent.html | https://cloud.tencent.cn/document/product/1729/97731 | A13B 刊例价与存量服务状态 |

DeepSeek 保留原表的 rowspan/colspan。其他片段只保留相关行，部分合并单元格展开为语义等价的完整行。

其余 7 家的 HTML 是明确标注的**合成失败契约 Fixture**，用于保证未适配厂商不产生任何价格。它们不是成功抓取证据，也不计入 5 家自动解析验收。

`tests/fixtures/catalog-v2.json` 固定计费回归基线，避免官方真实调价导致算术测试误失败；它从不被生产代码或更新入口读取。
