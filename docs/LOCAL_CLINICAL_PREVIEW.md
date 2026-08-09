# GeraldOS — Local Clinical Preview

> **ONE COMMAND**
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\scripts\start-clinical-preview.ps1
> ```
> Then open **http://localhost:3000** — that's it.

---

## Primary URLs (the only URLs a clinician needs)

| Purpose | URL |
|---------|-----|
| **Main Platform** | http://localhost:3000 |
| **Clinical Workstation** | http://localhost:3000/workstation |
| **One-Click CT Demo** | http://localhost:3000/workstation/demo |
| **System Health** | http://localhost:3000/system/health |
| **Clinical Portal** | http://localhost:3000/clinical |

All other ports are **internal infrastructure** — you do not need to open them manually.

---

## What happens behind the scenes

```
Browser
  ↓
GeraldOS :3000  (Next.js — single entry point)
  ├─ Worklist (/api/worklist → PostgreSQL workflowStudies)
  ├─ Clinical context (/api/workstation/context)
  ├─ Embedded OHIF iframe  ──► GeraldOS DICOMweb proxy (/api/orthanc/dicom-web/*) ──► Orthanc :8042
  ├─ Reporting (/api/reports, /api/reports/assist)
  ├─ AI Review (simulated — clearly labelled SIMULATION)
  └─ System Health (/api/system/health → real checks for every service)
```

The browser **never** talks directly to Orthanc with Basic auth — GeraldoS proxy adds `orthanc:orthanc` server-side.

**Auto-reconciliation:** On server boot `src/instrumentation.ts` starts `src/lib/reconciler-poll.ts` every **5 seconds** (`durable cursor` in `system_settings`, single-worker guard, `ux_workflow_studies_study_uid` unique, DLQ `reconciliation_failures`). New STOW appears in worklist without manual trigger.

---

## Architecture

| Service | Container | Port | Required for workstation? |
|---------|-----------|------|---------------------------|
| **GeraldOS** | Next.js | 3000 | **Yes** — single entry point |
| **PostgreSQL** | postgres:16 | 5432 | **Yes** — primary DB |
| **Redis** | redis:7 | 6379 | **Yes** — cache, event transport |
| **Orthanc** | orthancteam/orthanc | 8042 | **Yes** — PACS + DICOMweb (auth orthanc:orthanc, healthcheck fixed with `-u`) |
| **OHIF** | ohif/app:latest | 3001 | **Yes** — viewer, but always via GeraldOS iframe (`app-config.js` → `http://localhost:3000/api/orthanc/dicom-web`) |
| Keycloak | quay.io/keycloak/keycloak | 8180 | Optional — OIDC, falls back to DEV_AUTH in dev |
| HAPI FHIR | hapiproject/hapi | 8090 | Optional — FHIR proxy |
| Dicoogle | bioinformatics-ua/dicoogle | 8095 | Optional — DICOM search |
| MinIO | minio/minio | 9000/9001 | Optional — object storage |
| n8n | n8nio/n8n | 5678 | Optional — automation |
| LangGraph | geraldos/langgraph:dev (local build) | 8123 | **Optional** — `profiles: ["agents"]` — `docker compose --profile agents up -d` only |

Clinical stack starts **without** LangGraph: `docker compose up -d postgres redis orthanc ohif`. LangGraph never blocks imaging.

---

## One-Click CT Demo

The real test study (already in Orthanc on the host):

- **StudyInstanceUID:** `1.2.826.0.1.3680043.8.498.71728362602630272973159058458427063809`
- **Orthanc ID:** `50d30f69-d241a2b3-3cc18776-506c036f-ab047379`
- **Patient:** `GH-100001 / Molefe^Kagiso`
- **Study:** CT Brain

Open `http://localhost:3000/workstation/demo` (dev-only, gated `NODE_ENV !== production`) and GeraldOS auto-selects this study, constructs `http://localhost:3001/viewer?StudyInstanceUIDs=REAL_UID` via `buildOhifUrl()`, loads the embedded OHIF iframe, and renders **real CT pixels** via `QIDO-RS` metadata + `WADO-RS` frames from Orthanc through the GeraldOS proxy.

**Acceptance:** `workstation/demo` → GeraldOS loads → Worklist identifies CT Brain → OHIF iframe loads → DICOMweb metadata returns → WADO frames return → CT pixels visible **inside GeraldOS** (not at :3001 directly).

---

## Health

- **Page:** http://localhost:3000/system/health — cards per service (HEALTHY/DEGRADED/OFFLINE/NOT_CONFIGURED) from real checks (Postgres `SELECT 1`, Orthanc `/system` with auth, OHIF `/app-config.js` grep, Redis `PING`, etc.)
- **API:** `GET /api/system/health` → `{status, clinicalReady, services: {postgres, redis, orthanc, ohif, ...}}` with `Cache-Control: no-store`
- **Strip:** `ClinicalHealthStrip` on `/workstation` shows compact `Database · Orthanc · OHIF · Redis` dots (healthy green, offline red).

Do not report healthy merely because config exists — health is from live probes.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/start-clinical-preview.ps1` | **Canonical launcher** — verifies Docker, starts core (postgres redis orthanc ohif), then optional (keycloak, fhir, dicoogle, minio, n8n), waits for health, verifies Orthanc studies, ensures `.env` + `db:push`, starts GeraldOS, prints primary URLs |
| `scripts/stop-clinical-preview.ps1` | Graceful `docker compose stop` — **preserves volumes** (pgdata, orthancdata); never runs `down -v` unless explicitly requested |
| `scripts/verify-live.sh` | 17-step CI verification (compose → migrations → STOW → reconcile → QIDO/WADO → health) |

**Start:** `powershell -ExecutionPolicy Bypass -File .\scripts\start-clinical-preview.ps1`  
**Stop:** `powershell -ExecutionPolicy Bypass -File .\scripts\stop-clinical-preview.ps1`

---

## Service Ports — Internal Only

| Service | Port | User-facing? |
|---------|------|--------------|
| GeraldOS | 3000 | **Yes — single entry** |
| OHIF | 3001 | Internal (via GeraldOS) |
| Orthanc | 8042 | Internal (via GeraldOS proxy) |
| PostgreSQL | 5432 | Internal |
| Redis | 6379 | Internal |
| Keycloak | 8180 | Internal |
| HAPI FHIR | 8090 | Internal |
| Dicoogle | 8095 | Internal |
| n8n | 5678 | Internal |
| MinIO | 9000 / 9001 | Internal |
| LangGraph | 8123 | Internal (profile agents) |

Do not weaken auth to make localhost work — Orthanc `orthanc:orthanc` and dev `DEV_AUTH=true` are **DEV ONLY**.

---

## Security & Branding

Dev credentials in `.env.example` are `DEV ONLY`. Production must set `AUTH_SECRET ≥32`, `KEYCLOAK_URL`, `ORTHANC_URL` etc via vault. Gerald Holdings premium brand (deep navy, rich teal, medical aqua, champagne gold, soft cool grey) is applied via centralized tokens in `src/app/globals.css` — dark/light both premium, workstation remains dark clinical.

---

## Troubleshooting

- **Orthanc UNHEALTHY but curl -u works:** fixed — healthcheck now `curl -f -u orthanc:orthanc http://localhost:8042/system`
- **Worklist empty:** `curl -X POST http://localhost:3000/api/orthanc/reconcile` or wait 5s auto-poll; check `reconciliation_failures` via `/api/orthanc/reconcile/replay`
- **OHIF empty:** check `http://localhost:3001/app-config.js` contains `dicom-web`, then `GET /api/orthanc/dicom-web/studies?StudyInstanceUID=1.2.826...`
- **Pixels not rendering:** verify WADO `GET /api/orthanc/dicom-web/studies/REAL_UID/series` returns series, then frames `.../frames/1` returns multipart/related
