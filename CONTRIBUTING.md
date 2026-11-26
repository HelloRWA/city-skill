# 贡献指南

## 入驻流程

1. 选择 `templates/city`、`templates/district` 或 `templates/attraction`，完整复制到 `places/` 下合适的存储路径。不要直接修改模板来提交实体。
2. 替换所有示例值。保持 ID 为小写字母、数字和连字符；区县选择城市父级，景点选择城市或区县父级。业务关系以 `parentId` 为准，不能只改目录。
3. 在 `entity.json` 中填写维护者、坐标系、已复核坐标、来源 ID 和内容目录；在 `data/sources.json` 与 `data/content.json` 中登记来源和内容。机器数据只用 JSON。
4. 同步维护 `skill.json`、`SKILL.md` 顶部的 `city-skill` JSON 注释以及 Markdown reference 链接。不要声明范围外能力或要求 Agent 获取凭证。
5. 本地运行 `npm test`、`npm run validate` 和 `npm run build:registry`。修复全部错误；不要手改生成的 `registry.json`。
6. 提交 PR，勾选模板中的核验与许可清单。新城市根目录、Schema、工作流和官方身份变更需要 CODEOWNERS 审核。

## 来源和时效

- 每条来源至少提供稳定 URL 或材料 ID、页码/章节、最短必要原文摘录、`verificationStatus` 和实际查阅时间 `checkedAt`。
- `verified` 来源必须有 `verifiedAt`、`verifiedBy`。发布实体与发布内容只能引用已核验来源；未核验条目保持 `draft`。
- `price`、`openingHours`、`reservation`、`eventSchedule`、`performanceSchedule`、`merchantStatus`、`campusAccess`、`ferrySchedule` 等动态字段使用 `dynamicFields`，每项独立携带 `sourceId`、`checkedAt`、`officialUrl`，必要时增加 `validUntil`。
- 不把手册上的“免费”“全天”“元起”、历史年鉴数据或赛事安排改写成当前事实。无当前权威来源时删除动态值或标为草稿，并在说明中提示以官方最新信息为准。
- 不批量导入未复核 POI，不编造坐标、官方 URL、维护主体、价格或开放状态。

## 官方状态

社区贡献者通常使用：

```json
"verification": {
  "official": false,
  "status": "community",
  "method": "",
  "verifiedAt": "",
  "reviewedBy": "",
  "evidenceUrl": ""
}
```

只有平台仓库维护者完成独立人工核验后，才可同时设置 `official: true` 与 `status: "official-verified"`，并填写核验方式、核验人、ISO 8601 时间和 HTTPS 证据。作者在 PR 中自称政府/官方不能替代该过程。官方身份变更必须单独说明证据，且由 CODEOWNERS 审查。

## 内容安全与许可

禁止秘密、Token、个人敏感数据、可执行文件、脚本块、危险 URL、绝对路径、路径穿越和符号链接。不要加入自动安装、自动连接第三方 MCP/API、任意工具执行或凭证收集指令。

确认你拥有提交文字、图片和结构化数据的权利。第三方素材须记录授权；授权不明不要提交。详见 [CONTENT_LICENSE.md](CONTENT_LICENSE.md)。

## 纠错、暂停与回滚

使用“内容纠错”Issue 建立线索，再通过 PR 修改。紧急错误可由维护者把实体改为 `suspended` 以从下一次 registry 构建中移除，再补修正 PR。平台回滚只切换到最后一个有效 commit，不改写本仓库历史；任何修正仍通过 PR 留痕。
