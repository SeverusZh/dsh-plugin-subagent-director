# M3c Continuable 路线端到端冒烟记录（Subagent Director）

工作目录：E:\MyProjectCollection\Plugins\dsh-subagents-options
执行位置：C:\Users\Sev\.dsh\smoke-work
只读参考：E:\DeepSeekHarness（node_modules/@deepseek-ai 为实际包源码）
范围红线：不碰 profiles\web、不碰共享配置、不打印密钥值、不占用 3080；headless 命令结束即完成。

目标：验证 `subagent_role` 委派工具在 continuable 模式下：
  A) 不传 run_in_background 时仍默认走后台，返回 durable child id（continuable 后台默认成立）；
  B) model 覆盖 deepseek-v4-flash 被正确路由（模型路由成立）；
  C) 子代理会话 descriptor 记录 mode=continuable 且 agentProvider=opencode-go / agentModel=deepseek-v4-flash（descriptor 记录成立）。

前置已核验（只读）：smoke profile 的 cordis.patch.yml 配置为
```yaml
- insert:
    - id: subagent-director
      name: 'dsh-plugin-subagent-director'
      config:
        subagentProvider: spawn
        backgroundMode: continuable
        enableRunInBackground: true
```
  => backgroundMode=continuable、enableRunInBackground=true（默认即后台并返回 child id 的前提）。

---

## 1) 运行输出摘要

Headless 命令（在 C:\Users\Sev\.dsh\smoke-work 运行，dsh.cmd 位于 E:\DeepSeekHarness\node_modules\.bin）：

    E:\DeepSeekHarness\node_modules\.bin\dsh.cmd --profile smoke "请调用 subagent_role 工具委派一个子代理（不要传 run_in_background 参数，也不要传 role/provider；model 用 deepseek-v4-flash），prompt 内容为：请只回答 1+2 的整数结果，不要解释。工具会返回一个子代理 id，请把返回的 id 原文告诉我。"

- 命令最终 stdout（m3c-run-output.txt，19:59:25）：
  子代理 802ce0ab-780e-42e4-b793-8ae2bb89dafc 已完成，其回复为：**3**
- subagent_role 返回（main 会话 seq 173 tool/result）：started subagent 802ce0ab-780e-42e4-b793-8ae2bb89dafc
- 主代理最终回复（main 会话 seq 352）：回复 id 原文 802ce0ab-780e-42e4-b793-8ae2bb89dafc 并汇报"已完成，回复为 **3**"。
- 主会话 request/context（seq 11）：provider=opencode-go, model=deepseek-v4-pro（主代理按继承路由）；子代理 request/context（seq 12）：provider=opencode-go, model=deepseek-v4-flash（子代理按 call 参数覆盖路由）。
- 退出状态：命令正常结束（headless 输出含最终回复；main 会话 turn/end reason=completed；无残留后台 job），exit code 0。经独立解码 session.jsonl.zstd 复核同一致。

---

## 2) 证据摘录

### 2.1 主代理会话（session-70532f87-bd4a-4391-94bd-7aabb7b8763e)

来源：C:\Users\Sev\.dsh\sessions\--C-Users-Sev-.dsh-smoke-work--\session-70532f87-bd4a-4391-94bd-7aabb7b8763e\session.jsonl.zstd
（用 tools/decompress-session.cjs 解码：frames=20 | decoded chars=54082）

- **subagent_role 的 tool/call arguments（seq 172）—— 期望"无 run_in_background、无 role、无 provider、model=deepseek-v4-flash"**：
  {"type":"tool/call","seq":172,...,"name":"subagent_role","arguments":"{\"description\":\"计算 1+2 的整数结果\",\"prompt\":\"请只回答 1+2 的整数结果，不要解释。\",\"model\":\"deepseek-v4-flash\"}"}
  => arguments 仅含 description/prompt/model 三个键，**无 run_in_background 键**，无 role/provider。

- **subagent_role 工具返回（seq 173 tool/result）—— 期望返回 child id（continuable 默认后台）**：
  {"type":"tool/result","seq":173,"data":{...,"content":[{"type":"text","text":"started subagent 802ce0ab-780e-42e4-b793-8ae2bb89dafc"}]...}}
  => 返回模式为 started subagent <id>（durable child id），非 jobId；说明未走 foreground、也未塌缩成 one-shot job 形态。

