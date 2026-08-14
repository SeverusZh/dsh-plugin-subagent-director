# 安装到 web profile 记录（dsh-plugin-subagent-director）

日期：2026/8/14 20:18:34
执行者：Subagent Director 安装执行者
目标 profile：C:\Users\Sev\.dsh\profiles\web
插件源码：E:\MyProjectCollection\Plugins\dsh-subagents-options（host name=subagent-director）

---

## 步骤 1：备份（完成）
- 备份目录：E:\MyProjectCollection\Plugins\dsh-subagents-options\smoke\backup-web-profile\
- 已复制（保留原名）：
  - package.json
  - cordis.patch.yml

## 步骤 2：修改 package.json（完成）
在 dependencies 中新增：
  "dsh-plugin-subagent-director": "link:E:/MyProjectCollection/Plugins/dsh-subagents-options"
（与既有 dsh-yolo-mode 同风格，仅新增此字段，其余字段未改。）

## 步骤 3：修改 cordis.patch.yml（完成）
在文件末尾追加第三个 - insert: 块：
- insert:
    - id: subagent-director
      name: dsh-plugin-subagent-director
      config:
        subagentProvider: spawn
（缩进与既有块一致；前两个块 dsh-notify、yolo-mode 原样保留。）

## 步骤 4：pnpm install（完成）
- 目录：C:\Users\Sev\.dsh\profiles\web
- pnpm 版本：11.21.0
- 输出尾段：
  ✓ Lockfile passes supply-chain policies (verified 42m ago)
  Already up to date
  Done in 300ms using pnpm v11.21.0
- 退出码：0（无报错）

## 步骤 5：验证
### 5a. node 解析（通过）
- profiles/web/node_modules/dsh-plugin-subagent-director 存在
- 其 package.json `name` = dsh-plugin-subagent-director，version 0.1.0

### 5b. dump-config（通过）
命令：E:\DeepSeekHarness\node_modules\.bin\dsh.cmd --profile web --dump-config（不启动服务、不占端口）
输出中确认包含：
  > - id: subagent-director
  >   name: dsh-plugin-subagent-director
      config:
        subagentProvider: spawn
退出码 0。

### 5c. settings.yaml / .credentials.yaml 未改动（通过）
执行安装前未写这两个文件；仅读取用于比对：
- settings.yaml LastWriteTime: 08/14/2026 19:11:19（早于本次安装，未改动）
- .credentials.yaml LastWriteTime: 08/13/2026 22:16:29（未改动）
（未读取/打印任何密钥值。）

## 步骤 6：收尾
- 未重启/未启动任何服务，未占用/绑定 3080，未 kill 现有 dsh web 进程。
- 插件将在用户下次重启 web 应用后生效。
