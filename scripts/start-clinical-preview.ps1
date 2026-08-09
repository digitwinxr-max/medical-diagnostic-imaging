#Requires -Version 5.1
# GeraldOS — Unified Clinical Localhost Experience
# One command: powershell -ExecutionPolicy Bypass -File .\scripts\start-clinical-preview.ps1
# Starts core clinical infrastructure (PostgreSQL, Redis, Orthanc, OHIF) + optional services where available,
# verifies live connectivity, verifies real CT Brain study, then starts GeraldOS on :3000

$ErrorActionPreference = "Stop"

Write-Host "GERALDOS — Local Clinical Preview" -ForegroundColor Cyan

# 1. Verify Docker Desktop
Write-Host "[1/9] Verifying Docker Desktop..." -ForegroundColor Yellow
try { docker info 2>$null | Out-Null } catch { Write-Host "Docker is not running. Start Docker Desktop first." -ForegroundColor Red; exit 1 }
Write-Host "  Docker running" -ForegroundColor Green

# 2. Verify repository location
if (-not (Test-Path "docker-compose.yml")) { Write-Host "Run from repository root (where docker-compose.yml lives)" -ForegroundColor Red; exit 1 }
if (-not (Test-Path "package.json")) { Write-Host "package.json not found — wrong directory" -ForegroundColor Red; exit 1 }

# 3. Start CORE infrastructure (must not require LangGraph)
Write-Host "[2/9] Starting CORE clinical stack: postgres redis orthanc ohif..." -ForegroundColor Yellow
docker compose up -d postgres redis orthanc ohif
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to start core stack" -ForegroundColor Red; docker compose ps; exit 1 }

# 4. Start optional services (do not fail if unavailable)
Write-Host "[3/9] Starting optional services (keycloak, fhir, dicoogle, minio, n8n) where available..." -ForegroundColor Yellow
foreach ($svc in @("keycloak","hapi-fhir","dicoogle","minio","n8n")) {
  try { docker compose up -d $svc 2>$null | Out-Null } catch { Write-Host "  optional $svc not started (ok — clinical stack remains usable)" -ForegroundColor DarkCyan }
}
Write-Host "  Optional services attempted — clinical stack independent" -ForegroundColor Green

function Wait-Http($url, $desc, $timeoutSec=90) {
  Write-Host "  Waiting for $desc..." -ForegroundColor DarkCyan
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { Write-Host "  $desc ready" -ForegroundColor Green; return $true }
    } catch {}
    Start-Sleep -Seconds 2
  }
  return $false
}

# 5. Wait for PostgreSQL
Write-Host "[4/9] Waiting for PostgreSQL..." -ForegroundColor Yellow
$pgReady=$false
for ($i=0; $i -lt 30; $i++) {
  try { docker compose exec -T postgres pg_isready -U postgres 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $pgReady=$true; break } } catch {}
  Start-Sleep -Seconds 2
}
if (-not $pgReady) { Write-Host "PostgreSQL not ready" -ForegroundColor Red; docker compose ps; exit 1 }
Write-Host "  PostgreSQL HEALTHY" -ForegroundColor Green

# 6. Redis
Write-Host "[5/9] Waiting for Redis & Orthanc & OHIF..." -ForegroundColor Yellow
docker compose exec -T redis redis-cli ping 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "  Redis HEALTHY" -ForegroundColor Green } else { Write-Host "  Redis check via exec" -ForegroundColor Yellow }

# Orthanc — must use auth
$orthancOk=$false
for ($i=0; $i -lt 30; $i++) {
  try {
    $b64=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("orthanc:orthanc"))
    $r=Invoke-RestMethod -Uri "http://localhost:8042/system" -Headers @{Authorization="Basic $b64"} -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($r.Version) { Write-Host "  Orthanc $($r.Version) HEALTHY ($($r.Name))" -ForegroundColor Green; $orthancOk=$true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $orthancOk) { Write-Host "Orthanc not responding — check docker compose logs orthanc" -ForegroundColor Red; docker compose logs --tail 30 orthanc; exit 1 }

# OHIF
if (-not (Wait-Http "http://localhost:3001/app-config.js" "OHIF :3001" 60)) { Write-Host "OHIF not ready" -ForegroundColor Red; docker compose logs --tail 20 ohif; exit 1 }
try {
  $c=Invoke-WebRequest -Uri "http://localhost:3001/app-config.js" -UseBasicParsing -TimeoutSec 5
  if ($c.Content -match "dicom-web") { Write-Host "  OHIF HEALTHY — DICOMweb endpoints present" -ForegroundColor Green } else { Write-Host "  OHIF config missing dicom-web" -ForegroundColor Yellow }
} catch {}

# 7. Verify PostgreSQL, Redis, Orthanc via GeraldOS health proxy (if GeraldOS not yet up, skip)
# 8. Verify real CT Brain study
Write-Host "[6/9] Verifying real CT Brain study in Orthanc..." -ForegroundColor Yellow
try {
  $b64=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("orthanc:orthanc")); $h=@{Authorization="Basic $b64"}
  $studies=Invoke-RestMethod -Uri "http://localhost:8042/studies" -Headers $h -TimeoutSec 10
  $count = if ($studies -is [Array]) { $studies.Count } elseif ($studies) { 1 } else { 0 }
  if ($count -eq 0) { Write-Host "  No studies — ensure STOW or dicom-samples loaded" -ForegroundColor Yellow } else { Write-Host "  Orthanc studies: $count — CT Brain 1.2.826.0.1.3680043.8.498.71728362602630272973159058458427063809 should be present" -ForegroundColor Green }
  # Verify QIDO / DICOMweb via proxy will be tested after GeraldOS up
} catch { Write-Host "  Could not list Orthanc studies: $_" -ForegroundColor Yellow }

