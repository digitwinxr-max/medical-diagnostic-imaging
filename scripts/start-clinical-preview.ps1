#Requires -Version 5.1
# GeraldOS — Unified Clinical Localhost Experience
# One command: powershell -ExecutionPolicy Bypass -File .\scripts\start-clinical-preview.ps1
# Starts core clinical infrastructure (PostgreSQL, Redis, Orthanc, OHIF) + optional services where available,
# verifies live connectivity, verifies real CT Brain study, then starts GeraldOS on :3000

$ErrorActionPreference = "Stop"
$CT_UID = "1.2.826.0.1.3680043.8.498.71728362602630272973159058458427063809"
$CT_ORTHANC_ID = "50d30f69-d241a2b3-3cc18776-506c036f-ab047379"

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

# 6. Redis + Orthanc + OHIF
Write-Host "[5/9] Waiting for Redis & Orthanc & OHIF..." -ForegroundColor Yellow
docker compose exec -T redis redis-cli ping 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "  Redis HEALTHY" -ForegroundColor Green; $redisStatus="READY" } else { Write-Host "  Redis check via exec" -ForegroundColor Yellow; $redisStatus="DEGRADED" }

# Orthanc — must use auth orthanc:orthanc
$orthancOk=$false
for ($i=0; $i -lt 30; $i++) {
  try {
    $b64=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("orthanc:orthanc"))
    $r=Invoke-RestMethod -Uri http://localhost:8042/system -Headers @{Authorization="Basic $b64"} -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($r.Version) { Write-Host "  Orthanc $($r.Version) HEALTHY ($($r.Name))" -ForegroundColor Green; $orthancOk=$true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $orthancOk) { Write-Host "Orthanc not responding — check docker compose logs orthanc" -ForegroundColor Red; docker compose logs --tail 30 orthanc; exit 1 }

# OHIF — raw URL http://localhost:3001/app-config.js
$ohifOk=$false
if (Wait-Http http://localhost:3001/app-config.js "OHIF :3001" 60) { $ohifOk=$true }
else { Write-Host "OHIF not ready" -ForegroundColor Red; docker compose logs --tail 20 ohif; exit 1 }
try {
  $c=Invoke-WebRequest -Uri http://localhost:3001/app-config.js -UseBasicParsing -TimeoutSec 5
  if ($c.Content -match "dicom-web") { Write-Host "  OHIF HEALTHY — DICOMweb endpoints present" -ForegroundColor Green; $ohifConfigOk=$true } else { Write-Host "  OHIF config missing dicom-web" -ForegroundColor Yellow; $ohifConfigOk=$false }
} catch { $ohifConfigOk=$false }

# 7. Verify real CT Brain study — exact StudyInstanceUID
Write-Host "[6/9] Verifying real CT Brain study in Orthanc..." -ForegroundColor Yellow
$ctVerified=$false
$ctDetailOk=$false
try {
  $b64=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("orthanc:orthanc")); $h=@{Authorization="Basic $b64"}
  # Direct Orthanc study fetch
  try {
    $detail=Invoke-RestMethod -Uri http://localhost:8042/studies/$CT_ORTHANC_ID -Headers $h -TimeoutSec 10 -ErrorAction SilentlyContinue
    if ($detail.MainDicomTags.StudyInstanceUID -eq $CT_UID) { Write-Host "  CT Brain study detail VERIFIED via /studies/$CT_ORTHANC_ID" -ForegroundColor Green; $ctDetailOk=$true }
  } catch {}
  # QIDO via Orthanc DICOMweb — search by StudyInstanceUID
  try {
    $qido=Invoke-RestMethod -Uri http://localhost:8042/dicom-web/studies?StudyInstanceUID=$CT_UID -Headers $h -TimeoutSec 10 -ErrorAction SilentlyContinue
    if ($qido -and $qido.Count -gt 0) { Write-Host "  CT Brain QIDO-RS VERIFIED (Orthanc dicom-web)" -ForegroundColor Green; $ctVerified=$true }
  } catch {}
  if (-not $ctVerified -and $ctDetailOk) { $ctVerified=$true }
  if ($ctVerified) { Write-Host "CT BRAIN DEMO STUDY: VERIFIED" -ForegroundColor Green } else { Write-Host "CT BRAIN DEMO STUDY: NOT FOUND — StudyInstanceUID $CT_UID not in Orthanc" -ForegroundColor Red }
} catch { Write-Host "CT BRAIN DEMO STUDY: NOT FOUND — could not query Orthanc: $_" -ForegroundColor Red }
if (-not $ctVerified) { Write-Host "  Expected StudyInstanceUID: $CT_UID" -ForegroundColor Yellow; Write-Host "  Orthanc ID: $CT_ORTHANC_ID" -ForegroundColor Gray }

# 8. Start GeraldOS
Write-Host "[7/9] Starting GeraldOS..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" -ErrorAction SilentlyContinue; Write-Host "  Created .env from .env.example" -ForegroundColor DarkCyan }
if (-not (Test-Path "node_modules")) { Write-Host "  Installing npm dependencies..." -ForegroundColor DarkCyan; npm install }
# Ensure DB schema — capture exit code, do not suppress failure
Write-Host "  Ensuring database schema (npm run db:push)..." -ForegroundColor DarkCyan
npm run db:push 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
if ($LASTEXITCODE -eq 0) { Write-Host "DATABASE SCHEMA: READY" -ForegroundColor Green; $dbSchema="READY" } else { Write-Host "DATABASE SCHEMA: FAILED (exit $LASTEXITCODE)" -ForegroundColor Red; $dbSchema="FAILED"; Write-Host "  Workstation requires DB schema — stopping launcher" -ForegroundColor Red; exit 1 }

