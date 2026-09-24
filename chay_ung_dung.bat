@echo off
rem Khoi chay TSO bang may chu web cuc bo (can Python hoac Node.js). Neu khong co, mo truc tiep index.html.
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080/index.html
  python -m http.server 8080
  goto :eof
)
where npx >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080/index.html
  npx --yes http-server -p 8080 -c-1 .
  goto :eof
)
start "" "%~dp0index.html"
