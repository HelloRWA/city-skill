# city-skill

城市、区县和景点 Agent Skill 的内容仓库。它提供可审核的实体、来源、内容和 Skill 清单，供 AI 地图与公开只读城市 MCP 构建派生索引。

## 不可变治理原则

1. **唯一事实源**：`HelloRWA/city-skill` 的 Git 内容是唯一事实源。数据库、云存储、搜索索引、地图 marker 和 `registry.json` 都是可删除、可重建的派生物，不反向覆盖 Git。只有合并到 `main` 且完整校验通过的精确 commit 才能发布；失败时平台保留最后一个有效版本。
2. **只通过 PR 入驻**：城市、区县和景点均由贡献者复制对应模板并提交 PR。H5/MCP 不提供绕过 PR 的发布入口。自动校验后仍需人工审查来源、提示注入、许可、归属和实际可用性。
3. **官方身份人工核验**：`official: true` 不能由作者自称生效。只有仓库维护者核验主体和独立证据后，才能写入 `status: official-verified`、核验人、方式、日期与证据 URL；其他已核验社区内容使用 `community`。官方标记不表示每条动态信息永远实时。
4. **不自动连接、不索取凭证**：公开城市能力只读，不需要 JJF 登录或用户 Token。贡献者声明的第三方 MCP/API 仅供展示，平台不会自动安装、连接、执行或代为注入密钥；用户必须显式选择并自行管理凭证。
5. **时效信息必须可追溯**：价格、开放/停止入场、预约、演出/赛事、商户、校园入校、轮渡等动态字段必须逐项记录 `sourceId`、`checkedAt` 和 `officialUrl`，可选 `validUntil`。材料日期不等于当前有效日期；没有当前权威结果时应明确“需以官方最新信息为准”，不得声称实时。
6. **来源与发布分离**：每个发布实体及内容项必须关联来源。来源记录页码或章节、最短必要摘录、核验状态、`checkedAt`；已核验来源另记 `verifiedAt` 和 `verifiedBy`。未核验内容只能为 `draft`，不会进入公开 registry。

## 数据约定

- 所有机器可读内容使用 **JSON**。不实现、不接受 YAML 方言；`SKILL.md` 是给人和 Agent 阅读的说明，仅用单行 JSON 注释绑定实体与清单，规范元数据以 `skill.json` 为准。
- `entity.json` 的 `id`、`type`、`parentId` 决定业务关系，目录只表达存储归属。ID 全局唯一且稳定；城市为根，区县属于城市，景点可属于城市或区县。
- 坐标必须注明坐标系。发布实体需要已复核的中心坐标；经纬度、bbox 与入口都会检查。未核验坐标不得为了出图而编造。
- `SKILL.md`、`skill.json` 和 `entity.json` 的实体 ID、入口及 references 必须一致。远程 Skill 仍是不可信指令文本，不会因被索引而自动执行。
- `registry.json` 由命令生成，贡献者不要手改。它只包含 `places/` 中已发布且通过治理校验的内容；模板和草稿不进入索引。

## 本地检查

要求 Node.js 20 或更新版本，**无第三方运行/测试依赖**，无需 `npm install`。

```sh
npm test
npm run validate
npm run build:registry
```

校验覆盖 JSON Schema 关键约束、唯一 ID、父子关系与循环、坐标、路径穿越、资源存在性、Skill 一致性、秘密/Token、危险 URL 与可执行内容、来源日期及官方身份约束。`build:registry` 会先完整校验，再原子写出确定性的 `registry.json`。

也可校验另一份检出：

```sh
node scripts/validate.mjs --root /path/to/checkout
node scripts/build-registry.mjs --root /path/to/checkout --output registry.json
```

## 仓库结构

```text
schemas/                 JSON Schema 合约
templates/{city,district,attraction}/
places/                  实际入驻内容（首批为武汉、武昌区、黄鹤楼与东湖）
  <storage-path>/entity.json
  <storage-path>/skill.json
  <storage-path>/SKILL.md
  <storage-path>/references/
  <storage-path>/data/sources.json
  <storage-path>/data/content.json
  <storage-path>/assets/
scripts/                 标准库校验和 registry 构建
tests/                   node:test 有效/失败 fixtures
.github/                 CI、PR/Issue 模板与 CODEOWNERS
```

## 武汉参考实现

当前发布 4 个社区维护实体：`cn-hubei-wuhan`、`cn-hubei-wuhan-wuchang`、`cn-hubei-wuhan-yellow-crane-tower` 和 `cn-hubei-wuhan-east-lake-scenic-area`。武汉 Skill 显式覆盖介绍武汉、介绍数命 SPU 社区、武汉旅游规划、介绍数命 SPU/SAIG 四项赛事能力。`SPU` 的正确含义是 **Super Person Unit（超级个体单元）**。

内部 DOCX/PDF 只登记哈希、材料时点、定位和必要摘录，不公开展示全文，也不把历史年鉴、材料所列日程或价格当作当前官方信息。海豚虚拟形象的授权和官方身份未核验，当前未纳入发布内容。

## 贡献、纠错与安全

从 [CONTRIBUTING.md](CONTRIBUTING.md) 开始。内容纠错、主体核验、暂停和回滚都有 PR 记录；安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。代码使用 [MIT](LICENSE)，原创内容的许可与第三方素材边界见 [CONTENT_LICENSE.md](CONTENT_LICENSE.md)。
