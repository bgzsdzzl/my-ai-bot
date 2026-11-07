# GitHub App AI 助手（Probot + Cloudflare Workers AI + Turso）

隐私优先、零成本部署的 GitHub App 机器人：

| 事件 | 行为 |
| --- | --- |
| `issues.opened` | AI 分析 Issue 内容并自动打推荐标签，输出分析评论（带缓存） |
| `issue_comment.created` | `@机器人 指令` 进行问答，可返回标签操作 |
| `issue_comment.created` | `@机器人 全仓审查` 输出仓库结构分析（仅白名单，每日 1 次） |
| `pull_request.opened` / `synchronize` | 结合 Diff、上下文代码、CI 状态自动审查 PR |
| `release.published` | 润色 Release Notes 并输出到日志（不自动写回 GitHub） |

## 目录结构

```
├── index.js                 # Probot 入口 + 事件注册 + /ping 保活接口
├── utils.js                 # Turso 客户端、AI 调用、配额、缓存、工具函数
├── handlers/
│   ├── issueOpened.js       # Issue 自动分析
│   ├── mention.js           # @ 提及问答
│   ├── prReview.js          # PR 自动审查
│   ├── fullRepoReview.js    # 全仓结构审查（白名单）
│   └── release.js           # Release Notes 润色
├── keepalive-worker.js      # Cloudflare Worker 保活脚本（Cron 每 10 分钟）
├── .env.example
└── package.json
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `APP_ID` | GitHub App ID（数字） |
| `PRIVATE_KEY` | `.pem` 私钥完整内容（含 BEGIN/END 行） |
| `WEBHOOK_SECRET` | Webhook 签名密钥（随机 32 字节 base64） |
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `CF_API_TOKEN` | Workers AI Read 权限的 API Token |
| `TURSO_URL` | `libsql://xxx.turso.io` |
| `TURSO_TOKEN` | Turso Token |
| `WHITELIST_USERS` | 逗号分隔的用户名，拥有全仓审查权限 |
| `BOT_NAME` | GitHub App 名称，用于 @ 提及解析 |
| `PORT` | 监听端口（可选，默认 3000） |

## 一、准备账号与密钥（全部无需绑卡）

### 1.1 创建 GitHub App

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**。
2. 名称随意（例如 `my-ai-bot`），记下来填入 `BOT_NAME`。
3. Homepage URL 随意；Webhook URL 先填占位地址，部署完成后再改（见第四节）。
4. Webhook secret：本地生成随机值并填入 `WEBHOOK_SECRET`：

   ```bash
   openssl rand -base64 32
   # 或者
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

5. 权限（Permissions）：

   | 权限 | 级别 | 用途 |
   | --- | --- | --- |
   | Issues | Read & write | 打标签、发评论 |
   | Pull requests | Read & write | PR 评论、读取 Diff |
   | Contents | Read-only | 读取文件、生成 Release Notes |
   | Checks | Read-only | 读取 CI 状态 |
   | Metadata | Read-only | 必选 |

6. 订阅事件（Subscribe to events）：**Issues、Issue comment、Pull request、Release**。
7. 创建后：记录页面顶部 **App ID**（填 `APP_ID`）；页面底部 **Generate a private key** 下载 `.pem` 文件。
8. **Install App**：把 App 安装到目标仓库。

### 1.2 Cloudflare Workers AI

1. 注册/登录 [dash.cloudflare.com](https://dash.cloudflare.com)（免费，无需绑卡）。
2. 记录右侧的 **Account ID**（填 `CF_ACCOUNT_ID`）。
3. 右上角头像 → My Profile → API Tokens → **Create Token** → 自定义：
   - Permissions：`Account` → `Workers AI` → `Read`
   - 创建后复制 Token（填 `CF_API_TOKEN`）。
4. 免费额度：每天 10,000 Neurons，个人使用足够；官方承诺数据不用于训练。

### 1.3 Turso 数据库

1. 注册 [app.turso.tech](https://app.turso.tech)（免费），**Create Database**（地区选离 InstaBox VM 近的）。
2. 记录数据库 URL（`libsql://...turso.io`）填 `TURSO_URL`；进入数据库 → **Create Token** 生成 Token 填 `TURSO_TOKEN`。
3. 在 SQL Console 执行建表语句：

   ```sql
   CREATE TABLE IF NOT EXISTS ai_cache (
     cache_key TEXT PRIMARY KEY,
     response_body TEXT NOT NULL,
     created_at INTEGER DEFAULT (unixepoch())
   );
   CREATE TABLE IF NOT EXISTS kv_store (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     created_at INTEGER DEFAULT (unixepoch())
   );
   ```

