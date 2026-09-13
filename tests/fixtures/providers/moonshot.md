# 模型推理价格说明
按量计费
<DocTable
  columns={[
{ title: "模型", width: "24%" },
{ title: "计费单位", width: "12%" },
{ title: "输入价格（缓存命中）", width: "16%" },
{ title: "输入价格（缓存未命中）", width: "16%" },
{ title: "输出价格", width: "14%" },
{ title: "上下文窗口", width: "18%" },
]}
  rows={[
["kimi-k3", "1M tokens", "¥2.00", "¥20.00", "¥100.00", "1,048,576 tokens"],
["kimi-k2.7-code", "1M tokens", "¥1.30", "¥6.50", "¥27.00", "262,144 tokens"],
["kimi-k2.7-code-highspeed", "1M tokens", "¥2.60", "¥13.00", "¥54.00", "262,144 tokens"],
["kimi-k2.6", "1M tokens", "¥1.10", "¥6.50", "¥27.00", "262,144 tokens"],
]}
/>

此处 1M = 1,000,000，表格中的价格代表每消耗 1M tokens 的价格。

## 模型说明

各模型的能力介绍与适用场景见对应的模型指南：

* [Kimi K3 模型介绍](/docs/guide/kimi-k3-quickstart)
* [Kimi K2.7 Code 模型介绍](/docs/guide/kimi-k2-7-code-quickstart)
* [Kimi K2.6 模型介绍](/docs/guide/kimi-k2-6-quickstart)
