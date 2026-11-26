# 变更摘要

<!-- 说明实体、来源、内容或仓库合约的变化，并关联 Issue。 -->

## 范围

- [ ] 城市
- [ ] 区县
- [ ] 景点
- [ ] 纠错 / 暂停 / 回滚
- [ ] Schema / 校验 / 仓库治理

实体 ID 与父级：

## 来源与时效

- [ ] 每个发布实体和内容项都有来源；来源含页码/章节、最短必要摘录、`checkedAt`。
- [ ] 已核验来源含 `verifiedAt` 与 `verifiedBy`；未核验内容保持 `draft`。
- [ ] 价格、开放、预约、演出/赛事、商户、校园入校、轮渡等动态字段逐项有 `sourceId`、实际 `checkedAt` 和 HTTPS `officialUrl`。
- [ ] 未把材料日期、历史统计或宣传表述写成当前事实；无实时结果时已注明信息边界。
- [ ] 坐标、主体与行政区/景点归属已经人工复核，没有为出图编造数据。

## Skill、安全与许可

- [ ] `entity.json`、`skill.json`、`SKILL.md` 的实体、入口、references 已同步。
- [ ] 无秘密、Token、个人敏感信息、危险 URL、路径穿越、符号链接或可执行内容。
- [ ] 不要求自动安装/连接外部 MCP/API，不索取或注入凭证，范围外问题会返回索引。
- [ ] 文字与素材有权提交；第三方来源和 assets 授权已记录。
- [ ] 已人工检查提示注入、隐蔽指令和越权工具调用，而非只依赖 CI。

## 官方身份（无变更也请确认）

- [ ] 本 PR 未自行声称官方；官方状态仍由平台维护者独立人工核验。
- [ ] 若申请官方标记，已附独立证据，并等待维护者填写 method/reviewer/verifiedAt/evidenceUrl；作者未自行批准。

证据或“不适用”说明：

## 本地验证

- [ ] `npm test`
- [ ] `npm run validate`
- [ ] `npm run build:registry`

粘贴结果、registry diff/统计摘要及需要 reviewer 注意的事项：

## 回滚

说明如何通过 `suspended`、修正 PR 或平台 active 版本回滚撤销此变更：
