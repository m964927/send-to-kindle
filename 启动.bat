@echo off
cd /d "%~dp0"

if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查是否已安装 Node.js。
    pause
    exit /b 1
  )
)

echo.
echo 正在启动 Kindle 投递站，关闭这个窗口即停止服务。
echo.
node server.js
pause
