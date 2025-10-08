@echo off
REM Script invis?vel para iniciar Node e cloudflared sem janelas

REM Inicia Node em background (PowerShell oculta)
powershell -WindowStyle Hidden -Command "Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile -WindowStyle Hidden -Command cd \"\\stnlp-files\OCIAN\GEST?O_ESCRITURAS\Sistema_APP\src\"; node server.js' -WorkingDirectory '\\stnlp-files\OCIAN\GEST?O_ESCRITURAS\Sistema_APP\src'"

REM Aguarda 5 segundos apenas para evitar corrida de startup
timeout /t 5 /nobreak >nul

REM Inicia cloudflared em background (PowerShell oculta)
powershell -WindowStyle Hidden -Command "Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile -WindowStyle Hidden -Command cd \"C:\Program Files\Cloudflared\"; .\\cloudflared-windows-amd64.exe tunnel run hidrapink' -WorkingDirectory 'C:\Program Files\Cloudflared'"

exit
