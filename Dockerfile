# syntax=docker/dockerfile:1

# 基础镜像必须 ≥ Debian 13（glibc 2.41）。
# kindling 的 Linux 二进制引用了 GLIBC_2.39 符号，Debian 12（glibc 2.36）会直接报
# "version `GLIBC_2.39' not found"，容器起来就退出。
# 国内拉不动 Docker Hub 时可换镜像源：
#   --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-trixie-slim
ARG NODE_IMAGE=node:22-trixie-slim
FROM ${NODE_IMAGE}

# ── 转换引擎 ────────────────────────────────────────────────────────────────
# kindling：Rust 写的单文件静态二进制，17MB，专做 EPUB/OPF → AZW3（KF8）。
# 之前用 Calibre 要约 570MB（Qt6 + 内嵌 Chromium），而 ebook-convert 只用到其中很小一部分。
ARG KINDLING_VERSION=0.46.2
# 拉不动 GitHub 时改成镜像源：
#   --build-arg KINDLING_BASE=https://gh-proxy.com/https://github.com/ciscoriordan/kindling/releases/download
ARG KINDLING_BASE=https://github.com/ciscoriordan/kindling/releases/download
# 需要 epub→mobi、pdf/txt→azw3 时设 1（镜像涨到约 900MB）
ARG WITH_CALIBRE=0
# npm 装依赖用的源，国内可换 https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG DEBIAN_FRONTEND=noninteractive

# tools/ 里如果预放了 kindling-linux（离线包），就直接用本地的，构建过程完全不碰 GitHub
COPY tools/ /opt/tools/

RUN set -eux; \
    if [ -f /opt/tools/kindling-linux ]; then \
      install -m 0755 /opt/tools/kindling-linux /usr/local/bin/kindling; \
      echo 'kindling: 使用本地二进制'; \
    else \
      apt-get update; \
      apt-get install -y --no-install-recommends curl ca-certificates; \
      curl -fsSL -o /usr/local/bin/kindling \
        "$KINDLING_BASE/v${KINDLING_VERSION}/kindling-cli-linux"; \
      chmod 0755 /usr/local/bin/kindling; \
      apt-get purge -y curl; \
      apt-get autoremove -y; \
      echo 'kindling: 已从网络下载'; \
    fi; \
    kindling --version; \
    if [ "$WITH_CALIBRE" = "1" ]; then \
      apt-get update; \
      apt-get install -y --no-install-recommends calibre; \
    fi; \
    kindling build /opt/tools/sample.epub -o /tmp/sample.azw3 --no-embed-source --no-hd-images; \
    test -s /tmp/sample.azw3; \
    rm -rf /opt/tools /tmp/sample.azw3; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /usr/share/doc/* /usr/share/man/* /usr/share/locale/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8899 \
    TZ=Asia/Shanghai

COPY package.json package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" \
 && npm ci --omit=dev \
 && npm cache clean --force \
 && rm -rf /root/.npm

COPY server.js ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /app/data/files /app/data/tmp

VOLUME ["/app/data"]
EXPOSE 8899

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8899)+'/api/info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