# Start dev server
try { Start-Process -FilePath "npm" -ArgumentList "run","dev" -WindowStyle Normal -ErrorAction Stop | Out-Null } catch {
  Write-Host "  Could not start via Start-Process, trying background job..." -ForegroundColor Yellow
  Start-Job -ScriptBlock { npm run dev } | Out-Null
}
Write-Host "  Waiting for GeraldOS http://localhost:3000 ..." -ForegroundColor DarkCyan
$geraldOk = Wait-Http http://localhost:3000/api/health "GeraldOS /api/health" 90
if (-not $geraldOk) { Wait-Http http://localhost:3000/ "GeraldOS /" 30 | Out-Null; $geraldOk = $true }

# 9. Verify GeraldOS + DICOMweb proxy + workstation routes
Write-Host "[8/9] Verifying GeraldOS integration..." -ForegroundColor Yellow
$geraldStatus="READY"
try {
  $r=Invoke-WebRequest -Uri http://localhost:3000/api/health -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
  if ($r.StatusCode -eq 200) { Write-Host "  GeraldOS /api/health READY" -ForegroundColor Green } else { $geraldStatus="DEGRADED" }
} catch { $geraldStatus="DEGRADED"; Write-Host "  GeraldOS /api/health not ready" -ForegroundColor Yellow }

# DICOMweb proxy through GeraldOS — QIDO for CT Brain UID via existing route src/app/api/orthanc/dicom-web/[...path]/route.ts
$dicomProxyOk=$false
try {
  # Route is /api/orthanc/dicom-web/studies?StudyInstanceUID=... (QIDO)
  $q=Invoke-RestMethod -Uri "http://localhost:3000/api/orthanc/dicom-web/studies?StudyInstanceUID=$CT_UID" -TimeoutSec 10 -ErrorAction SilentlyContinue
  if ($q -and ($q.Count -gt 0 -or $q.Length -gt 0)) { Write-Host "  GeraldOS DICOMweb proxy QIDO VERIFIED for CT Brain" -ForegroundColor Green; $dicomProxyOk=$true }
  else {
    # Fallback: try /studies endpoint
    $q2=Invoke-RestMethod -Uri http://localhost:8042/dicom-web/studies?StudyInstanceUID=$CT_UID -Headers @{Authorization="Basic $b64"} -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($q2) { Write-Host "  Orthanc DICOMweb direct QIDO VERIFIED (proxy path differs — check route)" -ForegroundColor Yellow }
  }
} catch { Write-Host "  GeraldOS DICOMweb proxy not yet ready: $_" -ForegroundColor Yellow }
if ($dicomProxyOk) { Write-Host "GERALDOS DICOMWEB PROXY: READY" -ForegroundColor Green } else { Write-Host "GERALDOS DICOMWEB PROXY: DEGRADED (will be ready when GeraldOS fully up)" -ForegroundColor Yellow }

# OHIF config already verified above — re-check via GeraldOS perspective
if ($ohifConfigOk) { Write-Host "OHIF CONFIGURATION: VERIFIED (http://localhost:3001/app-config.js contains dicom-web)" -ForegroundColor Green } else { Write-Host "OHIF CONFIGURATION: NOT VERIFIED" -ForegroundColor Yellow }

# Verify workstation routes
$wsOk=$false; $demoOk=$false
try { $w=Invoke-WebRequest -Uri http://localhost:3000/workstation -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue; if ($w.StatusCode -eq 200) { Write-Host "  /workstation READY" -ForegroundColor Green; $wsOk=$true } } catch { Write-Host "  /workstation not ready" -ForegroundColor Yellow }
try { $d=Invoke-WebRequest -Uri http://localhost:3000/workstation/demo -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue; if ($d.StatusCode -eq 200) { Write-Host "  /workstation/demo READY" -ForegroundColor Green; $demoOk=$true } } catch { Write-Host "  /workstation/demo not ready" -ForegroundColor Yellow }

# Health via system endpoint
try {
  $h=Invoke-RestMethod -Uri http://localhost:3000/api/system/health -TimeoutSec 5 -ErrorAction SilentlyContinue
  if ($h) { Write-Host "  System health: $($h.status) clinicalReady=$($h.clinicalReady)" -ForegroundColor Green }
} catch {}

# Final separate status report (machine-verifiable)
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "VERIFICATION SUMMARY" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "DOCKER: READY" -ForegroundColor Green
Write-Host "POSTGRES: READY" -ForegroundColor Green
if ($redisStatus -eq "READY") { Write-Host "REDIS: READY" -ForegroundColor Green } else { Write-Host "REDIS: $redisStatus" -ForegroundColor Yellow }
if ($orthancOk) { Write-Host "ORTHANC: READY" -ForegroundColor Green } else { Write-Host "ORTHANC: FAILED" -ForegroundColor Red }
if ($ohifOk -and $ohifConfigOk) { Write-Host "OHIF: READY" -ForegroundColor Green } else { Write-Host "OHIF: DEGRADED" -ForegroundColor Yellow }
if ($ctVerified) { Write-Host "CT BRAIN STUDY: VERIFIED" -ForegroundColor Green } else { Write-Host "CT BRAIN STUDY: NOT FOUND" -ForegroundColor Red }
if ($geraldStatus -eq "READY") { Write-Host "GERALDOS: READY" -ForegroundColor Green } else { Write-Host "GERALDOS: $geraldStatus" -ForegroundColor Yellow }
if ($dicomProxyOk) { Write-Host "GERALDOS DICOMWEB PROXY: READY" -ForegroundColor Green } else { Write-Host "GERALDOS DICOMWEB PROXY: NOT VERIFIED" -ForegroundColor Yellow }
if ($wsOk) { Write-Host "WORKSTATION: READY" -ForegroundColor Green } else { Write-Host "WORKSTATION: NOT VERIFIED" -ForegroundColor Yellow }
if ($demoOk) { Write-Host "CT DEMO ROUTE: READY" -ForegroundColor Green } else { Write-Host "CT DEMO ROUTE: NOT VERIFIED" -ForegroundColor Yellow }
Write-Host "LIVE PIXEL VERIFICATION: NOT AUTOMATICALLY VERIFIED" -ForegroundColor Yellow
Write-Host "  (actual CT pixels verified only when browser renders CT inside GeraldOS workstation)" -ForegroundColor Gray
Write-Host "========================================================" -ForegroundColor Cyan

# Final URLs
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
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "NEXT ACTION:" -ForegroundColor White
Write-Host "  Use the GeraldOS interface and click: OPEN CT BRAIN DEMO" -ForegroundColor Cyan
Write-Host "  Expected flow: GeraldOS → Workstation → CT Brain → Embedded OHIF → GeraldOS DICOMweb proxy → Orthanc → CT pixels" -ForegroundColor Gray

# Auto-open primary application
try {
  Write-Host "Opening http://localhost:3000/ in default browser..." -ForegroundColor DarkCyan
  Start-Process http://localhost:3000/ -ErrorAction SilentlyContinue | Out-Null
} catch {
  Write-Host "Could not auto-open browser — please open http://localhost:3000/ manually" -ForegroundColor Yellow
}
