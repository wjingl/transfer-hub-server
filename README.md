# Transfer Hub 传输中枢 · 服务器管理版

内网部署的**文件外发登记与传输系统**：用户登录 → 在外发工作台选择文件/文本、指定目的地（**jzw / bgw / my / sjw**）→ 通过内嵌传输内核播放二维码/彩色条码 → 系统自动登记本次外发；普通用户仅见自己的记录，**总管理**可见全部记录、全局统计与审计日志。

传输内核为 **TransferHub**（RaptorQR 标准二维码 + Cimbar 彩色码双协议）构建产物的**字节原样副本**（含官方 sz3/libcimbar v0.6.8 运行时，未做任何修改），由本项目以「父页面工作台 + 同源 iframe」方式驱动与登记；管理后台（账号审批/记录/统计/审计/备份/部署脚本）沿用成熟方案。

- 适配 **Linux x86 服务器**（无外网环境可离线部署），默认端口 **1145**
- 管理端：Express 5 + better-sqlite3(WAL) + helmet + 会话/限流/CSRF/验证码/锁定
- 统计图形化：每日趋势、目的地环形图、每人条形图（零依赖本地 SVG）
- 仅接收分发：`/receiver` 提供与服务器内核同一构建的**仅接收**电脑包（zip）与 Android 应用（APK）——文件外发只能通过平台工作台（带登记监管）进行；跨设备摄像头接收用离线包本机打开（摄像头需 HTTPS 或 localhost）

---

## 一、架构总览

```
浏览器（办公网）                          服务器（Linux x86，内网 1145）
┌────────────────────────────┐           ┌───────────────────────────────────┐
│ 管理页（登录/记录/统计/用户） │ ────────▶ │ Express 5 + helmet + 会话          │
│ 外发工作台 /app             │            │   ├─ better-sqlite3 (WAL)         │
│   ├─ 登记条（目的地/备注）    │            │   ├─ 记录/统计/审计/备份            │
│   └─ iframe /hub 传输内核    │            │ └─ webapp/dist（TransferHub 原样）  │
│ 离线收发包 /receiver 下载    │            │   RaptorQR + Cimbar（官方运行时）   │
└────────────────────────────┘           └───────────────────────────────────┘
                                          数据(data/)：db.sqlite + 日志 + 备份
```

| 模块 | 说明 |
|---|---|
| `app/server.js` | Express 5 入口：helmet/CSP 分级、会话、限流、CSRF、优雅停机；`/hub` 静态托管传输内核、`/app` 工作台、`/receiver` 离线包 |
| `app/static/pages/workbench.html` + `app/static/js/workbench.js` | 外发工作台：父页面登记条（目的地/备注）+ 同源 iframe 内嵌内核；读取内核内用户选择的载荷元数据 → 创建记录 → 联动「开始发送/停止」走完记录状态机；未登记直接发送会收到提醒（不阻断） |
| `webapp/dist` | 传输内核（TransferHub 构建产物，字节原样；`scripts/prep.js` 校验完整性并生成 `webapp/VERSION.json` 清单） |
| `webapp/transfer-hub-receiver-offline.zip` / `webapp/transfer-hub-receiver-android.apk` | **仅接收**分发物（电脑 zip / Android APK，与 `/hub` 同一构建 + 接收守卫），从 `/receiver` 页下载；由 `npm run build:receiver` 生成 |
| `app/db.js` / `app/auth.js` / `app/users.js` / `app/records.js` / `app/backup.js` | SQLite(WAL) 参数化查询、注册-审批-登录（锁定+验证码）、用户管理、外发记录与统计、内容备份（保留期清理） |
| `app/static/js/charts.js` | 零依赖 SVG 图表（暗色主题） |
| `scripts/cli.js` | 离线维护（建号/重置/备份/导出/统计） |
| `deploy/*.sh` | 一键部署与维护（systemd、备份、更新、启停） |

### 传输内核说明（重要）

- `webapp/dist` 为 **TransferHub 的字节原样分发**：不修改、不注入、不改名；官方 Cimbar 运行时（cimbar_js wasm/glue、send/recv worker）保持官方发布文件名与内容，哈希清单见 `webapp/VERSION.json`。
- 记录登记不依赖对内核的改动：工作台作为同源父页面，通过标准 DOM 读取用户在内核页面上选择的文件/文本，经 `/api/records` 落库；内核的「开始发送/停止」状态被监听以推进记录状态机（sending → completed / failed / stopped）。
- 协议约定：发送与接收必须同协议（RaptorQR↔RaptorQR，Cimbar↔Cimbar）。

## 二、开发环境

```bash
npm install
npm run prep            # 校验 webapp/dist 与分发物完整性，生成 VERSION.json
npm run build:receiver  # 生成仅接收分发物（zip + 重签 APK）——分发物缺失时必须先执行
npm test                # 全量服务端测试（node --test）
npm start               # 本地启动（读 config.json，默认 1145）
```

首次启动访问 `http://127.0.0.1:1145/setup` 创建总管理。

## 三、部署与升级（一键化，服务器离线可用）

### 1. 在联网构建机打部署包

