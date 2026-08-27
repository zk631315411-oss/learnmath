# LearnMath Docker 服务器部署流程

本文档描述从 `D:\LearnMath` 主工作树构建镜像、通过 SSH 传到云服务器、切换 Nginx 流量和回滚的流程。命令示例不包含任何密钥；`runtime.env` 只在受控机器上维护。

## 服务器现状

当前云主机连接方式：

```text
SSH: root@8.134.195.113
旧项目目录: /opt/ai-math
建议新项目目录: /opt/learnmath
公网入口: Nginx :80
```

旧 `ai-math.service` 已停止并禁用，服务文件仍保留用于回滚。不要删除 `/opt/ai-math/data/learning.db`，除非经过单独的数据迁移和备份确认。

服务器只负责加载镜像和运行容器，不在低内存云主机上构建前端、安装 Python 依赖或构建 Manim 镜像。

## 1. 本机构建

正式 PV 已随 Web 镜像打包，源文件位于 `frontend/public/videos/pv-v3.6.mp4`，欢迎弹窗使用 `/videos/pv-v3.6.mp4` 播放。确认 B 站地址后，在构建前注入 `VITE_PV_BILIBILI_URL`，它会被编译进 Web 静态资源：

```powershell
$env:VITE_PV_BILIBILI_URL = "https://www.bilibili.com/video/BVxxxxxxxxx/"
powershell -ExecutionPolicy Bypass -File .\scripts\build-docker.ps1 -Service web -Version 2026.08.27.1
```

未设置该变量时，弹窗仍显示本地播放器，不显示空的外链按钮。

所有正式镜像从 `D:\LearnMath` 的 `main` 工作树构建：

```powershell
cd D:\LearnMath
powershell -ExecutionPolicy Bypass -File .\scripts\build-docker.ps1 -Service all -Version 2026.08.25.1
```

脚本会拒绝从非 `main` 分支构建。只改前端时可以只构建 `web`，只改后端时构建 `api`，改 Manim Worker 时构建 `manim`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-docker.ps1 -Service web -Version 2026.08.25.2
```

正常构建使用 Docker 缓存；只有排查缓存污染或基础依赖损坏时才使用 `-NoCache`。

## 2. 导出并传输镜像

在本机导出本次发布所需镜像：

```powershell
$version = "2026.08.25.1"
docker save `
  --output ".\release\learnmath-images-$version.tar" `
  "learnmath-api:$version" `
  "learnmath-web:$version" `
  "learnmath-manim:$version" `
  "redis:7.4.5-alpine"
```

通过 SSH/SCP 传输。SSH 私钥由本机 SSH 配置管理，不写进脚本：

```powershell
scp ".\release\learnmath-images-$version.tar" root@8.134.195.113:/opt/learnmath/releases/
scp ".\deploy\compose.yml" root@8.134.195.113:/opt/learnmath/compose.yml
```

教材 PDF 和其他部署资产也应通过 SCP 传到 `/opt/learnmath/data/textbooks/`。本次全量数据库发布副本为 `artifacts/pv-reality/template-audit/learning-release.db`，其中已包含清理后的样板数据及 `test_001`–`test_010`（统一密码 `123456`）；上传前请核对其 SHA-256。不要上传 `.env`、`deploy/runtime.env` 或任何包含密钥的文件到公开位置。

## 3. 服务器准备

首次部署时只执行一次：

```bash
ssh root@8.134.195.113
install -d -m 0755 /opt/learnmath/releases /opt/learnmath/data/textbooks
```

服务器需要维护一个只对 root 可读的配置文件（字段和值按本地正式环境同步；不要重新生成 JWT/API/Neo4j 凭据）：

```text
/opt/learnmath/runtime.env
```

至少包含：

```dotenv
LEARNMATH_VERSION=2026.08.25.1
LEARNMATH_PORT=8090
LEARNMATH_TEXTBOOKS_DIR=/opt/learnmath/data/textbooks
LEARNMATH_DATA_VOLUME=/opt/learnmath/data
APP_ENV=production
LEARNER_MODEL_ENABLED=true
JWT_SECRET=<strong-random-secret>
QA_LLM_API_KEY=<provider-key>
QA_LLM_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
QA_LLM_MODEL=qwen3.8-max
NEO4J_URI=<aura-uri>
NEO4J_USER=<aura-user>
NEO4J_PASSWORD=<aura-password>
```

设置权限：

```bash
chmod 600 /opt/learnmath/runtime.env
```

