# 生产部署

本文档将 Church Translation 作为单个 Docker 容器部署在 HTTPS 反向代理之后。浏览器页面、Fastify API 和 WebSocket 使用同一个域名。

## 1. 部署要求

- 悉尼或其他邻近区域的 Linux 服务器。
- 一个已将 DNS 解析到服务器的域名。
- Docker Engine 和 Compose 插件。
- 开放 TCP 80 和 443 端口。使用反向代理时，不要向公网开放应用端口 3000。
- 已配置消费提醒的 Deepgram 和 OpenAI API Key。

当前单实例默认允许 10 个活动翻译会话。建议生产环境从 2 vCPU、2 GB 内存开始，使用真实音频按预期并发数做长时测试后再调整。主要瓶颈通常是 Deepgram/OpenAI 账户并发、速率配额和外部网络，而不是本地计算。

## 2. 配置密钥

在项目根目录执行：

```bash
cp .env.example .env
chmod 600 .env
```

填写生产环境配置：

```dotenv
DEEPGRAM_API_KEY=服务端密钥
OPENAI_API_KEY=服务端密钥

DEEPGRAM_MODEL=nova-3
OPENAI_MODEL=gpt-4o-mini-2024-07-18

ALLOWED_ORIGINS=https://translation.example.org
MAX_ACTIVE_SESSIONS=10
MAX_SESSION_MINUTES=180
PORT=3000
AUTH_DB_PATH=data/auth.sqlite
AUTH_COOKIE_SECURE=true
LOG_LEVEL=info
```

`ALLOWED_ORIGINS` 必须填写准确的公网 HTTPS Origin，结尾不要加 `/`。HTTPS 部署必须设置 `AUTH_COOKIE_SECURE=true`。不要将 `.env` 提交到版本控制，并且只允许部署账户读取。

空数据库首次启动会创建固定种子管理员 `FOCUS-Jayd` / `FOCUS-Jayd`。登录后从主页右上角账号面板创建普通账户；种子管理员不能在界面删除。由于该凭据固定且公开在源码中，生产环境应再叠加教会网络/IP allowlist 或 VPN，不能只依赖该账号保护公网服务。

使用 `LOG_LEVEL=info` 时，普通 API 时序和翻译队列事件不会输出；排查延迟时可以临时改为 `debug`。第三方 API 错误在默认级别下仍会记录。

### 并发模型

- 每位用户建立一条独立 WebSocket，并拥有独立的 Deepgram 连接、翻译器、上下文、计时器和翻译队列，不会互相串字幕。
- `MAX_ACTIVE_SESSIONS=10` 是单个 Node.js 进程的上限；范围为 1 至 100。达到上限时只拒绝新会话，已有会话继续运行。
- 建立 WebSocket 后 10 秒内未发送 `session.start` 的连接会自动关闭并释放名额。
- 握手速率限制为每个客户端 IP 每分钟至少 30 次，允许同一教会 NAT 网络下多人连接和少量重试。
- 每个活动会话会占用一条 Deepgram Streaming 连接，并可能同时产生一个 OpenAI 请求。必须先确认供应商账户配额和预算。
- 多容器部署时，上限按实例分别计算；若需要严格的全局上限、会话迁移或断线恢复，需要 Redis 或统一准入服务。
- API 和 WebSocket 都要求有效登录。每个浏览器会话 Cookie 有效 12 小时；删除普通账户时，其所有登录会话立即失效。

## 3. 构建并启动

验证 Compose 配置并启动容器：