```bash
npm install            # 首次
npm run package        # 产物：dist/transferhub-server_v<版本>.tar.gz（含 node_modules，17MB 左右）
# 或 npm run package -- --no-deps   # 不带依赖（目标机可联网 npm install 时用）
```

打包前自动执行 `build:receiver`（重建仅接收分发物）与 `npm run prep` 完整性校验，不通过坚决不出包；包内附带 `SHA256SUMS.txt` 供部署侧核验。若把 Node 24 linux-x64 解压为项目根的 `runtime/`，打包时会自动捆绑（目标机零环境）。

### 2. 目标服务器一键部署

```bash
tar xzf transferhub-server_v1.2.0.tar.gz && cd transferhub-server_v1.2.0
sudo ./deploy/deploy.sh            # systemd 加固服务 + 开机自启 + 健康检查
# 可选环境变量：INSTALL_DIR=/opt/transferhub PORT=1145 HOST=0.0.0.0 SERVICE_USER=thub
# 管理员引导：RQR_ADMIN_USERNAME=xx RQR_ADMIN_PASSWORD=xx sudo -E ./deploy/deploy.sh
```

脚本自动完成：Node 运行时检测（捆绑优先）→ 依赖校验 → **传输内核完整性校验（prep）** → 安装（保留 data/ 与 config.json）→ 专用账号 → systemd（带 ProtectSystem 等加固）或 nohup 回退 → 健康检查 → 输出访问地址。

### 3. 一条命令更新新版本

```bash
# 构建机出新包后上传，服务器上执行：
./deploy/update.sh /path/to/transferhub-server_v1.3.0.tar.gz
```

更新流程自动：停服 → **在线备份数据库** → 替换代码（保留 data/ 与 config.json/secrets）→ **新包内核校验（prep，失败自动中止并提示回滚）** → 重启 → 状态确认；上一版完整保留在 `.update-prev/` 供随时回滚。

### 4. 日常运维命令

| 命令 | 作用 |
|---|---|
| `./deploy/status.sh` / `start.sh` / `stop.sh` / `restart.sh` | 服务启停与状态（systemd/nohup 自适应） |
| `./deploy/logs.sh [行数]` | 跟踪服务日志（journalctl 或 nohup.log 自适应） |
| `./deploy/backup.sh` | SQLite 在线安全备份 + secrets，默认保留 7 份 |
| `node scripts/cli.js health` / `stats` / `backup` / `create-admin` / `reset-password` / `export-records` | 本机离线维护 CLI |

## 四、配置要点（config.json）

| 键 | 说明 |
|---|---|
| `port` / `host` | 默认 1145 / 0.0.0.0 |
| `destinations` | 目的地代码表，工作台下下拉框与记录校验共用 |
| `backup.enabled / maxFileBytes / retentionDays` | 外发内容备份（工作台自动 base64 上传落盘，超限自动跳过备份仅登记元数据） |
| `https.enabled` | 内网建议保持关闭；摄像头接收请用离线包（见下） |
| `admin.bootstrap` | 部署引导建管（默认关闭时可走 /setup 向导） |

## 五、使用流程

1. 总管理在 `/users` 审批注册账号（或批量注册）。
2. 用户登录后进入 **工作台 `/app`**：在内嵌内核中选择文件（或输入文本）→ 在登记条选择**目的地**、填备注 → 点击 **「① 登记并开始外发」**（自动创建记录并开始播放）。
3. 对方设备用 **离线收发包**（`/receiver` 下载）或本机 `/hub` 打开接收页扫描还原。
4. 发送停止后记录自动置为 **已完成**；出错自动置为 **失败**；工作台只提供「外发完成」，**不提供手动撤销**——外发超过 10 分钟（`sendTimeoutMinutes` 可配置）未完成将被自动截止并标记失败（服务端另有每分钟兜底巡检，页面中途关闭的遗留记录同样会被截止）。
5. 总管理在 `/records` `/stats` `/audit` 查看全部记录、统计与审计。

## 六、安全说明

- 管理端页面 CSP 严格（`frame-ancestors 'none'`、无内联脚本）；仅 `/hub` 内核页放行 WASM/blob worker/内联样式，且仅允许同源 iframe 嵌入。
- `Permissions-Policy` 默认禁用摄像头，仅 `/hub` 放行 `camera=(self)`。
- 会话 Cookie HttpOnly + SameSite=Strict；登录限流+锁定+验证码；写接口强制 CSRF；全参数化 SQL。
- 浏览器仅在 HTTPS 或 localhost 下允许摄像头：跨设备摄像头接收请使用离线包在本机打开（localhost）。

## 七、升级传输内核

用新版 TransferHub 构建产物整体替换 `webapp/dist/`，**随后必须执行 `npm run localize` 做全盘中文化**（精确字符串变换，替换表见 scripts/localize-webapp.mjs；bundle 更新后命中数不符会报错阻止），并放入同构建的完整版 APK（`webapp/transfer-hub-android.apk`，作为仅接收 APK 的重打包底稿），然后 `npm run build:receiver` 重新生成仅接收分发物、`npm run prep` 校验（清单自动刷新）。不要手工修改 `webapp/dist` 内任何文件；接收守卫只存在于衍生副本 `webapp/receiver-only/`。