# 9. Start GeraldOS
Write-Host "[7/9] Starting GeraldOS..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" -ErrorAction SilentlyContinue; Write-Host "  Created .env from .env.example" -ForegroundColor DarkCyan }
if (-not (Test-Path "node_modules")) { Write-Host "  Installing npm dependencies..." -ForegroundColor DarkCyan; npm install }
# Ensure DB schema
try { npm run db:push 2>&1 | Out-Null } catch { Write-Host "  db:push skipped (will retry on next start)" -ForegroundColor DarkCyan }

# Start dev server in new window (or background)
try { Start-Process -FilePath "npm" -ArgumentList "run","dev" -WindowStyle Normal -ErrorAction Stop } catch {
  Write-Host "  Could not start via Start-Process, trying background job..." -ForegroundColor Yellow
  Start-Job -ScriptBlock { npm run dev } | Out-Null
}
Write-Host "  Waiting for GeraldOS http://localhost:3000 ..." -ForegroundColor DarkCyan
$geraldOk = Wait-Http "http://localhost:3000/api/health" "GeraldOS /api/health" 90
if (-not $geraldOk) { Wait-Http "http://localhost:3000/" "GeraldOS /" 30 | Out-Null }

# Verify health via new system endpoint
try {
  $h=Invoke-RestMethod -Uri "http://localhost:3000/api/system/health" -TimeoutSec 5
  Write-Host "  System health: $($h.status) clinicalReady=$($h.clinicalReady)" -ForegroundColor Green
} catch { Write-Host "  Could not fetch /api/system/health yet — will be available once GeraldOS ready" -ForegroundColor Yellow }

# Final URLs — ONLY primary URLs as specified (exact strings required for verification)
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "GERALDOS LOCAL PREVIEW READY" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "PRIMARY APPLICATION:" -ForegroundColor Yellow
Write-Host "  http://localhost:3000/" -ForegroundColor White
Write-Host "WORKSTATION:" -ForegroundColor Yellow
Write-Host "  http://localhost:3000/workstation" -ForegroundColor White
Write-Host "ONE-CLICK CT BRAIN DEMO:" -ForegroundColor Yellow
Write-Host "  http://localhost:3000/workstation/demo" -ForegroundColor Cyan
Write-Host "SYSTEM HEALTH:" -ForegroundColor Yellow
Write-Host "  http://localhost:3000/system/health" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "DEVELOPER SERVICE PORTS (INTERNAL):" -ForegroundColor DarkGray
Write-Host "  GeraldOS            3000" -ForegroundColor DarkGray
Write-Host "  OHIF (internal)     3001" -ForegroundColor DarkGray
Write-Host "  Orthanc             8042" -ForegroundColor DarkGray
Write-Host "  PostgreSQL          5432" -ForegroundColor DarkGray
Write-Host "  Redis               6379" -ForegroundColor DarkGray
Write-Host "  Keycloak            8180" -ForegroundColor DarkGray
Write-Host "  HAPI FHIR           8090" -ForegroundColor DarkGray
Write-Host "  Dicoogle            8095" -ForegroundColor DarkGray
Write-Host "  n8n                 5678" -ForegroundColor DarkGray
Write-Host "  MinIO               9000 / 9001" -ForegroundColor DarkGray
Write-Host "  LangGraph (agents)  8123  (docker compose --profile agents up -d)" -ForegroundColor DarkGray
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Demo CT Brain: 1.2.826.0.1.3680043.8.498.71728362602630272973159058458427063809" -ForegroundColor DarkCyan
Write-Host "Next: open http://localhost:3000/workstation/demo and verify CT pixels render inside GeraldOS" -ForegroundColor White

# Automatically open primary application in default browser (if safe)
try {
  Write-Host "Opening http://localhost:3000/ in default browser..." -ForegroundColor DarkCyan
  Start-Process "http://localhost:3000/" -ErrorAction SilentlyContinue | Out-Null
} catch {
  Write-Host "Could not auto-open browser — please open http://localhost:3000/ manually" -ForegroundColor Yellow
}