`LEARNMATH_DATA_VOLUME` 设置为绝对路径时，Compose 会将该目录挂载为 `/app/data`，因此可以在启动前完成本地数据库全量迁移：

```bash
# 本地执行
scp data/learning.db root@8.134.195.113:/opt/learnmath/data/learning.db.new

# 登录服务器后执行
install -d -m 0750 /opt/learnmath/data
mv /opt/learnmath/data/learning.db.new /opt/learnmath/data/learning.db
chown root:root /opt/learnmath/data/learning.db
chmod 0640 /opt/learnmath/data/learning.db
```

迁移前先备份服务器原库并记录 SQLite 表计数；启动后重新核对计数。不要把 `runtime.env` 放进镜像或 Git，传输后保持 `chmod 600`。

## 4. 加载镜像和启动

```bash
cd /opt/learnmath
docker load --input /opt/learnmath/releases/learnmath-images-2026.08.25.1.tar
docker compose --env-file /opt/learnmath/runtime.env -f /opt/learnmath/compose.yml up -d --no-build
docker compose --env-file /opt/learnmath/runtime.env -f /opt/learnmath/compose.yml ps
curl --fail http://127.0.0.1:8090/health
```

生产 Compose 将 API、Web、Redis、Dispatcher、Renderer 作为五个服务运行。数据使用 Docker volumes 保存，升级时不要使用 `docker compose down -v`。

## 5. Nginx 连接方式

Nginx 继续占用公网 `80`，只把旧 upstream 改成新 Web 容器的本机端口 `8090`。推荐保持容器只绑定 `127.0.0.1`，不要直接暴露 Redis 或 API：

```nginx
location / {
    proxy_pass http://127.0.0.1:8090;
}
```

修改后检查并平滑加载：

```bash
nginx -t
systemctl reload nginx
```

如果需要 HTTPS，TLS 仍由 Nginx 终止，Docker Web 容器不负责证书。

## 6. 发布验收

按顺序检查：

```bash
docker compose --env-file /opt/learnmath/runtime.env -f /opt/learnmath/compose.yml ps
curl --fail http://127.0.0.1:8090/health
docker compose --env-file /opt/learnmath/runtime.env -f /opt/learnmath/compose.yml logs --tail 100 api web manim-dispatcher manim-renderer
curl --fail http://8.134.195.113/health
```

教材 PDF 挂载是静默失败点（挂载路径写错时容器不报错，但页码定位、学习地图页码锚点会失效），必须显式验证两个容器都看得到 PDF：

```bash
# web 容器（浏览器加载教材）
docker compose -f /opt/learnmath/compose.yml exec web ls /opt/learnmath/textbooks
# api 容器（页码→小节解析、截图上下文）；应为空之外的 PDF 列表
docker compose -f /opt/learnmath/compose.yml exec api ls /app/frontend/public
```

随后用浏览器验证：登录、教材加载、文字问答、公式编辑/识别、学习记录读取和动画生成。动画队列使用 `learnmath-manim`，不要把 Redis 键名误写成 `learnmath-manim`（RQ 实际键包含 `rq:queue:` 前缀）。

## 7. 回滚

每次发布前保留上一版本镜像包和 `runtime.env` 备份。回滚只切换版本，不删除数据卷：

```bash
cp /opt/learnmath/runtime.env /opt/learnmath/backups/runtime.env.$(date +%Y%m%d%H%M%S)
sed -i 's/^LEARNMATH_VERSION=.*/LEARNMATH_VERSION=2026.08.24.3/' /opt/learnmath/runtime.env
docker compose --env-file /opt/learnmath/runtime.env -f /opt/learnmath/compose.yml up -d --no-build --force-recreate
curl --fail http://127.0.0.1:8090/health
```

不要执行：

```bash
docker compose down -v
rm -rf /opt/learnmath/data
```

这两类操作会破坏用户数据库、聊天记录或动画产物。

## 8. 沟通和安全边界

- 本机与服务器通过 SSH/SCP 通信，命令执行前先做只读状态检查。
- 任何停止旧服务、修改 Nginx、切换版本的操作都要记录当前版本和健康检查结果。
- 不在聊天、Git 或部署文档中粘贴 API Key、Neo4j 密码、JWT secret 或私钥。
- 服务器异常时先收集 `docker compose ps`、`logs`、`df -h`、`free -h`，再决定是否回滚。
- 当前服务器内存约 1.6 GB，Renderer 已设资源上限；不要在服务器上执行 `build --no-cache`。
