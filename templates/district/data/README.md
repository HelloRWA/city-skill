# data 目录

`sources.json` 和 `content.json` 均为 JSON 数组，分别遵循来源与内容项 Schema，不接受 YAML。区县内容使用稳定 ID，并关联本区县和已核验来源。

动态字段逐项记录 `sourceId`、`checkedAt`、HTTPS `officialUrl` 及可选有效期。模板中的 `2000-01-01` 只演示格式，必须替换为实际查阅时间；未核验内容保持 `draft`。