## 二、本地准备

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
# 编辑 .env 填完整所有变量
npm start
```

启动后访问 `http://localhost:3000/ping`，应返回 `pong`。

`PRIVATE_KEY` 的粘贴格式（双引号包裹、保留换行）：

```
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
（中间省略）
-----END RSA PRIVATE KEY-----"
```

## 三、推送到 GitHub

```bash
git init
git add .
git commit -m "init github-ai-bot"
git remote add origin <你的仓库地址>
git push -u origin main
```

`.env` 已在 `.gitignore` 中，不会被提交。

## 四、部署到 InstaBox

SSH 进 InstaBox VM 后：

```bash
git clone <你的仓库地址>
cd <仓库目录>
npm install
nano .env        # 粘贴完整环境变量，Ctrl+O 保存，Ctrl+X 退出
npx pm2 start npm --name "bot" -- start
npx pm2 save && npx pm2 startup
instabox port publish 3000 --name 'bot'
```

`instabox port publish` 会输出一个 HTTPS 地址，做两件事：

1. 配置到 GitHub App：Settings → Developer settings → GitHub Apps → 你的 App → **Webhook URL**：

   ```
   https://<instabox输出的地址>/api/github/webhooks
   ```

2. 验证保活接口：

   ```bash
   curl https://<instabox输出的地址>/ping   # 返回 PONG（Probot 13 内置健康检查接口）
   ```

## 五、保活 Worker（防免费档休眠）

InstaBox 免费档有「30 分钟空闲暂停」和「8 小时强制暂停」，用 Cloudflare Worker 定时拉起：

1. Cloudflare Dashboard → Workers & Pages → **Create Worker**。
2. 粘贴 `keepalive-worker.js` 内容，把 URL 改成你的 InstaBox 公网地址 + `/ping`，Deploy。
3. 进入 Worker → Settings → Triggers → **Cron Triggers** → Add：

   ```
   */10 * * * *
   ```

4. 每 10 分钟请求一次 `/ping`（Probot 13 自带该路由，返回 200/PONG，无需自行注册）；8 小时强制暂停后的冷却约 10 分钟，恰好被下一次 Cron 自动拉起。

## 配额与缓存

| 能力 | 规则 |
| --- | --- |
| Issue 分析 / 提及问答 / PR 审查 | 共用每人每日 **15 次**（`quota:日期:用户名`，Turso 原子递增） |
| 全仓审查 | 仅 `WHITELIST_USERS` 白名单，每人每日 **1 次** |
| Issue 分析缓存 | 按 `标题 + 正文` 的 SHA-256 命中缓存时不调用 AI（不消耗 Neuron） |

统计按 **UTC 日期** 归零。含「全仓审查」字样的 @ 指令由全仓审查处理器接管，不会重复回复。

## 隐私与日志

- AI 调用仅通过 `fetch` 直连 Cloudflare Workers AI REST API，无 OpenAI SDK、无任何第三方中转；Workers AI 官方承诺数据不用于训练。
- 日志只输出简短状态（如 `Issue #123 已处理，配额剩余: 12`），不输出完整 Prompt、代码内容或 AI 响应全文。
- 所有密钥仅通过环境变量注入，不入库、不硬编码。

## 常见问题

- **启动报 private key 相关错误**：`PRIVATE_KEY` 必须是完整 `.pem` 内容（含 BEGIN/END 行），用双引号包裹并保留换行。
- **GitHub 收不到事件**：检查 Webhook URL 是否为 `/api/github/webhooks`、secret 是否与 `WEBHOOK_SECRET` 一致；在 App 页面 → Advanced → Recent Deliveries 查看投递详情。
- **AI 报 `success:false`**：检查 `CF_API_TOKEN` 是否有 Workers AI Read 权限、`CF_ACCOUNT_ID` 是否正确。
- **全仓审查无响应**：确认触发者在 `WHITELIST_USERS` 中，且当日次数未用完。
- **PR 审查提示 `未知` CI 状态**：仓库没有配置 Checks，属正常现象。
- **`/ping` 返回的是 `PONG` 而不是 `pong`**：Probot 13 内置健康检查接口返回 `PONG`，保活 Worker 只看 HTTP 200，不影响使用。注意 Probot 13 已移除 `app.get()` 写法，如需自定义路由请使用导出函数的第二个参数 `options.getRouter()`。
