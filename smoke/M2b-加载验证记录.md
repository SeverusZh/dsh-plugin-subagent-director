# M2b 冒烟验证记录：client 插件真实加载

> 目标：验证 dsh-plugin-subagent-director 的 client bundle 在真实 web profile（smoke-web）中被加载
> 机制前提见 M2-机制研究.md；三条件链：entry(loader) + dsh.client.platform='web' + exports["./client"]→构建后的 bundle
> 红线：不动 profiles/web；不用 3080（用 3090）；结束后杀服务器进程。

## 步骤 0：构建确认
- lib/client/index.js 已构建为 `window.__ModuleLoader__.load({ id: 'dsh-plugin-subagent-director', factory: ... })` 的 CJS bundle（1368 行）。
- package.json：`dsh.client.platform='web'`，`exports["./client"]` = `{"types":"./lib/client/index.d.ts","default":"./lib/client/index.js"}`（default 单层字符串，符合 clientExportOf 只认字符串/一层 default）。

## 步骤 1：创建独立 web profile（smoke-web）
- profile 目录：C:\Users\Sev\.dsh\profiles\smoke-web
- package.json：name=dsh-profile-smoke-web；dsh.profile.bundles=["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]；dependencies={`dsh-plugin-subagent-director`:`file:E:/MyProjectCollection/Plugins/dsh-subagents-options`}
- cordis.yml：[]（与 web profile 同格式）
- cordis.patch.yml：insert [{ id: subagent-director, name: dsh-plugin-subagent-director, config:{ subagentProvider: spawn } }]
- pnpm-workspace.yaml：复制 web profile（packages:[.] / nodeLinker: hoisted / autoInstallPeers:false）
- 依赖安装：`corepack pnpm install --dir profiles/smoke-web` → exit 0，+1 包。
- 解析确认：`profiles/smoke-web/node_modules/dsh-plugin-subagent-director` 存在，node resolve → name=dsh-plugin-subagent-director version=0.1.0。✓

## 步骤 2：--dump-config 验证
- 命令：`dsh --profile smoke-web --dump-config`，exit 0。
- 最终配置树末尾（host 侧可见，带来源标记）：
  ```
  # == C:\Users\Sev\.dsh\profiles\smoke-web\cordis.patch.yml
  - id: subagent-director
    name: dsh-plugin-subagent-director
    config:
      subagentProvider: spawn
  ```
- 判定：插件行已出现在最终配置树。✓## 步骤 3：启动 web 服务器（--port 3090）
- 命令与工作目录：`C:\Users\Sev\.dsh\smoke-web-work` 下运行 `E:\DeepSeekHarness\node_modules\.bin\dsh.cmd --profile smoke-web --port 3090`（后台，输出重定向）。
- 就绪：轮询 http://127.0.0.1:3090 直到 HTTP 200（tick 1 即就绪）。
- 进程树：dsh.cmd (PID 23756) → node.exe bin.js (PID 34588，持有 3090 监听)。stdout 横幅：`dsh web: http://127.0.0.1:3090`。

## 步骤 4：验证证据

### 4a. 首页 HTML 含 __DSH_BOOT__ 且 boot 数据含本插件 entry ✓
- GET http://127.0.0.1:3090/ → 200，htmlLen=12258，`__DSH_BOOT__` 存在=True。
- boot entries 中本插件行（完整一致，inject 与 dsh.client.inject 声明一致）：
  ```json
  {"id":"dsh-plugin-subagent-director","url":"/plugins/dsh-plugin-subagent-director/client.js?rev=8ddc011eb497","rev":"8ddc011eb497","inject":["slots","locale","connection","remote"]}
  ```
- 即插件已被 ClientModuleRegistry 扫描进 client modules graph，bundle 路由已注册。

### 4b. GET /plugins/dsh-plugin-subagent-director/client.js ✓
- GET http://127.0.0.1:3090/plugins/dsh-plugin-subagent-director/client.js → `status=200`。
- Content-Type: `text/javascript; charset=utf-8`；Content-Length=44664。
- 内容以 `window.__ModuleLoader__.load` 开头（`StartsWith==True`）。
- 头 3 行：
  ```
  window.__ModuleLoader__.load({
  	id: "dsh-plugin-subagent-director",
  	factory: (require) => {
  ```
- 与本地构建 lib/client/index.js 逐字节一致（servedLen=builtLen=44664，identical=True）；尾部分明完整（`return module.exports;` + `});`）。
- bundle 尾部可见真实 client 逻辑：`ctx.slots.inject("settings.section", ...)` 注册 id=subagent-director 的 section（label t("nav") / locale NS / inject injected / SubagentOptionsSection）。

### 4c. 服务器启动日志无装配错误 ✓
- stdout（web-server.log）=31B：仅横幅 `dsh web: http://127.0.0.1:3090`。
- stderr（web-server.err.log）=0B。
- 对两日志 grep `error|exception|warn|MissingClientBundle|declares dsh.client` → 0 命中。

### 4d. MissingClientBundleError / "declares dsh.client but exports no ./client bundle" 
- 未出现。三条件链全部成立（loader entry + dsh.client.platform='web' + exports["./client"]→构建后 bundle），故 bundle 正常分发。
- 修复建议：无（验证通过，无需修复）。若未来出现，先核对 exports["./client"] 的 default 是否指向真实构建产物与 pnpm 是否把插件装进 profile/node_modules。

## 步骤 5：收尾
- 杀掉本实验 web 服务器进程：node.exe bin.js (PID 34588，持 3090) 与 dsh.cmd wrapper (PID 23756) → Stop-Process -Force。
- 端口 3090 释放确认：`PORT_FREE count=0`。
- 无残留 smoke-web 进程（仅查询命令自身临时 pwsh 命中，随后消失）。
- 预先存在于 3080 的 DSH Web GUI（PID 8124，`dsh ... web`）为既有进程，非本实验启动，未触碰（红线）。
- 退出码：进程被杀（已收集证据后再杀）；启动期 stdout 横幅正常、stderr 空（0B）即装配退出码路径健康。
- 日志尾部：
  - stdout（web-server.log，31B）：`dsh web: http://127.0.0.1:3090`
  - stderr（web-server.err.log）：（空）

## 结语
client 插件（dsh-plugin-subagent-director）在独立 web profile（smoke-web，--port 3090）中**真实加载成功**：进入 __DSH_BOOT__ client modules graph、经 /plugins/.../client.js 以 __ModuleLoader__.load bundle 形态分发 200、内容与本地构建逐字节一致、启动日志无任何装配错误。三条件链（entry + dsh.client.platform='web' + exports["./client"]→构建产物）全部成立。