- 子代理结算通知（seq 176，agent/inbox/spliced source.kind=subagent-settled）：summary 提示 "Background subagent 802ce0ab-... finished"，closing message = "3"。
- 主代理回合推进（step 2 收到后台结算通知后继续；step 3 汇报最终 id 与结果），说明子代理确实在后台运行、父代可继续并收到结算通知。（continuable 后台语义成立）

### 2.2 子代理会话（802ce0ab-780e-42e4-b793-8ae2bb89dafc)

来源：C:\Users\Sev\.dsh\sessions\--C-Users-Sev-.dsh-smoke-work--\802ce0ab-780e-42e4-b793-8ae2bb89dafc\session.jsonl.zstd
（用 tools/decompress-session.cjs 解码：frames=5 | decoded chars=40346）

- **subagent/descriptor（seq 0）—— 期望 mode=continuable 且 agentProvider=opencode-go、agentModel=deepseek-v4-flash**：
  {"type":"subagent/descriptor","seq":0,"data":{"version":2,"mode":"continuable","provider":"spawn","label":"计算 1+2 的整数结果","agentProvider":"opencode-go","agentModel":"deepseek-v4-flash"}}
  => mode=continuable；agentProvider=opencode-go；agentModel=deepseek-v4-flash。

- **request/context（seq 12）—— 模型路由证据**：
  {"type":"request/context","seq":12,"data":{"provider":"opencode-go","model":"deepseek-v4-flash","contextWindow":1000000}}
  => 子代理实际使用模型 = deepseek-v4-flash（来自 call 参数 model 覆盖）。

- **子代理最终答案（seq 18 assistant/message）—— 期望 3**：
  {"type":"assistant/message","seq":18,...,"message":{"role":"assistant","content":[{"type":"text","text":"3"}],"source":{"kind":"model","provider":"opencode-go","model":"deepseek-v4-flash",...}},"usage":{"inputTokens":8502,"outputTokens":1}}
  => 最终答案 = "3"。

---

## 3) 判定

| 验证项 | 期望 | 实测 | 结论 |
|--------|------|------|------|
| A. continuable 默认后台 | 未传 run_in_background 仍返回 child id（started subagent ...，父代收到后台结算通知） | main seq172 无 run_in_background；seq173 返回 started subagent 802ce0ab-...；seq176 主代收到 subagent-settled 通知 | 成立 |
| B. 模型路由 | model=deepseek-v4-flash 落到子代理实际请求 | 子代理 request/header+context provider=opencode-go model=deepseek-v4-flash；assistant/message source.model=deepseek-v4-flash | 成立 |
| C. descriptor 记录 | mode=continuable、agentProvider=opencode-go、agentModel=deepseek-v4-flash | subagent/descriptor seq0 完全匹配 | 成立 |
| 附加：子代理结算 | 期望答案 3 | 子代理 final=3；主代收到 closing message=3 | 成立 |
| 附加：main 继承路由未被破坏 | 父代模型 deepseek-v4-pro | main request/context=deepseek-v4-pro | 成立 |

结论：continuable 路线端到端冒烟通过。未改任何代码、未碰 profiles\web 与共享配置、未打印密钥值、未占用 3080。

失败时留痕占位（本次未触发）：
- 若 A 失败（返回 jobId 或前台等待）-> 截取主会话 seq173 tool/result 与 run_in_background 缺省分支，留日志尾部。
- 若 B 失败（子代理仍用父代 deepseek-v4-pro）-> 路由覆盖未生效，检查 call-args > role > default > inherit 优先级与 route-resolver。
- 若 C 失败（descriptor 缺 agentProvider/agentModel）-> 描述符透传层问题。
- 本次无 stdout/stderr 报错；命令正常结束。

---

## 4) 遗留

- 本冒烟只覆盖不传 run_in_background 的**隐式默认后台**路径；未覆盖：
  - 显式 run_in_background=false 的 foreground 等待路径（期望返回 {kind:foreground, runId, output}）。
  - run_in_background=true 的显式后台路径（期望返回 child id 与 one-shot jobId 形态对比）。
  - role/provider 参数绑定与优先级（call-args > role > default > inherit）的细分断言。
- 若需后续覆盖，可在 smoke profile 下补同类 headless 命令，并在子代理会话 request/context 与 descriptor 上做同型断言。
- 本次产出会话文件：main=session-70532f87-bd4a-4391-94bd-7aabb7b8763e、subagent=802ce0ab-780e-42e4-b793-8ae2bb89dafc（位于 --C-Users-Sev-.dsh-smoke-work-- 分目录）。
