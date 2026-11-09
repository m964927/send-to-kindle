# 部署到 NAS（Docker）一步步来

全程只需要 4 步：**传文件 → 改一行地址 → 构建启动 → 验证**。
预计 10–20 分钟，其中构建 2–5 分钟（J1900）。

> 前提：你的 NAS 是 **x86_64 架构**（J1900 属于这一类），并且装好了 Docker / Container Manager。
> 如果是 ARM 机型（如群晖 DS223j、DS220j 这类），下面的 kindling 二进制跑不了，这条路不适用。

---

## 第 0 步：先确认三件事

在 NAS 上开 SSH（群晖：控制面板 → 终端机和 SNMP → 启用 SSH），然后用电脑连上去：

```bash
ssh 你的用户名@NAS的IP
```

进去后执行：

```bash
# 1. 有没有 Docker
docker --version

# 2. 是 x86_64 还是 ARM（要看到 x86_64，不能是 aarch64）
uname -m

# 3. 用哪个命令（新系统是 docker compose，老系统是 docker-compose）
docker compose version   || docker-compose --version
```

> 如果执行 `docker` 报 `permission denied`，命令前面加 `sudo`（群晖上普通用户默认不在 docker 组）。
> 下面的命令都假设你已经在这个目录下：`/volume1/docker/kindle-drop`。

记下三样东西，后面要用：

| 项目 | 怎么查 | 示例 |
| --- | --- | --- |
| NAS 的局域网 IP | 路由器后台，或 `ip addr` | `192.168.1.10` |
| 群晖的 docker 目录 | 一般是 `/volume1/docker` | `/volume1/docker` |
| compose 命令 | 上面第 3 条 | `docker compose` |

---

## 第 1 步：把文件传到 NAS

只需要这些文件（约 18MB，其中 17MB 是转换引擎）：

```
Dockerfile
docker-compose.yml
.dockerignore
package.json
package-lock.json
server.js
lib/
public/
tools/sample.epub        自检样本
tools/kindling-linux     离线转换引擎（有它就不需要 NAS 连 GitHub）
```

**不要传**：`node_modules`（镜像里装）、`data`（NAS 上会新建，除非你要迁移旧书库）、`tools/calibre`（570MB 的 Windows 版，传了也没用）、`tools/kindling.exe`、`.workbuddy`。

### 方式 A：打包上传（推荐，Windows / Mac 都能用）

在**电脑上**，进入项目目录 `D:\program\kindle`，执行：

```bash
tar --exclude=node_modules --exclude=data --exclude=tools/calibre --exclude=tools/kindling.exe --exclude=.workbuddy -czf kindle-drop.tar.gz .
```

然后把包传上去（Windows 10+ 自带 `scp` 和 `tar`）：

```bash
scp kindle-drop.tar.gz 你的用户名@NAS的IP:/volume1/docker/
```

在 NAS 上解包：

```bash
sudo mkdir -p /volume1/docker/kindle-drop
sudo tar xzf /volume1/docker/kindle-drop.tar.gz -C /volume1/docker/kindle-drop
sudo chown -R 你的用户名:users /volume1/docker/kindle-drop
rm /volume1/docker/kindle-drop.tar.gz
cd /volume1/docker/kindle-drop
ls        # 应该看到 Dockerfile、docker-compose.yml、server.js、lib、public、tools
```

### 方式 B：群晖 File Station 直接拖

在 File Station 里建好 `/docker/kindle-drop`，把上面那几项拖进去即可（`lib`、`public`、`tools` 是文件夹）。
拖完之后文件属主是当前用户，不用额外 chown。

### 方式 C：FileZilla / WinSCP

SFTP 连 NAS，同上。

---

## 第 2 步：地址（默认不用改）

```bash
cd /volume1/docker/kindle-drop
```

**这一步可以跳过。** 页面显示的 Kindle 地址会自动跟随你访问时用的地址：

| 你用什么打开上传页 | 页面显示的 Kindle 地址 |
| --- | --- |
| `http://192.168.1.10:8899` | `http://192.168.1.10:8899/k` |
| `http://127.0.0.1:8899`（NAS 本机） | 自动换成 LAN IP，不会给 Kindle 回环地址 |
| lucky 反代的 `https://kindle.example.com` | `https://kindle.example.com/k` |

