# GeraldOS — Stop Clinical Preview (graceful, preserves data)
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\stop-clinical-preview.ps1

$ErrorActionPreference = "Stop"
Write-Host "Stopping GeraldOS clinical infrastructure (preserving volumes)..." -ForegroundColor Yellow
docker compose stop 2>&1 | Out-Null
# Do NOT run `down -v` — volumes (pgdata, orthancdata, etc.) must survive restart
Write-Host "Clinical services stopped. Data preserved in volumes (pgdata, orthancdata, etc.)." -ForegroundColor Green
Write-Host "To fully remove (destroys DICOM studies): docker compose down -v  (NOT recommended)" -ForegroundColor DarkGray
Write-Host "To restart: powershell -ExecutionPolicy Bypass -File .\scripts\start-clinical-preview.ps1" -ForegroundColor Cyan
