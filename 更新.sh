#!/bin/sh
# 在解包后的目录里执行：  sudo sh 更新.sh
# 作用：校验源码 → 删旧容器 → 无缓存重建镜像 → 启动 → 自检
set -e

DIR=$(cd "$(dirname "$0")" && pwd)
cd "$DIR"
echo "==> 工作目录: $DIR"

# ---- 1. 确认源码是新的 ----
if ! grep -q "去书架下载" public/index.html 2>/dev/null; then
  echo "!! public/index.html 不是新版本，请确认在这里解包的"
  exit 1
fi
if ! grep -q "haspick" lib/kindle.js 2>/dev/null; then
  echo "!! lib/kindle.js 不是新版本，请确认在这里解包的"
  exit 1
fi
echo "==> 源码版本检查通过"

# ---- 2. compose 命令 ----
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi
echo "==> 使用命令: $DC"

# ---- 3. 删旧容器（data/ 目录不受影响） ----
docker rm -f kindle-drop >/dev/null 2>&1 || true

# ---- 4. 构建（不吃缓存） ----
echo "==> 开始构建，J1900 上约 3-5 分钟，请勿中断"
docker build --no-cache -t kindle-drop:latest .

# ---- 5. 启动 ----
echo "==> 启动容器"
$DC up -d

# ---- 6. 自检 ----
echo "==> 等待服务启动"
sleep 6

NEWLIB=$(docker exec kindle-drop grep -c "haspick" /app/lib/kindle.js 2>/dev/null || echo 0)
echo "    容器内 lib/kindle.js 新代码标记: $NEWLIB (期望 2)"

NEWWEB=$(curl -s http://127.0.0.1:8899/ 2>/dev/null | grep -c "去书架下载" || true)
echo "    上传页新按钮: $NEWWEB (期望 1)"

echo ""
if [ "$NEWLIB" = "2" ]; then
  echo "==> 更新完成：http://NAS的IP:8899  （浏览器请 Ctrl+F5）"
else
  echo "!! 构建完成但容器内仍是旧代码，请把上面的构建输出发出来"
  exit 1
fi