Kindle 页里的下载链接是相对路径，换域名、换端口都不会断。

**如果你用 lucky 反代**，注意两点：

1. 代理目标填 `http://NAS的局域网IP:8899`（不要填 127.0.0.1，除非 lucky 和容器在同一台机器且用 host 网络）
2. 用**子域名**或**端口**转发，比如 `kindle.你的域名.com` → `192.168.1.10:8899`。
   如果在 lucky 里配了路径前缀（`https://你的域名/kindle/`），需要在 compose 里加 `BASE_PATH`——这个还没做，遇到告诉我。

只有想让页面钉死一个你不直接访问的地址时，才需要配：

```yaml
environment:
  - PUBLIC_URL=https://kindle.example.com
```

---

## 第 3 步：构建并启动

```bash
cd /volume1/docker/kindle-drop
docker compose -f docker-compose.build.yml up -d --build   # 老系统用 docker-compose -f docker-compose.build.yml up -d --build
```

> 仓库里有**两个** compose 文件，别用混了：
> - `docker-compose.yml` —— 只拉预构建镜像，`docker compose up -d` 一条就完事，**不需要源码、不需要构建**
> - `docker-compose.build.yml` —— 从源码构建，本文这一套流程用的就是它
>
> NAS 性能弱、不想等构建的话，直接用前者从 ghcr.io 拉镜像即可（见 README「快速开始」）。

构建过程会做三件事，全在镜像里完成，不影响 NAS 其它服务：

1. 拉取 `node:22-trixie-slim`（Debian 13，kindling 需要 glibc ≥ 2.39，不能用 Debian 12）
2. 装上本地这份 17MB 的 kindling（**不联网也能成**）
3. 真转一本样本书做自检——引擎有问题会当场构建失败，而不是等你传书才发现

看到 `Container kindle-drop  Started` 就好了。第一次构建 J1900 上大约 2–5 分钟（主要花在拉基础镜像）。

```bash
# 等 10 秒，确认健康状态是 healthy（starting 也正常，说明还在启动）
docker inspect --format '{{.State.Status}} / {{.State.Health.Status}}' kindle-drop
```

**确认状态**：

```bash
docker compose ps
docker compose logs --tail 30
```

日志里应该出现：

```
📚 Kindle 投递站已启动
电脑 / 手机上传   http://192.168.1.10:8899
Kindle 访问       http://192.168.1.10:8899/k
格式转换          Kindling 0.46.2 已就绪
```

---

## 第 4 步：验证

在 NAS 上先自测：

```bash
curl -s http://127.0.0.1:8899/api/info
```

返回里应该有 `"name":"Kindling","available":true`，`urls.kindle` 是你的 NAS 地址。

再用电脑浏览器打开 `http://NAS的IP:8899`：

1. 拖一本 EPUB 进去
2. 几秒后书库里那本书变成「AZW3 · Kindle 可读」
3. 右上角显示「Kindling 0.46.2 就绪」

最后在 Kindle 上打开 `http://NAS的IP:8899/k`，点「下载到 Kindle」。

---

## 日常运维

```bash
cd /volume1/docker/kindle-drop

docker compose logs -f --tail 100   # 看日志（上传、转换都在这里）
docker compose restart              # 重启
docker compose down                 # 停止并删除容器（data 目录不动）
docker compose -f docker-compose.build.yml up -d --build   # 改完代码后重新构建
```

**开机自启**：`restart: unless-stopped` 已经写了，NAS 重启后容器会自动起来。

**备份**：整个书架就是 `data/` 一个目录：

```bash
tar czf ~/kindle-backup-$(date +%F).tar.gz -C /volume1/docker/kindle-drop data
```

**目录权限**：容器以 root 运行，`data/` 里的文件属主会是 root。想在 File Station 里直接拖书进去的话，先执行 `sudo chown -R 你的用户名:users data`，或干脆只用网页上传（推荐）。

**迁移旧书库**：把电脑上的 `data/` 目录（含 `files/` 和 `library.json`）整个拷到 NAS 的 `kindle-drop/data/`，重启容器即可，书和配置都在。

