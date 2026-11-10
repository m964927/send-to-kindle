# 部署到 NAS（Docker）一步步来

**不需要源码，不需要在 NAS 上编译。** 一条 `docker compose up -d` 把预构建镜像跑起来，NAS 只负责拉取和运行。

全程 3 步：**建目录写 compose → 拉镜像启动 → 验证**。J1900 这类弱鸡 NAS 也就两分钟。

> 前提：NAS 是 **x86_64 架构**（J1900 属于这一类），装好 Docker / Container Manager。
> ARM 机型（群晖 DS223j / DS220j、树莓派等）跑不了：镜像里的转换引擎 Kindling 只发布 x86_64 版。

---

## 第 0 步：确认两件事

SSH 连上 NAS（群晖：控制面板 → 终端机和 SNMP → 启用 SSH），然后：

```bash
# 1. 有没有 Docker
docker --version

# 2. 是 x86_64 还是 ARM（要看到 x86_64，不能是 aarch64）
uname -m
```

> 报 `permission denied` 就在命令前加 `sudo`（群晖普通用户默认不在 docker 组）。
> 老系统没有 `docker compose`，把下面所有 `docker compose` 换成 `docker-compose`。

顺便记下 NAS 的局域网 IP（路由器后台，或 `ip addr`），后面要用。

---

## 第 1 步：建目录、写 compose

```bash
sudo mkdir -p /volume1/docker/kindle-drop
cd /volume1/docker/kindle-drop
```

新建 `docker-compose.yml`（`nano docker-compose.yml` 或 File Station 里新建），内容就是：

```yaml
services:
  kindle-drop:
    image: ghcr.io/m964927/send-to-kindle:latest
    container_name: kindle-drop
    restart: unless-stopped
    ports:
      - "8899:8899"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - ./data:/app/data
    cpus: 2.0
    mem_limit: 1g
```

就这十几行。`./data` 会自动创建，**这个目录就是整个书架**（`library.json` + `files/` + `covers/`），备份它就等于备份全部数据。

> 想直接拿官方那份也行：`curl -O https://raw.githubusercontent.com/m964927/send-to-kindle/main/docker-compose.yml`。
> 但国内 raw.githubusercontent.com 常常连不上，手写这十几行反而更快。

---

## 第 2 步：拉镜像并启动

```bash
cd /volume1/docker/kindle-drop
docker compose pull
docker compose up -d
```

镜像约 **88MB 压缩 / 240MB 展开**（`linux/amd64`）。看到 `Container kindle-drop  Started` 就好了。

### 拉不动 ghcr.io 怎么办

镜像主发布在 **ghcr.io**，公开、免登录。按顺序换前缀试，拉下来 retag 一下，compose 文件不用改：

```bash
# 1) 免注册的公共前缀
docker pull docker.m.daocloud.io/ghcr.io/m964927/send-to-kindle:latest
docker tag  docker.m.daocloud.io/ghcr.io/m964927/send-to-kindle:latest ghcr.io/m964927/send-to-kindle:latest

# 2) 或者毫秒镜像：需要先在 1ms.run 注册拿一个 mk- 开头的密钥，登录一次
docker login ghcr.1ms.run -u 1ms
docker pull ghcr.1ms.run/m964927/send-to-kindle:latest
docker tag  ghcr.1ms.run/m964927/send-to-kindle:latest ghcr.io/m964927/send-to-kindle:latest

docker compose up -d
```

也可以直接把 compose 里的 `image:` 改成加速地址，连 `docker tag` 都省了：

```yaml
    image: docker.m.daocloud.io/ghcr.io/m964927/send-to-kindle:latest
```

> Docker Hub 上也有 `song19615/send-to-kindle:latest`，但仓库没配 `DOCKERHUB_TOKEN` 时 CI 不同步，那边可能是旧版本，用之前先看更新时间。

### 确认起来了

```bash
docker compose ps                                        # 状态 Up
docker inspect --format '{{.State.Health.Status}}' kindle-drop   # healthy（刚启动时 starting 也正常）
docker compose logs --tail 30
```

日志里应该是这样：

```
📚 Kindle 投递站已启动
电脑 / 手机上传   http://192.168.1.10:8899
Kindle 访问       http://192.168.1.10:8899/k
格式转换          Kindling 0.46.2 已就绪
```

---

## 第 3 步：验证

先在 NAS 上自测：

```bash
curl -s http://127.0.0.1:8899/api/info
```

返回里应有 `"name":"Kindling","available":true`，`urls.kindle` 是 NAS 的局域网地址。

再用电脑浏览器打开 `http://NAS的IP:8899`：

1. 拖一本 EPUB 进去，几秒后变成「AZW3 · Kindle 可读」
2. 点书库右上角的「封面视图」，能看到封面、书名、作者——封面是从书文件里实时解析出来的
3. 右上角显示「Kindling 0.46.2 就绪」

最后在 Kindle 上用「体验版网页浏览器」打开 `http://NAS的IP:8899/k`，点「下载到 Kindle」。

> 下载地址形如 `/d/58e9c3c416/乡土中国 (费孝通).azw3`，**必须带扩展名**——Kindle 的破浏览器靠 URL 后缀判断文件类型，无后缀的地址会被当成网页拒绝下载。

---

## 日常运维

```bash
cd /volume1/docker/kindle-drop

docker compose logs -f --tail 100    # 看日志（上传、转换都在这）
docker compose restart               # 重启
docker compose down                  # 停止并删容器（data 目录不动）
```

**升级到新版本**（就是这么简单，不用重新传源码、不用构建）：

