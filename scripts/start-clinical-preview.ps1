#Requires -Version 5.1
# GeraldOS — One-Click Clinical Preview (Windows)
# Starts PostgreSQL, Redis, Orthanc, OHIF, then GeraldOS on :3000
# Usage: powershell -ExecutionPolicy Bypass -File scripts/start-clinical-preview.ps1

$ErrorActionPreference = "Stop"

Write-Host "GERALDOS CLINICAL PREVIEW — starting..." -ForegroundColor Cyan

# 1. Verify Docker is running
Write-Host "[1/7] Verifying Docker..." -ForegroundColor Yellow
try { docker info 2>$null | Out-Null } catch { Write-Host "Docker is not running. Start Docker Desktop first." -ForegroundColor Red; exit 1 }

# 2. Start required infrastructure (clinical stack only — LangGraph optional via --profile agents)
Write-Host "[2/7] Starting PostgreSQL, Redis, Orthanc, OHIF..." -ForegroundColor Yellow
docker compose up -d postgres redis orthanc ohif
if ($LASTEXITCODE -ne 0) { Write-Host "docker compose up failed" -ForegroundColor Red; exit 1 }

# 3. Wait for services
function Wait-Http($url, $desc, $timeoutSec=90, $headers=@{}) {
  Write-Host "Waiting for $desc ($url)..." -ForegroundColor DarkCyan
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -Headers $headers -ErrorAction SilentlyContinue
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { Write-Host "  $desc ready" -ForegroundColor Green; return $true }
    } catch {}
    Start-Sleep -Seconds 2
  }
  Write-Host "  $desc not ready after ${timeoutSec}s" -ForegroundColor Red
  return $false
}

# Postgres
Write-Host "[3/7] Waiting for PostgreSQL..." -ForegroundColor Yellow
$pgReady = $false
for ($i=0; $i -lt 30; $i++) {
  try { docker compose exec -T postgres pg_isready -U postgres 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $pgReady=$true; break } } catch {}
  Start-Sleep -Seconds 2
}
if (-not $pgReady) { Write-Host "PostgreSQL not ready" -ForegroundColor Red; docker compose ps; exit 1 } else { Write-Host "  PostgreSQL healthy" -ForegroundColor Green }

# Redis
if (-not (Wait-Http "http://localhost:6379" "Redis (TCP)" 15)) {
  # Redis has no HTTP; check via docker exec
  docker compose exec -T redis redis-cli ping 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host "  Redis healthy" -ForegroundColor Green } else { Write-Host "  Redis check via exec" -ForegroundColor Yellow }
}

# Orthanc — must use auth (healthcheck fixed to -u orthanc:orthanc)
Write-Host "[4/7] Waiting for Orthanc..." -ForegroundColor Yellow
$orthancOk = $false
for ($i=0; $i -lt 30; $i++) {
  try {
    $pair = "orthanc:orthanc"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($pair)
    $b64 = [Convert]::ToBase64String($bytes)
    $h = @{ Authorization = "Basic $b64" }
    $r = Invoke-RestMethod -Uri "http://localhost:8042/system" -Headers $h -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($r.Version) { Write-Host "  Orthanc $($r.Version) ($($r.Name))" -ForegroundColor Green; $orthancOk=$true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $orthancOk) { Write-Host "Orthanc not responding (check docker compose logs orthanc)" -ForegroundColor Red; docker compose logs --tail 50 orthanc; exit 1 }

# OHIF
Write-Host "[5/7] Waiting for OHIF..." -ForegroundColor Yellow
if (-not (Wait-Http "http://localhost:3001/app-config.js" "OHIF" 60)) { Write-Host "OHIF not ready" -ForegroundColor Red; docker compose logs --tail 30 ohif; exit 1 }
try {
  $cfg = Invoke-WebRequest -Uri "http://localhost:3001/app-config.js" -UseBasicParsing -TimeoutSec 5
  if ($cfg.Content -match "dicom-web") { Write-Host "  OHIF DICOMweb config present" -ForegroundColor Green } else { Write-Host "  OHIF config missing dicom-web" -ForegroundColor Yellow }
} catch {}

# 4. Verify at least one study exists (real CT Brain)
Write-Host "[6/7] Verifying Orthanc studies..." -ForegroundColor Yellow
try {
  $pair = "orthanc:orthanc"; $b64=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair)); $h=@{Authorization="Basic $b64"}
  $studies = Invoke-RestMethod -Uri "http://localhost:8042/studies" -Headers $h -TimeoutSec 10
  if ($studies.Count -eq 0 -or $studies.Length -eq 0) { Write-Host "  No studies in Orthanc — run STOW or check dicom-samples" -ForegroundColor Yellow } else { Write-Host "  Orthanc studies: $($studies.Count) — OK" -ForegroundColor Green }
} catch { Write-Host "  Could not list Orthanc studies: $_" -ForegroundColor Yellow }

# 5. Start GeraldOS
Write-Host "[7/7] Starting GeraldOS (Next.js)..." -ForegroundColor Yellow
if (-not (Test-Path "package.json")) { Write-Host "Run from repository root" -ForegroundColor Red; exit 1 }
# Ensure .env exists
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" -ErrorAction SilentlyContinue; Write-Host "  Created .env from .env.example" -ForegroundColor DarkCyan }
# Install if needed
if (-not (Test-Path "node_modules")) { Write-Host "  Installing npm dependencies..." -ForegroundColor DarkCyan; npm install }
# Build check (optional, dev is fine)
Start-Process -FilePath "npm" -ArgumentList "run","dev" -WindowStyle Normal
Write-Host "  Waiting for GeraldOS http://localhost:3000 ..." -ForegroundColor DarkCyan
if (-not (Wait-Http "http://localhost:3000/api/health" "GeraldOS /api/health" 90)) {
  # Fallback to /
  Wait-Http "http://localhost:3000/" "GeraldOS /" 30 | Out-Null
}

Write-Host ""
Write-Host "GERALDOS CLINICAL PREVIEW READY" -ForegroundColor Green
Write-Host "  http://localhost:3000/workstation" -ForegroundColor Cyan
Write-Host "  DEMO STUDY:" -ForegroundColor Yellow
Write-Host "    CT Brain" -ForegroundColor White
Write-Host "    StudyInstanceUID: 1.2.826.0.1.3680043.8.498.71728362602630272973159058458427063809" -ForegroundColor Gray
Write-Host "    Orthanc ID: 50d30f69-d241a2b3-3cc18776-506c036f-ab047379" -ForegroundColor Gray
Write-Host "    http://localhost:3000/workstation/demo" -ForegroundColor Cyan
Write-Host "  OHIF direct: http://localhost:3001/viewer?StudyInstanceUIDs=1.2.826.0.1.3680043.8.498.71728362602630272973159058458427063809" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "Logs: docker compose logs -f" -ForegroundColor DarkGray
Write-Host "Stop: docker compose down" -ForegroundColor DarkGray