**升级**（源码构建方式）：重新传一次源码文件，再 `docker compose -f docker-compose.build.yml up -d --build`；`data/` 不会被覆盖。

**升级**（镜像方式）：`docker compose pull && docker compose up -d`，几十秒就完，不用在 NAS 上编译。

---

## 出问题按这个表查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 构建卡在 `pulling node:22-trixie-slim` | Docker Hub 拉不动 | compose 里打开 `NODE_IMAGE: docker.m.daocloud.io/library/node:22-trixie-slim`（**必须仍是 trixie**）再构建 |
| `npm ERR! network` / 装依赖超时 | npm 源慢 | 打开 `NPM_REGISTRY: https://registry.npmmirror.com` |
| 构建报下载 kindling 失败 | 没带 `tools/kindling-linux`，且 NAS 连不上 GitHub | 把电脑上的 `tools/kindling-linux` 传上去，或加 `KINDLING_BASE: https://gh-proxy.com/https://github.com/ciscoriordan/kindling/releases/download` |
| 容器反复重启，日志报 `GLIBC_2.39 not found` | 基础镜像用了 Debian 12 或更老 | 改回 `node:22-trixie-slim`，别改成 `22-slim` / `22-bookworm-slim` |
| `port is already allocated` | 8899 被占用 | compose 里改成 `"8900:8899"`，访问地址跟着变 8900 |
| 电脑能开，Kindle 打不开 | 页面给的是 `127.0.0.1` / 不同网段 / AP 隔离 / 反代没通 | 先确认页面显示的地址不是 `127.0.0.1`、`localhost`、`172.1x`；再看 Kindle 和 NAS 是否同 Wi-Fi；反代则先用手机 4G 打开域名试 |
| 页面/二维码显示 `172.x.x.x` | 浏览器直接访问的是容器内网桥地址（少见，通常是绕过了宿主机端口映射） | 从 `http://NAS的IP:8899` 或反代域名访问 |
| 反代后打开是空白/404 | lucky 配了路径前缀，或代理目标填错 | 代理目标填 `http://NAS的IP:8899`；用子域名而非 `/kindle/` 这样的路径 |
| 上传后一直「转换中」 | 转换引擎异常 | `docker compose logs --tail 50` 看报错；通常是没传 linux 版二进制 |
| 书库目录权限报错 | `data` 被 root 占用 | `sudo chown -R 1000:1000 data`（群晖一般 1000 是第一个用户） |
| Kindle 下载后图书馆找不到 | 固件把浏览器下载归到「下载」分类 | 首页切到「下载 / 已下载」查看 |

---

## 可选：完全离线 / 加速构建

如果 NAS 在外网访问上很吃力，在电脑上先做成镜像再搬过去最省事（**电脑上需要 Docker**）：

```bash
# 电脑上（项目目录内）
docker build -t kindle-drop:latest .
docker save kindle-drop:latest | gzip > kindle-drop-image.tar.gz
scp kindle-drop-image.tar.gz 你的用户名@NAS的IP:/volume1/docker/

# NAS 上
gunzip -c /volume1/docker/kindle-drop-image.tar.gz | docker load
cd /volume1/docker/kindle-drop
docker compose up -d          # 不再需要 --build
```

镜像约 250MB。地址是跟着浏览器访问地址走的，换机器、换 IP 都不用改配置。

---

## 群晖 Container Manager 图形界面做法（不想敲命令）

1. File Station 把源码放到 `docker/kindle-drop`
2. 打开 **Container Manager** → **项目** → **新增**
3. 项目名称 `kindle-drop`，路径选 `/docker/kindle-drop`
4. 来源选「**使用现有的 docker-compose.yml**」，下一步
5. 直接「完成」，它会自动构建并启动

图形界面不方便改 build args，默认值就是可用状态，`docker-compose.yml` 里的配置也不用动，直接用。

威联通（Container Station）同理：应用 → 创建 → 选 `docker-compose.yml` 所在目录。

---

## 几条使用提醒

- 服务**没有登录密码**，只适合在自家局域网用，不要做端口映射到公网
- 单文件上限默认 500MB，在 `data/config.json` 里改 `maxFileSizeMB`
- 转换是串行队列，一次一本，不会把四核占满
- 删掉 `data/` 等于清空书架，备份就备份它一个目录