```bash
docker compose pull && docker compose up -d
```

> `docker compose up -d` **不会自动拉新镜像**——本地已经有 `:latest` 就直接用旧的。所以升级必须先 `pull`。
> 如果 `pull` 下来发现还是老版本（加速器缓存了旧层），指定摘要精确拉取：
> 先 `docker compose down`、`docker rmi ghcr.io/m964927/send-to-kindle:latest`，再 `pull`。

**开机自启**：`restart: unless-stopped` 已经写了，NAS 重启后容器自己起来。

**备份**：整个书架就是 `data/` 一个目录。

```bash
tar czf ~/kindle-backup-$(date +%F).tar.gz -C /volume1/docker/kindle-drop data
```

**目录权限**：容器以 root 运行，`data/` 里的文件属主是 root。想在 File Station 里直接拖书进去，先 `sudo chown -R 你的用户名:users data`；只网页上传的话不用管。

**迁移旧书库**：把旧机器上的 `data/`（含 `files/`、`covers/`、`library.json`）整个拷到 `kindle-drop/data/`，重启容器，书和配置都在。

**改了代码想自己构建**：用仓库里的 `docker-compose.build.yml`，那是开发者路径：

```bash
git clone https://github.com/m964927/send-to-kindle.git
cd send-to-kindle
docker compose -f docker-compose.build.yml up -d --build
```

---

## 出问题按这个表查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `pull` 卡住 / `TLS handshake timeout` | ghcr.io 连不上 | 换 Docker Hub 或 daocloud 前缀（见第 2 步） |
| `manifest unknown` / `no matching manifest` | ARM 机器，或用了很老的 Docker | `uname -m` 要 `x86_64`；Docker 升到 20.10+ |
| `port is already allocated` | 8899 被占用 | compose 里改成 `"8900:8899"`，访问地址跟着变 8900 |
| 容器反复重启 | 看日志 | `docker compose logs --tail 50`，常见是 data 目录权限或端口冲突 |
| 电脑能开，Kindle 打不开 | 地址是 `127.0.0.1` / 不同网段 / AP 隔离 / 反代没通 | 确认页面地址不是 `127.0.0.1`、`localhost`、`172.1x`；确认 Kindle 和 NAS 同一个 Wi-Fi |
| 页面/二维码显示 `172.x.x.x` | 绕过了宿主机端口映射 | 从 `http://NAS的IP:8899` 或域名访问 |
| 反代后打开是空白/404 | lucky 配了路径前缀，或代理目标填错 | 代理目标填 `http://NAS的IP:8899`；用子域名而非 `/kindle/` 路径前缀 |
| 上传后一直「转换中」 | 转换引擎异常 | `docker compose logs` 看报错 |
| Kindle 书架里是灰色占位、没封面 | AZW3 缺 `EXTH 501`（CDE=EBOK）和 `EXTH 113`（ASIN），固件不建封面缓存 | 现在的镜像转换时已带 `--doc-type ebok`；**老书在列表里点 `↻` 重新转一次**即可 |
| Kindle 点下载没反应 | 下载地址没有扩展名 | 升级到最新镜像，链接已改为 `/d/<id>/书名.azw3` |
| 书库目录权限报错 | `data` 被 root 占用 | `sudo chown -R 1000:1000 data`（群晖一般 1000 是第一个用户） |
| 下载完在图书馆找不到 | 固件把浏览器下载归到「下载」分类 | 首页切到「下载 / 已下载」查看 |

---

## 可选：反代 / 外网访问

页面显示的 Kindle 地址会自动跟随你访问时用的地址，**默认什么都不用配**：

| 你用什么打开上传页 | 页面显示的 Kindle 地址 |
| --- | --- |
| `http://192.168.1.10:8899` | `http://192.168.1.10:8899/k` |
| `http://127.0.0.1:8899`（NAS 本机） | 自动换成 LAN IP，不会给 Kindle 回环地址 |
| lucky 反代的 `https://kindle.example.com` | `https://kindle.example.com/k` |

Kindle 页里的下载链接是相对路径，换域名、换端口都不会断。

用 lucky / Nginx 反代时注意两点：

1. 代理目标填 `http://NAS的局域网IP:8899`（不要填 127.0.0.1，除非反代和容器在同一台机器且用 host 网络）
2. 用**子域名**或**端口**转发，别配路径前缀（`https://域名/kindle/` 这种还没支持）

只有想让页面钉死一个不直接访问的地址时，才在 compose 里加：

```yaml
environment:
  - TZ=Asia/Shanghai
  - PUBLIC_URL=https://kindle.example.com
```

---

## 群晖 Container Manager 图形界面做法（不想敲命令）

1. File Station 在 `docker` 下建目录 `kindle-drop`
2. 在里面新建 `docker-compose.yml`，粘贴第 1 步那十几行
3. **Container Manager** → **项目** → **新增**
4. 项目名 `kindle-drop`，路径选 `/docker/kindle-drop`，来源选「使用现有的 docker-compose.yml」
5. 下一步 → 完成。它会自己 `pull` 镜像并启动

威联通（Container Station）同理：应用 → 创建 → 选 `docker-compose.yml` 所在目录。

---

## 几条使用提醒

- 服务**没有登录密码**，只适合自家局域网，不要做端口映射到公网
- 单文件上限默认 500MB，在 `data/config.json` 里改 `maxFileSizeMB`
- 转换是串行队列，一次一本，不会把四核占满
- 删掉 `data/` 等于清空书架
- 镜像自带 `HEALTHCHECK`，挂了会被 Docker 标成 unhealthy，`docker compose ps` 一眼能看出来