```bash
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

在服务器本机检查两个健康端点：

```bash
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/ready
```

预期响应是 `{"status":"ok"}` 和 `{"status":"ready"}`。如果 `/health/ready` 返回 `503`，说明至少一个 API Key 缺失。

## 4. 配置 HTTPS 和 WebSocket 代理

除 localhost 外，麦克风和屏幕/系统音频采集必须使用 HTTPS。反向代理必须保留 WebSocket Upgrade 请求头，并允许连接空闲时间超过 `MAX_SESSION_MINUTES`。

Nginx 虚拟主机示例：

```nginx
server {
    listen 80;
    server_name translation.example.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name translation.example.org;

    ssl_certificate /etc/letsencrypt/live/translation.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/translation.example.org/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 4h;
        proxy_send_timeout 4h;
    }
}
```

使用服务器现有的 ACME/Certbot 流程签发证书，检查 Nginx 配置后重新加载。不要通过公网防火墙暴露 3000 端口；项目的 Compose 配置也只将该端口绑定到 `127.0.0.1`。

TLS 生效后验证：

```bash
curl --fail https://translation.example.org/health/live
curl --fail https://translation.example.org/health/ready
```

然后使用最新版 Edge 或 Chrome 验证麦克风授权、WebSocket 启动，以及一次完整的开始/停止翻译流程。

## 5. 日常运维

查看状态和错误日志：

```bash
docker compose ps
docker compose logs --tail=100 church-translation
docker compose logs -f church-translation
```

普通 Deepgram/OpenAI 时序事件只会在 `LOG_LEVEL=debug` 时出现。诊断结束后应恢复为 `info`，避免产生大量日志。

不重新构建，直接重启：

```bash
docker compose restart church-translation
```

发布源码或依赖更新：

```bash
docker compose build --pull church-translation
docker compose up -d church-translation
docker image prune -f
```

部署前运行发布检查：

```bash
npm ci
npm test
npm run typecheck
npm run build
```

账户和登录会话位于 `data/auth.sqlite`。每个任务的稳定 source 原文保存为 `/app/log/YYYY-MM-DD_HH-mm-ss.txt`，不保存音频、interim 文本或目标语言翻译。Compose 分别使用 `church-auth-data` 和 `church-source-logs` 卷持久化数据库与 source 文本；升级或迁移前应停止容器并备份两个卷。数据库、source 文本和 `.env` 都不应放进普通源码归档，备份文件必须限制读取权限。

## 6. 回滚

生产环境应使用不可变源码版本或带标签的容器镜像。更新前保留旧版本标签或镜像 ID。回滚时先恢复旧版本，再重新创建服务：

```bash
docker compose up --build -d church-translation
```

回滚后检查 `/health/live`、`/health/ready`、页面加载和一次短翻译会话。浏览器可能缓存旧的 Vite 资源名，切换版本后应执行强制刷新。

## 7. 安全检查

- API Key 只存在于服务端 Secret 中。
- `ALLOWED_ORIGINS` 只包含真实的 HTTPS 控制页面 Origin。
- `AUTH_COOKIE_SECURE=true`，登录失败响应不区分用户名或密码错误。
- `church-auth-data` 卷已纳入受限的备份流程，数据库文件不会提交到版本控制。
- `church-source-logs` 卷已配置保留期限、容量监控和安全删除流程；其中包含讲道 source 原文。
- 3000 端口只能由本机反向代理访问。
- 第三方 API 账户已设置消费提醒和适当限额。
- 固定种子管理员之外仍有教会网络/IP allowlist 或 VPN 保护。
- Nginx 和宿主机操作系统定期安装安全更新。
- 日志不包含讲道文字或 API Key。
- 浏览器 Network 面板和前端构建产物不包含供应商凭据。

## 8. 故障排查

### 页面正常，但无法开始

检查 `/health/ready`、`ALLOWED_ORIGINS`、浏览器控制台和容器错误日志。`ALLOWED_ORIGINS` 中的协议、主机名或端口不一致时，WebSocket Origin 校验会拒绝会话。

### 讲道期间 WebSocket 断开

确认 Nginx 的 `proxy_read_timeout` 和 `proxy_send_timeout` 大于最大会话时长，同时检查主机或云平台负载均衡器的空闲超时。

### 无法使用麦克风或系统音频

确认公网页面使用 HTTPS，并使用最新版 Edge 或 Chrome。采集 Windows 系统音频时，在浏览器提示框中选择整个屏幕并开启共享系统音频。

### 排查时序延迟

临时将 `LOG_LEVEL` 改为 `debug`，重新创建服务，然后观察 `api.deepgram.result.final`、`queue.translation.started` 和 `api.openai.responses.response` 等事件：

```bash
docker compose up -d --force-recreate church-translation
docker compose logs -f church-translation
```

诊断完成后，将 `LOG_LEVEL` 恢复为 `info` 并重新创建服务。
