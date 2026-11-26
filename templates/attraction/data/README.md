# data 目录

`sources.json` 与 `content.json` 只使用 JSON，分别遵循来源和内容项 Schema。景点的票价、开放、预约等写入对应 `dynamicFields`，每项带 `sourceId`、实际 `checkedAt`、HTTPS `officialUrl` 和可选 `validUntil`。

模板的 `2000-01-01` 仅演示格式，不能当作核验日期沿用。未核验内容保持 `draft`，不能进入公开 registry。
