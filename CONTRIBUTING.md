# 贡献指南 · Subagent Director

感谢你愿意为本项目做出贡献！

> 为 DeepSeek Harness 的 subagent 指定 LLM 供应商与模型，并用「角色模板」规划主代理与子代理的分工。

---

## 开始之前

- **环境**：Node.js **>= 20**（CI 使用 22）
- **包管理器**：**npm**（仓库带 `package-lock.json`） —— 请勿混用其它包管理器（会产生不同的依赖解析与锁文件）。
- **克隆与安装**：

  ```bash
  git clone https://github.com/SeverusZh/dsh-plugin-subagent-director.git
  cd dsh-plugin-subagent-director
  npm ci
  ```

## 本地开发

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run typecheck` | 类型检查（`tsc --noEmit`） |
| `npm test` | 单元测试（vitest，20 个文件） |
| `npm run build` | 构建 host + client 产物到 `lib/` |

### 目录结构

- `src/` — 插件源码（host 半 + `client/` 客户端半）
- `src/delegation-tool.ts` — 委派工具（前台 / 后台 / continuable 三条路径）
- `src/close-tool.ts`、`src/remote.ts`、`src/settings.ts` — 关闭工具、数据面、设置
- `test/` — vitest 测试
- `scripts/build-client.mjs` — 客户端半打包脚本
- `docs/` — 设计与契约文档
- `.github/workflows/ci.yml` — CI（typecheck → test → build）

## 测试要求

行为改动（`src/`）必须附带测试；修 bug 请加**回归测试**，并说明它能复现旧行为。

- 提交 PR 前请**本地跑通全部命令**，并在描述里贴真实输出。
- 本仓库有 CI（`.github/workflows/ci.yml`），PR 必须全绿。

## 注意事项

- **必须用 npm。** 不要用 pnpm —— 它的嵌套 `node_modules` 布局会让 `tsc` 触发 `TS2883`（无法在不引用 `.pnpm/...` 路径的前提下命名推断类型），typecheck/build 会假性失败。
- 改动执行路径（前台 / 后台 / continuable）时，**三条路径都要覆盖**：它们走的是不同的内核接口。
- 后台委派的 `owner` 必须传**父 agent 的 session id 字符串**，不是 agent 对象——内核 `resolveOwner()` 按 SessionId 索引活跃 agent，传对象会得到 `[object Object]` 报错（见 Issue #10）。

---

## DSH 版本兼容

本插件跑在 DeepSeek Harness（DSH）之上，**兼容性由 `package.json` 里的 peer 声明决定**，
不是靠文档承诺。

### 兼容门禁的机制

DSH 启动时会检查插件的 `peerDependencies`：对 `@deepseek-ai/dsh` 与
`@deepseek-ai/dsh-*` 前缀的条目做 **`includePrerelease: true` 的 semver 校验**。
任一不满足当前宿主版本，DSH 会**跳过整个插件**（并在日志里提示可用
`dsh plugin allow-version` 做精确版本豁免）。

> 注意：`@deepseek-ai/cordis` **不参与**该门禁（前缀不匹配），所以不要靠它表达 DSH 兼容性。

### 范围写法

采用**无上限的 `>=<最低实测版本>`**（当前为 `>=0.1.7-rc.1`），而不是 `^0.x`：

- `^0.1.7-rc.1` 在 semver 里只覆盖 `0.1.x`，宿主每次跨 minor（如 0.2.0）都会重新触发门禁；
- `>=0.1.7-rc.1` 在**实测兼容**的前提下覆盖后续版本，避免每个宿主小版本都要改一次。

改这个范围属于**对外承诺**，必须有实测支撑（见下）。

### `dsh.compatibility.dshReleases` 兼容矩阵

`package.json` 里的 `dsh.compatibility.dshReleases` 用于声明**逐版本**的兼容状态
（DSH 市场/收录方会读它）。填写纪律：

- **只填你真正实测过的版本**，标 `compatible`；
- 未实测的**不要填**，也不要标 `compatible`——宁可留空，不可虚标；
- 升级宿主后，先按上面的命令实测，再补矩阵条目。

## 提交与分支约定

- **commit 信息用中文**，说清「改了什么、为什么」；一个提交做一件事。
- **分支**：迁移/开发用 `dev-<DSH 版本>`（例如 `dev-0.2.1.alpha.2`）；**发版走 `main`**。
- 不要把 `main` 与 `dev-*` 互相强行同步——两者承担不同职责，落后/领先是正常状态。

## 发布流程（维护者执行）

1. **先在 `dev-<DSH 版本>` 分支验证**，通过后发 **npm beta**：
   ```bash
   npm publish --tag beta   # 绝不动 latest
   ```
2. **`latest` 只跟随 DSH 的 rc 版**：
   - 面向 DSH **alpha / next 线**的适配**只发 beta**，不进 `latest`；
   - 等对应 DSH 走到 **rc** 阶段，再正式发布。
   > 原因：alpha/next 线接口仍在变，把 `latest` 绑上去会让普通用户被兼容门禁拦在门外。
3. **正式版**（进 `latest`）需要：bump `package.json` 版本 + 写 `CHANGELOG.md` 对应段落
   + 打 git tag + 建 GitHub Release + `npm publish`（默认 latest）。
4. **beta 提交只 bump `package.json`，不写 CHANGELOG 段落**（正式版才写）。

## 提 PR

- 一个 PR 只做一件事，范围尽量小。
- 在描述里讲**为什么**（动机 / 现象 / 根因），实现细节让 diff 自己说话。
- **附可复核的证据**：跑了什么命令、实际输出是什么。不要只写「已测试通过」。
- 改到 `peerDependencies` / 兼容矩阵的 PR，请附上对应宿主的实测结果。
- CI 必须全绿（有 CI 的仓库）。

## 许可证

本项目基于 **MIT** 许可证。提交贡献即表示你同意以相同许可证发布你的改动。

