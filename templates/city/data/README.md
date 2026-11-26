# data 目录

只存 JSON 机器数据：`sources.json` 是符合 `source.schema.json` 的来源对象数组，`content.json` 是符合 `content-item.schema.json` 的内容对象数组，不接受 YAML。

发布内容必须引用已核验来源。动态字段逐项填写 `value`、`unit`、`sourceId`、`checkedAt`、`validUntil`（可为空）和 HTTPS `officialUrl`；示例的日期只是格式示范，不能原样当作现实核验时间。来源摘录保持最短必要长度并填写许可边界。
