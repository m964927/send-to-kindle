@echo off
setlocal
cd /d "%~dp0"

set "KIN=%~dp0tools\kindling.exe"
set "CONV=%~dp0tools\calibre\Calibre\ebook-convert.exe"

if "%~1"=="" (
  echo.
  echo 把 epub 文件拖到本文件上，旁边就会生成同名 .azw3
  echo 可以一次拖多个文件；MOBI/AZW3 不用转，直接上传即可。
  echo.
  pause
  exit /b 1
)

:loop
if "%~1"=="" goto done
set "SRC=%~1"
set "EXT=%~x1"
if /i not "%EXT%"==".epub" (
  echo 跳过 %~nx1（Kindle 可直接读该格式，或需手动处理）
  shift
  goto loop
)

if exist "%KIN%" goto use_kindling
if exist "%CONV%" goto use_calibre
echo 缺少转换引擎：请把 kindling.exe 放到 tools 目录，或安装 Calibre。
pause
exit /b 1

:use_kindling
echo 转换 %~nx1 ...
"%KIN%" build "%SRC%" -o "%~dpn1.azw3" --no-embed-source --no-hd-images >nul
if errorlevel 1 (
  echo    失败
) else (
  echo    完成 -^> %~n1.azw3
)
shift
goto loop

:use_calibre
echo 转换 %~nx1 ...
"%CONV%" "%SRC%" "%~dpn1.azw3" --output-profile kindle_oasis
if errorlevel 1 (
  echo    失败
) else (
  echo    完成 -^> %~n1.azw3
)
shift
goto loop

:done
echo.
echo 全部处理完毕。
pause
