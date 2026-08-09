# GERALDOS — MASTER IMPLEMENTATION & ARCHITECTURE BLUEPRINT
**Phase 2 · Authoritative Technical Plan**
**Branch:** `arena/019fe55b-medical-diagnostic-imaging` · **Base commit:** `969a692` · **Date:** 2026-08-09
**Precondition:** Phase 1 read-only audit complete. No code modified in this phase.

> **Reading instruction:** This document is the single source of truth for all subsequent coding agents. Every future PR must cite the section and file-ownership row it satisfies. Labels:
> - **[EXISTS]** — proven in repo by file read
> - **[SCAFFOLD / REQUIRES IMPLEMENTATION]** — file/route/table exists but body is placeholder, mock, or unconnected
> - **[NEW IMPLEMENTATION REQUIRED]** — does not exist; must be designed then built
> - **[DELEGATED TO EXTERNAL INFRASTRUCTURE]** — GeraldOS must not rebuild; compose via adapter

---

## 1. ARCHITECTURAL NORTH STAR

### Governing principle

> **GeraldOS is the clinical operations, orchestration, intelligence and user-experience layer *above* the medical imaging infrastructure.**

```
                    Users (Reception · Radiographer · Radiologist · Manager)
                                          │
                                    GeraldOS UI (Next.js App Router, Workstation)
                                          │
                    ┌──────────────────────────────────────────────────────┐
                    │              GERALDOS CORE (owns IP)                 │
                    │  Workflow · Worklist · Context · Reporting ·         │
                    │  Decision Engine · AI Orchestration · Agent Coord ·  │
                    │  Knowledge · Equipment/Inventory Intelligence ·      │
                    │  Analytics · Notifications · Audit/Governance        │
                    └──────────────────────┬───────────────────────────────┘
                                           │ Integration / Event Layer
              ┌────────┬────────┬──────────┼──────────┬─────────┬──────────┐
              │        │        │          │          │         │          │
           Orthanc   OHIF   Keycloak   HAPI FHIR  MinIO/Redis  n8n   LangGraph
           (PACS)  (viewer)  (IdP)    (interop)  (obj/cache) (auto) (agents)
```

**Test for every proposed feature:** *Does this duplicate a capability already provided by Orthanc / OHIF / Keycloak / HAPI FHIR / Redis / MinIO / n8n / LangGraph / PostgreSQL itself?* If yes, reject and instead design the **adapter, orchestration or governance** around it.

**Consequences:**
- GeraldOS never stores pixel data. Never decodes DICOM. Never renders images. It references UIDs and proxies bytes.
- GeraldOS never issues a diagnosis. AI output is `candidate observation → human review → audit`.
- GeraldOS never finalises a report without `approvedBy` + role check.
- Agents never mutate domain tables directly; they propose `Decision` → `Rule → Validation → Human Approval → Execution → Audit`.

---

## 2. SYSTEM BOUNDARY — WHAT GERALDOS OWNS vs DELEGATES

### 2.1 GeraldOS-owned (IP / differentiation)

| Capability | Why GeraldOS must own it | What GeraldOS owns around the external | Boundary (API/protocol) | Must never duplicate |
|---|---|---|---|---|
| **Clinical Operations Command Centre** | Only GeraldOS has cross-system view (worklist+TAT+equipment+inventory+finance+AI queue) | Aggregation (`/api/command-centre`, `/api/analytics`) over PG + event_log + integration probes | Reads PG, polls `event_log`, probes `/api/integrations/status` | — |
| **Patient/Workflow Orchestration** | The 12-stage pipeline is product logic | `src/lib/workflow.ts` state machine, `transitionStudy()` as sole mutator, accession generation, guards | REST `PATCH /api/workflow/[id] {action:transition}` | Orthanc's DICOM workflow (MWL) |
| **Worklist** | Deterministic, audited radiology worklist with facets, priority rank, stage | `GET /api/worklist?view=&q=&modality=&radiologist=` + facets; join `workflow_studies↔patients↔staff↔referrals↔equipment` | DB read; Orthanc PACS list is auxiliary for UID resolution only | Orthanc's `/tools/find` or Dicoogle search as primary worklist |
| **Scheduling & Reception** | Slot/template/rules are operations IP | `appointments` CRUD, check-in, equipment/equipment assignment, conflict detection | `POST /api/appointments`, `PATCH … {checkedIn}` | HAPI FHIR `Appointment` as primary (FHIR is interop mirror) |
| **Radiologist Workstation Orchestration** | The daily workspace is GeraldOS's primary product surface | `src/components/workstation/*` — panels, splitters, palette, context fetch, study open, prior load, report creation | Client state `WorkstationProvider` + `GET /api/workstation/context` + `POST /api/reports` on first open | OHIF/Cornerstone rendering; re-implementing a viewer |
| **Reporting Workflow + Versioning + Approval** | Clinical governance is GeraldOS liability | `reports` + `report_versions` + `report_templates` + `scoreReport/prepareDraft` + sign guard (`approvedBy`+role) | `PATCH /api/reports/[id] {findings,impression,status:"signed",approvedBy}` + `report.versioned/signed` events | SR object as report store; generic document store |
| **AI Review Orchestration** | Human-in-loop governance is GeraldOS liability | `ai_observations` lifecycle `pending→accepted|rejected`, `generateCandidates` abstraction behind `InferenceProvider`, `PATCH /api/ai-review/[id]` | `POST /api/ai-review {studyId,modality}` + `PATCH … {accepted}` | The model itself (weights, preprocessing) |
| **Decision Engine** | Safety boundary (no autonomous diagnosis/finalisation) | `src/lib/decision-engine.ts` rules (`no_auto_finalise_reports`, `no_autonomous_diagnosis`, `stat_priority_allowed`) + propose→validate→approve→execute→audit | `POST /api/decisions` + `POST /api/decisions/[id]/{approve,reject,execute}` | n8n's branching as policy |
| **Agent Coordination** | 9-domain operational agents are IP | Registry `src/lib/agents.ts` (mission/tools/events/memory) + `handleAgentRequest` fallback + LangGraph thread/run proxy | `POST /api/agents/chat {agentId,message}` → `LangGraph /threads/:id/runs/wait` else fallback | LangGraph's graph definitions (those live in `services/langgraph_agent.py` + deployed assistant) |
| **Knowledge Layer** | SOP/protocol governance | `knowledge_documents` (published-only search) + `Knowledge Agent` token-ranked ILIKE fallback | `GET /api/knowledge?q=&category=` + agent `knowledge.published` | External wiki/CMS as source of truth for approvals |
| **Equipment/Inventory Intelligence** | Operational intelligence | `equipment` calibration/maintenance + `inventory_items` stock/expiry alerts + executive snapshot | `GET /api/equipment`, `GET /api/inventory` + events `equipment.offline`, `inventory.low_stock` | IoT/CMMS platforms (if later introduced, via adapter) |
| **Notifications & Audit/Governance** | Cross-cutting clinical governance | `notifications` (userId=all|id) + `audit_log` insert-only + `event_log` dual-write | `GET /api/notifications`, `GET /api/events`, `POST /api/events` | Redis Streams as audit store (PG is durable) |
| **Clinical Workflow State Machine** | Single source of pipeline truth | Ordered `WORKFLOW_STAGES[12]` + `stageIndex` + guards | Single function `transitionStudy()` — no client stage writes | — |
| **Cross-System Context** | Only GeraldOS joins patient+study+priors+labs+reports+AI | `GET /api/workstation/context?studyId=&patientId=&orthancStudyId=&modality=` (priors, reports, teaching files, FHIR labs, similar accepted observations) | Joins PG + timed FHIR `Observation?subject.identifier=MRN` | FHIR as context joiner |
| **AI Governance** | Provenance, versioning, accept/reject, rollback | `ai_observations{modelVersion, confidence, boundingBox, reviewedBy/At, status}` + `aiRecommendations{ruleResults,validationResults}` + audit | Model metadata in every observation + decision audit | Model training/evaluation pipelines |

### 2.2 Delegated — what GeraldOS composes, not rebuilds

| External | Why use it | What GeraldOS owns around it | Boundary | Must never duplicate |
|---|---|---|---|---|
| **Orthanc** | Mature PACS + DICOMweb (QIDO/WADO/STOW) + REST + Lua + Changes | `orthancAuthHeader()`, `timedFetch`, `GET /studies?expand`, `GET /series?expand`, `/api/orthanc/dicom-web/[...path]` proxy, `/api/orthanc/studies/[id]` enrichment, `studyInstanceUid` reconciliation | Orthanc REST (`/studies`, `/series`, `/instances`, `/system`, `/dicom-web/**`) with `Basic` auth server-side only; never exposes creds to browser | `Study/Series/Instance` tables in PG; pixel decode; DICOM storage |
| **OHIF** | Production viewer (Cornerstone, tools, HP, MPR) | URL builder `?StudyInstanceUIDs=uid[,priorUid]`, iframe embed, `postMessage({type:"ohif-load-study"})`, `OHIF_URL` via `publicClientConfig`, `viewer-panel.tsx` chrome | `OHIF_URL /viewer?StudyInstanceUIDs=` + `window.config.dataSources[0].configuration.{qidoRoot,wadoRoot,wadoUriRoot,stowRoot}=/api/orthanc/dicom-web` + `message` events | Cornerstone render, MPR, segmentation editor |
| **Keycloak** | OIDC, RBAC, SSO, JWKS | Login discovery, callback JWKS verify (`jose`), HS256 session `geraldos_session`, `src/proxy.ts` gate, role → approval check | `KEYCLOAK_URL/realms/{realm}/.well-known/openid-configuration` + `jwks_uri` + `id_token` → session JWT | Password store, token issuer (GeraldOS issues only internal HMAC session) |
| **HAPI FHIR** | R4 interop Clinical (Patient/Observation/Coverage etc) | Proxy `GET /api/fhir?resource=Patient&_count=20`, workstation lab summary `Observation?subject.identifier=MRN` | Forward `Accept: application/fhir+json`, map `patient.mrn ↔ Patient.identifier` | GeraldOS clinical record as FHIR primary (PG `patients` is primary) |
| **Dicoogle** | Index/search across archives | Proxy `GET /api/dicoogle/search?q=PatientID:*` | `DICOOGLE_URL /search?query=` | Full-text search store (PG covers GeraldOS search) |
| **MinIO** | S3 object store (STOW payloads, exports, teaching files if binary) | `aws4fetch` SigV4, `GET /api/minio/status` (bucket auto-create), `POST /api/minio/presign` | S3 `ListBuckets`, `PutObject` presigned PUT | Filesystem uploads |
| **Redis** | Cache, rate limit, Streams event transport | `ioredis` lazy, `XADD geraldos:events MAXLEN ~10000 *`, `getRedis()` backoff, `EVENT_STREAM/EVENT_GROUP` | `XADD`/`XREADGROUP`/`XACK` on `geraldos:events` | `event_log` durable store (PG is durable) |
| **n8n** | Workflow automation, webhooks, integrations | Outbound `POST /api/n8n/trigger {workflow,data}`, inbound `POST /api/webhooks/n8n` (audit-logged) | `N8N_URL/webhook/{path}` + `N8N_API_KEY` | Core scheduling/notification logic (GeraldOS does), n8n is for cross-system flows |
| **LangGraph** | Agent graph runtime (stateful threads, tools) | `POST /api/agents/chat` → `POST /threads/:id/runs/wait` with `assistant_id`, `LANGGRAPH_ASSISTANT_ID`, fallback to `handleAgentRequest(snapshot)` | LangGraph Platform API `/threads`, `/runs/wait`, `X-Api-Key` | Agent registry/memory are GeraldOS; graph execution is LangGraph |
| **PostgreSQL** | Durable relational store | Drizzle schema, `db:push` migrations, `event_log`/`audit_log`/`notifications` | `DATABASE_URL` via `pg` + Drizzle | Any other durable store |

---

## 3. TARGET ARCHITECTURE (text diagram)

```
                         USERS
        Reception / Radiographer / Radiologist / Manager / Admin
                                 │
                          GERALDOS UI  [EXISTS — Next.js App Router]
                 ┌───────────────┬─┴────────────────┬──────────────────┐
                 │               │                  │                  │
           Command Centre   Reception/Scheduling  Workstation    Settings/Finance/
            (dashboard)      (patient, appt)   (4-panel)        Equipment/Inventory
                 │               │                  │                  │
                 └───────────────┼──────────────────┼──────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    GERALDOS CORE         │  Application / Domain layer
                    │                          │  [EXISTS: src/lib/*, src/app/api/*]
                    │  Workflow (12-stage)     │   transitionStudy() — sole mutator
                    │  Worklist + Facets       │   DB join + priority rank
                    │  Context Assembly        │   /workstation/context (priors+labs+AI)
                    │  Reporting + Templates   │   versioning + sign guard
                    │  Decision Engine         │   rules → validation → approval
                    │  AI Orchestration        │   InferenceProvider abstraction
                    │  Agent Coordination      │   9 agents → LangGraph or fallback
                    │  Knowledge Governance    │   published-only, versioned
                    │  Audit & Governance      │   audit_log insert-only
                    │  Analytics               │   TAT, bottleneck, utilisation
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  INTEGRATION / EVENT     │  Adapter + event infrastructure
                    │  ─────────────────────   │
                    │  Orthanc Adapter         │  REST + DICOMweb proxy (Basic auth)
                    │  OHIF Adapter            │  URL builder + postMessage + config
                    │  FHIR Adapter            │  R4 proxy + MRN↔identifier map
                    │  Dicoogle Adapter        │  search proxy
                    │  MinIO Adapter (S3)      │  SigV4 + presign
                    │  Identity Adapter        │  OIDC discovery + JWKS + session
                    │  Event Bus               │  event_log (PG durable) + Redis Streams
                    │  Notification Dispatcher │  DB + SSE/poll
                    │  Agent Runtime Adapter   │  LangGraph thread/run + fallback
                    │  Automation Adapter      │  n8n trigger/webhook
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┬────────────────┐
        │                        │                        │                │
   PERSISTENCE              MESSAGE BUS             OBJECT STORAGE    AUTOMATION
   PostgreSQL               Redis Streams              MinIO              n8n
   [DELEGATED-infra,        [DELEGATED-infra,       [DELEGATED]     [DELEGATED]
    GeraldOS owns             GeraldOS owns
    schema, indexes,          stream name, groups,
    constraints]              event schema]
        │                        │                        │                │
   ┌────▼─────┐           ┌──────▼──────┐          ┌─────▼─────┐   ┌─────▼─────┐
   │ Orthanc  │◄──────────┤   OHIF      │          │ Keycloak  │   │HAPI FHIR  │
   │  PACS    │ DICOMweb  │  Viewer     │          │   (IdP)   │   │  (R4)     │
   │ :8042    │  proxy    │  :3001      │          │  :8180    │   │  :8090    │
   └──────────┘           └─────────────┘          └───────────┘   └───────────┘
        │                        │                        │                │
   ┌────▼─────┐           ┌──────▼──────┐          ┌─────▼─────┐   ┌─────▼─────┐
   │ Dicoogle │           │ AI Inference│          │ LangGraph │   │   Redis   │
   │  :8095   │           │  :5005 [NEW]│          │  :8123    │   │  :6379    │
   └──────────┘           └─────────────┘          └───────────┘   └───────────┘
```

**Layer legend:**
- **UI** — `src/app/*` + `src/components/workstation/*` (client, React 19, polling polling today)
- **Application/Orchestration** — `src/app/api/*` Route Handlers + `src/lib/{workflow,reporting,ai-review,decision-engine,agents,events,knowledge}`
- **Domain Logic** — `src/lib/{workflow,reporting,ai-review,decision-engine}` rules & scoring (pure functions, tested)
- **Integration Adapters** — `src/lib/integrations/{index,minio}` + every `src/app/api/{orthanc,fhir,dicoogle,minio,n8n}` proxy
- **Event Infrastructure** — `src/lib/events.ts` (`publishEvent`, `EVENT_STREAM`, `EVENT_GROUP`) + `api/events/{route,stream}` + PG `event_log`
- **AI Inference** — **[NEW]** `services/inference/` Python service (MONAI/ONNX/Torch behind `InferenceProvider` contract) — isolated so GeraldOS stays orchestration-only
- **Persistence** — PG `app_db` via Drizzle (`src/db/schema.ts`, `drizzle/*.sql`)
- **External Infrastructure** — docker-compose services (see §10). They scale independently; GeraldOS scales as the Next.js app.

---

## 4. DOMAIN MODEL — CANONICAL

> Principle: **GeraldOS stores only what it needs to orchestrate, decide, notify, audit, bill and analyse.** Pixel and DICOM series fidelity live in Orthanc.

| Entity | System of Record | GeraldOS DB? | External ID | Relationships | Purpose |
|---|---|---|---|---|---|
| **Patient** | GeraldOS (PG `patients`) — Orthanc has Patient demographic copy, FHIR `Patient` is interop mirror | YES — `patients` | `mrn` (unique, business key), `id` (uuid PK); Orthanc `PatientID`, FHIR `Patient.identifier[MRN]` | 1—N `referrals`, `appointments`, `workflowStudies`, `reports` | Operations primary; never replaced by FHIR/Orthanc |
| **Referral** | GeraldOS (`referrals`) | YES | `id` | FK `patientId → patients`, feeds `appointments.referralId` | Entry of pipeline; `clinicalIndication`, `requestedProcedure`, `priority` |
| **Appointment** | GeraldOS (`appointments`) | YES | `id` | FK `patientId`, `referralId?`, `equipmentId?`, `radiographerId?` | Scheduling, arrival, equipment allocation |
| **Study** | **Split SOR**: `workflowStudies` (GeraldOS orchestration) + Orthanc DICOM Study (pixel authority) | YES — `workflow_studies` (orchestration row) | `studyInstanceUid varchar(128)` (Orthanc UID, nullable until `sent_to_orthanc`), `accessionNumber unique` (GeraldOS accession) | FK `patientId`, `appointmentId?`, `radiologistId?`, 1—N `reports`, `ai_observations`, `study_annotations`, `study_bookmarks` | Pipeline progression (`stage`), assignment, TAT; DICOM Study lives in Orthanc |
| **Series** | **Orthanc** — GeraldOS does NOT need `series` table | NO **[DELEGATED]** | `SeriesInstanceUID` (Orthanc) | Lightweight metadata fetched via `GET /studies/{id}/series?expand` or QIDO; annotation `seriesInstanceUid varchar(128)` is free-text reference, not FK | Body-part/sequence context for HP + comparison |
| **Instance / Frame** | **Orthanc** | NO **[DELEGATED]** | `SOPInstanceUID`, `frameNumber` | Resolved via WADO `…/instances/{SOP}/frames/{n}` | Image identity for annotation/AI overlay |
| **Imaging Modality** | Dictionary (GeraldOS `equipment.modality` + `workflowStudies.modality` varchar) | Value on `workflowStudies/equipment` | DICOM `Modality` tag | Drives `buildProtocols(modality)`, `prepareDraft(modality)`, `generateCandidates(modality)` | Typing for HP/template/AI; not a table (could become `modalities` enum if needed) |
| **Equipment** | GeraldOS (`equipment`) + Orthanc modality copy | YES | `id` | 1—N `appointments(equipmentId)` via appointment; maintenance `maintenance_records` | Scheduling, scheduling conflict, calibration/TAT, utilisation |
| **Staff** | GeraldOS (`staff`) | YES | `id` | `role {radiologist,radiographer,receptionist,admin…}` | Assignment, attribution (`changedBy`, `reviewedBy`) |
| **Radiologist** | **View on `staff` where `role≈radiolog*`** + `roles` permissions | VIEW | FK `radiologistId → staff.id` on `workflowStudies`, `reports` | Assignment, sign gate (`roles` claim) | Not a separate table (keep `staff`) |
| **Radiographer** | **View on `staff`** | VIEW | `radiographerId → staff.id` on `appointments` | Scheduling | Same |
| **Worklist Item** | **Virtual — query over `workflowStudies` + joins** | NO (projection) | `workflowStudies.id` | Live projection `worklist: workflowStudies ⋈ patients ⋈ staff ⋈ appointments ⋈ referrals ⋈ equipment` | Read-only enterprise worklist; never a stored table |
| **Workflow Stage** | Code enum `WORKFLOW_STAGES[12]` | NO (code) | `workflowStudies.stage varchar` value | Ordered by `stageIndex`; guard in `transitionStudy` | Forward-only pipeline |
| **Report** | GeraldOS (`reports`) | YES | `id`, FK `studyId → workflowStudies`, `patientId → patients`, `radiologistId? → staff` | SR/DICOM SR lives in Orthanc if exported; GeraldOS is reporting SOR | Clinical product; sign/release, quality score |
| **Report Version** | GeraldOS (`report_versions`) | YES | `FK reportId → reports`, `version int` | Insert-only snapshot before every `PATCH` with content | Audit + diff + rollback |
| **AI Observation** | GeraldOS (`ai_observations`) | YES | `FK studyId? → workflowStudies`, `orthancStudyId`, `seriesInstanceUid? **[NEW — see §11]**`, `sopInstanceUid?/frameNumber? **[NEW optional]**` | Dual-key Study; pending→accepted|rejected|modified **[NEW]** + `reviewedBy/At` | Governance queue for every candidate finding |
| **AI Recommendation** | GeraldOS (`ai_recommendations`) | YES | `agent`, `recommendation`, `targetModule/Action/Payload`, `ruleResults`, `validationResults`, `requestedBy→approvedBy` | Proposed by agents/AI; gated by Decision Engine | Safety boundary for every autonomous proposal |
| **Annotation** | GeraldOS (`study_annotations`) | YES | `FK studyId?`, `orthancStudyId`, `seriesInstanceUid varchar(128)` (reference, not FK), `tool`, `data jsonb{value,units,points,boundingBox…}`, `createdBy` | Measured on image, stored as metadata reference | Manual + future OHIF-derived measurements |
| **Bookmark** | GeraldOS (`study_bookmarks`) | YES | `userId`, `FK studyId?`, `orthancStudyId` | Per-user list | Radiologist saved cases |
| **Knowledge Document** | GeraldOS (`knowledge_documents`) | YES | `id`, `category`, `docType`, `version`, `status:published|draft|archived`, `tags[]` | Indexed by `Knowledge Agent` | SOP/protocol source for agents (published only) |
| **Decision** | **View on `ai_recommendations`** | YES | `ai_recommendations.id`, `agent`, `target*`, `status proposed|validated|approved|rejected|executed|failed` | `decision.{proposed,approved,rejected,executed}` events + audit | Authorisation boundary row |
| **Event** | **Split**: `event_log` (PG durable) + Redis Stream `geraldos:events` (transport) | YES — `event_log serial PK` | `eventType`, `aggregate`, `aggregateId`, `payload jsonb`, `source`, `occurredAt` | Published by `publishEvent(type,aggregate,aggregateId,payload,source)`; also writes Redis `XADD` best-effort | Immutable timeline; read via `GET /api/events` + SSE |
| **Notification** | GeraldOS (`notifications`) | YES | `id`, `userId(all|id)`, `title/body/type/severity/link, read bool` | Inserted by `transitionStudy` and other publishers | Worklist/assignment/report alerts |
| **Audit Record** | GeraldOS (`audit_log`) | YES — `serial PK` | `userId`, `action`, `module`, `entityType`, `entityId`, `details jsonb`, `ipAddress` | Insert-only, never updated | Clinical + security audit |
| **Invoice / Line Item / Payment** | GeraldOS (`invoices`, `invoice_line_items`, `payments`) | YES | Billing after report | FK `patientId`, `studyId`, `appointmentId` | Finance |
| **Insurance Claim** | GeraldOS (`insurance_claims`) | YES | Linked to invoice | `claim_number unique` | Finance interop |
| **Inventory Item + Transaction** | GeraldOS (`inventory_items`, `inventory_transactions`) | YES | `itemId → inventory_items` | Stock alerts → agent + notification | Operations |
| **Maintenance Record** | GeraldOS (`maintenance_records`) | YES | `equipmentId → equipment` | Calibration/maintenance due → alerts | Equipment intelligence |
| **Branch / EmployeeRecord / Tariff / SystemSetting / Role** | GeraldOS (`branches`, `employee_records`, `tariffs`, `system_settings`, `roles`) | YES | Back-office admin | Org tree + pricing + RBAC permissions | Multi-site readiness (see §16) |

**Do NOT add:** `series` table, `instances` table, `frames` table, `pixelStore`, `dicomTagsDump` — those belong to Orthanc/MINIO.

---

## 5. DICOM DOMAIN BOUNDARY

> **Principle: Orthanc is the DICOM authority. GeraldOS references UIDs, never pixels.**

### 5.1 Representation

| DICOM Level | Stored where | GeraldOS field | Lifecycle |
|---|---|---|---|
| **Patient** | GeraldOS `patients` (SOR) + Orthanc PACS Patient + FHIR `Patient` | `patients.mrn` (business key), `patients{id, firstName, lastName, dob, gender}` | Created via `POST /api/patients` at reception. Orthanc Patient created on STOW; GeraldOS may fuzzy-match `PatientID (MRN)` to existing `patients.mrn` during reconciliation. |
| **Study** | GeraldOS `workflowStudies` (one orchestration row per clinical study) + Orthanc Study (DICOM object) | `workflow_studies{ id uuid, accessionNumber unique, studyInstanceUid varchar(128) nullable, patientId FK, modality, procedure, bodyPart, stage, equipmentId, radiologistId, priority, startedAt/completedAt }` | **Created in GeraldOS** at `referral→appointment→study_created`. Orthanc Study created later via modality C-STORE or `POST /instances` or STOW. Reconciliation (Phase 2) matches the two on `studyInstanceUid` (+ fallback `AccessionNumber`/`PatientID+date`). |
| **Series** | Orthanc only **[DELEGATED]** | Lightweight fetch: `GET /studies/{orthancId}/series?expand` or QIDO `GET /dicom-web/studies/{StudyUID}/series` — returned per viewer open. Persisted only as reference strings in `study_annotations.seriesInstanceUid` and (proposed) `ai_observations.seriesInstanceUid`. | Not stored in PG. Hanging protocols `seriesMatch` operate on Orthanc series descriptions at render time. |
| **Instance (SOP)** | Orthanc only **[DELEGATED]** | `SOPInstanceUID` handled via WADO `GET /dicom-web/studies/{StudyUID}/series/{SeriesUID}/instances/{SOP}/frames/{n}` (multipart) | Never in PG. Resolved at annotation/AI overlay time. Instance Orthanc IDs (UUIDs) used for `preview` thumbnail REST only. |
| **Frame** | Orthanc only **[DELEGATED]** | `frameNumber` integer when needed (multiframe US/MG) | AI overlay bounding boxes reference `frameNumber` only when required. Default is instance-level. |

### 5.2 Decisions

- **When GeraldOS creates a Study:** At clinical-study birth (`POST /api/workflow {patientId, modality, procedure} → stage=referral` → appointment → `study_created`) — **before any image exists**. This is the row the worklist shows. `studyInstanceUid` is `null` until `sent_to_orthanc`.
- **How `StudyInstanceUID` is stored:** `workflow_studies.study_instance_uid varchar(128)` nullable, unique-if-not-null (add constraint in migration — see §23). Verified format per DICOM `UI` regex. `transitionStudy(to:sent_to_orthanc)` requires non-null UID (guard exists **[EXISTS]**).
- **How `SeriesInstanceUID` is handled:** Not stored as a first-class row. When needed (annotation, AI observation) store as `varchar(128)` reference column (add to `ai_observations.seriesInstanceUID` **[NEW]**). Enforces no FK.
- **How `SOPInstanceUID` is handled:** Not stored in PG for v1. If AI evidence needs per-SOP citation, add nullable `ai_observations.sopInstanceUid varchar(128)` + `frameNumber integer` **[NEW optional]** — scope per observation granularity (§11). Otherwise study/series granularity suffices.
- **Needs lightweight Series metadata?** **No new table.** Fetch on demand from Orthanc; optionally cache in Redis for 60s per study (avoid thrashing). The minimum robust model for an orchestration layer is: **`workflowStudies` + string UID references + Orthanc fetch**, nothing else.
- **Per-frame metadata belongs in GeraldOS?** No. Frame-level detail is viewer-time (WADO).
- **How annotations reference images:** `study_annotations{ studyId? → workflowStudies, orthancStudyId varchar(128), seriesInstanceUid varchar(128) (nullable), tool, label, data jsonb{points[], boundingBox{{x,y,w,h} normalised 0–1}, value, units, sliceIndex?}, createdBy, createdAt }` **[EXISTS + extend `data` shape]** — never a PG FK to series.
- **How AI observations reference images:** `ai_observations{ studyId? → workflowStudies, orthancStudyId, seriesInstanceUid varchar(128) [NEW], sopInstanceUid varchar(128) [NEW nullable], frameNumber int [NEW nullable], boundingBox jsonb{[x,y,w,h] normalised}, heatmapRef varchar(300) (MinIO `s3://`), segmentationRef [NEW] }` — see §11.
- **How segmentations references are represented:** **Do not store raster.** Store reference: `segmentationRef varchar(300)` pointing to MinIO S3 `s3://geraldos/heatmaps/{observationId}.png` or `dicom-seg/s3` for DICOM-SEG (see §11). GeraldOS stores pointer, Orthanc/MinIO stores bytes.
- **How DICOM-SEG/GSPS/SR should be handled:** **Delegated.** SEG/GSPS/SR are DICOM objects stored in Orthanc via STOW (`POST /dicom-web/studies` or `POST /instances`). GeraldOS references them via `orthancStudyId` + SOP UID and renders via OHIF SEG/GSPS extensions. Reporting does not store DICOM SR as primary; `reports` remains SOR and may export SR to Orthanc on `released`.

---

## 6. COMPLETE CLINICAL WORKFLOW (canonical, idempotent)

### 6.1 Lifecycle

```
Referral  → Appointment → Patient Check-in → Study Created → Modality/Equipment
→ Image Acquisition → DICOM → Orthanc → PACS/Worklist Reconciliation
→ Radiologist Assignment → Study Opened → Clinical Context → Prior Studies
→ AI Review → Radiologist Interpretation → Report Draft → Quality/Safety Checks
→ Radiologist Approval → Report Signed → Release → Archive/Analytics
```

### 6.2 Transition table (authoritative)

| Transition | Triggering event | Authoritative source | DB mutation | External interaction | Notification | Audit event | Permissions | Failure / Retry / Idempotency |
|---|---|---|---|---|---|---|---|---|
| **Referral received** | `POST /api/referrals` or `POST /api/workflow {patientId, modality, procedure}` | Reception / API | `INSERT patients?`, `INSERT referrals?`, `INSERT workflow_studies{stage:referral, accessionNumber:generate(), priority}` | — | `referral.received` → n8n optional (urgent) | `audit:workflow.created (workflow.created)` | `receptionist, radiographer, administrator` | Idempotency key: `Idempotency-Key` header → `accessionNumber` uniqueness constraint; duplicate POST with same key returns 409 or existing row |
| **Appointment created** | `POST /api/appointments {patientId, referralId?, equipmentId?, date+time, modality, procedure}` | Scheduling | `INSERT appointments{status:scheduled}`; `UPDATE workflowStudies SET stage=appointment WHERE id=studyId` if linked | — | `appointment.created` | `audit:appointment.created` | `receptionist,scheduling` | Conflict check (equipment+slot) → 409; retry safe with idempotency |
| **Patient check-in** | `PATCH /api/appointments/{id} {checkedIn:true}` or `POST /api/workflow {action:check_in}` | Reception desk | `appointments.checkedIn=true, checkedInAt=now()`; `workflowStudies.stage=arrival` via `transitionStudy` | — | `appointment.checked_in` | `audit:appointment.checked_in` | `receptionist` | Idempotent (`checkedIn` already true → no-op) |
| **Study created** | Derived from workflow stage `study_created` (manual or auto after appointment) | Workflow | `workflowStudies.stage=study_created` via `transitionStudy` | — | `study.created` | `audit:workflow.transition study_created` | `radiographer, workflow` | Guards: `patientId` required; retry safe |
| **Modality / Equipment linked** | `PATCH /api/workflow/[id] {equipmentId}` or `PATCH /api/appointments` | Ops / device | `appointments.equipmentId=…` / `workflowStudies.equipmentId [NEW nullable]` | — | — | `audit:workflow.updated` | `radiographer, scheduling` | Non-stage update (no transition) |
| **Image acquisition** | Modality console → C-STORE / STOW | Modality | — | `C-STORE → Orthanc :4242` or `STOW-RS POST /dicom-web/studies` | — | — | `device (DICOM AE)` | Modality retries per DICOM; Orthanc handles duplicate SOP |
| **DICOM → Orthanc** | Orthanc `OnStableStudy` or `POST /instances` (GeraldOS upload) | Orthanc | — | Orthanc `Changes` entry + `/dicom-web/studies` visible | — (until reconciliation) | — | — | Orthanc guarantees at-least-once; consumer must be idempotent |
| **PACS/Worklist reconciliation** | **Reconciler**: Orthanc Changes poll or Lua webhook or n8n workflow **[NEW]** | Reconciler service (GeraldOS `services/reconciler.mjs` **[NEW]**) | `UPDATE workflowStudies SET studyInstanceUid=StudyUID, stage=sent_to_orthanc WHERE match(PatientID|accession)` else `INSERT workflowStudies{patientId=matched|new-profile, stage=sent_to_orthanc, studyInstanceUid}`; never duplicate | Fetch `/studies/{orthancId}?expand` to obtain `PatientID, AccessionNumber, StudyInstanceUID, ModalitiesInStudy` | `study.sent_to_orthanc + worklist.updated` | `audit:workflow.transition sent_to_orthanc` | Service account | **Idempotent by `studyInstanceUid` unique index**; poller `since` cursor persisted in Redis/PG; retry on `Orthanc unreachable → exponential backoff → event worklist.updated deferred` |
| **Radiologist assignment** | `PATCH /api/workflow/[id] {action:assign, radiologistId, changedBy}` | Workflow / radiologist | `workflowStudies.radiologistId=…`, `stage=assigned` via `transitionStudy` | — | `study.assigned` to `userId=radiologistId` | `audit:workflow.reassigned|transition assigned` | `administrator, radiologist, workflow` | Guard: radiologist required; reassign when `stageIndex>assigned` updates `radiologistId` without rolling stage (existing logic **[EXISTS]**) |
| **Study opened** | Workstation click `openStudy(entry)` → `POST /api/events {study.opened}` + `PATCH /api/workflow/[id] {action:transition,to:opened}` when `stage=assigned` | Workstation | `stage=opened, startedAt=now() if null` | `GET /api/orthanc/studies/{orthancId}` for detail (images stay in Orthanc) | — | `audit:workflow.transition opened` | Any authenticated user seeing worklist; transition requires assigned radiologist | Guard: radiologist required for `opened`; idempotent (`to===from → no-op`) |
| **Clinical context** | `GET /api/workstation/context?studyId=&patientId=&orthancStudyId=&modality=` | Workstation | — (reads) | FHIR `GET /Observation?subject.identifier=MRN&_sort=-date&_count=8` (best-effort) + `ai_observations accepted` similar | — | — | — | FHIR `unreachable → fhirLabSummary=null` (graceful) |
| **Prior studies** | Same `context` call | Workstation | Read `SELECT workflowStudies WHERE patientId=? AND id!=current` + Orthanc `QIDO-RS ?PatientID=` (optional) | Orthanc QIDO when PACS history desired | — | — | — | Limited to 10; no failure mode |
| **AI review** | `POST /api/ai-review {studyId?,orthancStudyId?,modality}` (from `AiTab Run AI Review` or auto on `opened` future) | Workstation or `transitionStudy(to:review)` automation **[NEW optional auto]** | `INSERT ai_observations × N {status:pending, studyId, modality, region, category, confidence, boundingBox?, differential, literature, similarCaseIds, modelVersion}` | **[NEW]** `InferenceProvider.analyzeStudy(studyUID, seriesUIDs, modality, bodyPart, framesRef)` → candidates (currently mock `generateCandidates`) | `ai.observation_suggested` | `audit:ai.review_generated` | Any authenticated; auto-trigger requires workflow permission | **Idempotent by `ai_observations` natural key** `(studyId, modality, region, modelVersion)` OR caller `Idempotency-Key` → dedup; retry reuses previous `pending` rows |
| **Radiologist interpretation** | Workstation viewer + 4 panels | Workstation | — (client interaction) | OHIF `QIDO/WADO` through proxy | — | — | `radiologist` | — |
| **Report draft** | `POST /api/reports {studyId,patientId,status:draft}` (auto on first open **[EXISTS]**) then `PATCH /api/reports/[id] {findings,impression,recommendation,templateName}` | Reporting | `INSERT reports{status:draft}` → `UPDATE reports` + `INSERT report_versions` before every mutate with content | — | `report.started`, `report.drafted`, `report.versioned` | `audit:report.*` | `radiologist, radiographer(draft only)` | Version snapshot is unconditional; `Idempotency-Key` on PATCH prevents double-version |
| **Quality/safety checks** | `POST /api/reports/assist {findings,impression, studyId}` (live as editor types) | ReportEditor | — (read+compute) | — | — (warn banner in editor) | `audit:report.ai_assist` | `radiologist` | Heuristic; never blocks save |
| **Radiologist approval** | `PATCH /api/reports/[id] {status:approved}` **[NEW intermediate]** (optional) | Reporting | `reports.status=approved` + `report_versions` | — | `report.approved` | `audit:report.approved` | `radiologist` | Distinct from `signed` (see signed) |
| **Report signed** | `PATCH /api/reports/[id] {status:signed, approvedBy, changedBy}` | Radiologist | `reports.status=signed, signedAt=now()`, `report_versions` + `UPDATE workflowStudies SET stage=signed` via `transitionStudy(to:signed)` (guard: `reports.status===signed`) | Optional export `DICOM SR STOW` to Orthanc **[NEW optional]** | `report.signed` → `REPORT_SIGNED` stage | `audit:report.signed` + `workflow.transition signed` | `radiologist` only (enforced, `roles` check, no degraded allow in prod) | **No auto-finalise**: `!approvedBy → 400` + rule `no_auto_finalise_reports`; idempotent (`status already signed → no-op`) |
| **Release** | `POST /api/workflow/[id] {action:transition,to:released}` (via `releaseStudy()` button) | Manager / radiologist after signed | `workflowStudies.stage=released, completedAt=now()` | n8n outbound `report.released` (distribution), optional FHIR `DocumentReference` | `report.released` | `audit:workflow.transition released` | `radiologist,manager,administrator` | Guard: requires `reports.status===signed`; else 400 |
| **Archive / analytics** | `POST /api/workflow/[id] {action:transition,to:archived}` (ops/retention) | Ops | `stage=archived` | — | `study.archived` (retention consumers) | `audit:workflow.transition archived` | `administrator` | Only `released → archived` |

> Every `transitionStudy` call writes **audit + `worklist.updated` + stage event + conditional `notifications`** and is **forward-only** (`toIdx < fromIdx → 409`). Every POST has **Idempotency-Key** support (header propagated to `event_log` correlation).

---

## 7. FIX THE PACS ↔ WORKLIST GAP — CHOSEN ARCHITECTURE

### 7.1 Evaluation

| Option | Eval | Fit |
|---|---|---|
| **A. Orthanc Changes API polling** | `GET /changes?since=&limit=100` loop, fetch `/studies/{id}` per new study. Pure REST, no Lua, robust replay via `since` cursor persisted in Redis/PG. | **Best operational fit for GeraldOS** — aligns with Next.js server, no Orthanc config mutation, testable, recoverable. |
| **B. Lua/event notification** | Orthanc Lua `OnStableStudy` → `http.request("POST", geraldos/webhooks/orthanc-stable", json)`. Lower latency. | Good, but requires mounting custom `orthanc.json`/`orthanc.lua`, couples availability, and still needs retry. |
| **C. n8n webhook** | Orthanc → n8n `Webhook` node → `GeraldOS /api/webhooks/n8n` → re-POST to GeraldOS workflow. | Valuable as orchestration layer, but adds n8n as critical-path dependency for clinical visibility — wrong. |
| **D. MWL / modality-driven** | Worklist feeds modality; acquisition driven. Requires MWL SCP. | Orthanc supports `ModalityWorklist`; but true MWL lifecycle is future, not MVP. |
| **E. Hybrid** | **A (primary) + B (fast-path) + E in future (add D)** | Correct long-term. |

### 7.2 Chosen: **Option A primary, B as optional fast-path, C as observer — E hybrid for production**

**Primary: Polling reconciler** `services/reconciler.mjs` **[NEW]** (or Next.js cron `GET /api/orthanc/reconcile` triggered by `setInterval` on server start — keep it in `src/lib/orthanc-reconciler.ts` with adaptive poll):

```
                   Orthanc
                      │  GET /changes?since={cursor}&limit=100 @ 5s interval (2s when busy)
                      ▼
               ┌──────────────┐   for ChangeType ∈ {newStudy, stableStudy, newInstance}
               │  Reconciler   │──→ GET /studies/{ID}?expand → { PatientID(MRN), PatientName,
               │  (GeraldOS)   │    AccessionNumber, StudyInstanceUID, StudyDate, ModalitiesInStudy }
               └──────┬───────┘
                      │ idempotent match:
                      │  1) studyInstanceUid exact (UNIQUE index) → UPDATE existing
                      │  2) accessionNumber exact (UNIQUE) → UPDATE existing
                      │  3) else CREATE workflowStudies{ patientId = lookupByMRN(MRN) or new stub patient,
                      │            studyInstanceUid, accessionNumber, modality, procedure=StudyDescription,
                      │            stage=sent_to_orthanc }
                      ▼
               ┌─────────────────┐  publishEvent(study.sent_to_orthanc) + worklist.updated + audit
               │ workflowStudies  │
               │    worklist      │
               └─────────────────┘
```

**Design notes (must be idempotent):**

- **Detection:** `since` cursor persisted in Redis `geraldos:reconciler:cursor` else PG `system_settings(key=orthanc_since)` — read at boot, written after each successful batch; retry on `Orthanc unreachable → exponential backoff 1s→30s → alert via notification`.
- **Patient matching:** `SELECT patients WHERE mrn = PatientID`. On match, use `patientId`. On miss with `PatientName+DOB` present, attempt name+DOB match (threshold), otherwise create stub `patients{ mrn:PatientID, firstName/lastName parsed from PN "DOE^JOHN", gender,dob }` with `status=active` — flagged `needs_verification` via notification to Reception. **Never silently mismatch.**
- **Accession numbers:** If `AccessionNumber` present from payload, store as `accessionNumber` on `workflowStudies`. If blank, `generateAccessionNumber()` (existing helper **[EXISTS]**) — never reuse. Unique constraint prevents duplicates.
- **StudyInstanceUID reconciliation:** Add PG unique constraint `CREATE UNIQUE INDEX ux_workflow_studies_study_uid ON workflow_studies(study_instance_uid) WHERE study_instance_uid IS NOT NULL` **[NEW migration]**, which makes duplicate `INSERT … ON CONFLICT DO NOTHING` / `ON CONFLICT UPDATE` safe.
- **Duplicates prevented by:** `(studyInstanceUid) UNIQUE WHERE NOT NULL` + `ON CONFLICT` + cursor `since` guarantee of at-least-once (not exactly-once) → reconciler re-processes same `Change` safely.
- **Incomplete studies:** Orthanc reports `IsStable` in `Studies` expand; reconciler only promotes to `sent_to_orthanc` when `IsStable=true` or `ChangeType=stableStudy` — earlier `newStudy` ingests as `stage=study_created` placeholder if desired (optional).
- **Rejected studies:** If Orthanc marks study rejected (Orthanc `Rejection` plugin or manual `DELETE /studies/{id}` reflected as `deletedStudy` change type) → `workflowStudies.stage=archived` + `study.archived` with reason in `payload`.
- **Retries:** Per-study fetch `GET /studies/{id}` retries 3× with 250ms/1s/5s; final failure writes `event_log{type:study.reconcile_failed}` + audit, advances cursor past that change (to avoid blocking head-of-line) and continues.
- **Visibility:** Any successful `INSERT/UPDATE` publishes `study.sent_to_orthanc` + `worklist.updated` → `GET /api/worklist` immediately shows the row; notification to `workflow` or `radiologist` pool.
- **Updating vs duplicating:** Exact-match on `studyInstanceUid` (primary) or `accessionNumber` (secondary) → `UPDATE`. Only on complete miss → `INSERT`. Also allow manual `POST /api/workflow` studies to be updated when their UID was initially null — reconciler fills it.

**Optional fast-path (B):** Mount `docker/orthanc/orthanc.lua` **[NEW]** with `function OnStableStudy(instanceId, tags, metadata) local studyUID=tags["StudyInstanceUID"]; httpPost(...) end` to `POST /api/webhooks/orthanc-stable` — audited and then same dedup logic. When polling already running, Lua is just an early hint; idempotent guarantees de-duplication.

**Observer (C):** n8n subscribes to `study.sent_to_orthanc` via `POST /api/events` webhook (existing `webhooks/n8n` path) for peripheral flows (HL7 export, SMS), never for worklist creation.

---

## 8. OHIF — CORRECT INTEGRATION

### 8.1 Current state verdict (from audit)

| Item | Status |
|---|---|
| `ohif-config/app-config.js` with `qidoRoot/wadoRoot/wadoUriRoot/stowRoot=/api/orthanc/dicom-web`, `wadors` | **[EXISTS]** but **UNMOUNTED** |
| `src/app/api/orthanc/dicom-web/[...path]/route.ts` QIDO/WADO/STOW proxy (auth server-side, multipart passthrough, CORS) | **[EXISTS — REAL]** |
| `docker-compose.yml:ohif ohif/app:latest :3001` | **[EXISTS]** without `volumes:` mount |
| `viewer-panel.tsx` iframe + `buildOhifUrl ?StudyInstanceUIDs=uid[,priorUid]` + `postMessage({type:"ohif-load-study"})` + `message` listener | **[EXISTS — REAL]** |

### 8.2 Target integration

#### 1) Configuration mounting/baking

- **Docker mount (local/dev):** Add to `docker-compose.yml:ohif`:
  ```yaml
  volumes:
    - ../ohif-config/app-config.js:/usr/share/nginx/html/app-config.js:ro
  ```
  and ensure the Nginx base serves `app-config.js` before SPA loads. Verify by `curl http://localhost:3001/app-config.js | grep dicom-web` in health check.
- **Bake (prod):** `frontend/Dockerfile` multistage or `ohif-config/Dockerfile` `FROM ohif/app:latest` + `COPY app-config.js /usr/share/nginx/html/` — prevents drift where compose mount missing.
- **Config content fixes:** `ohif-config/app-config.js` must set `wadoUriRoot/qidoRoot/stowRoot/wadoRoot: ${NEXT_PUBLIC_DICOMWEB_BASE || "http://localhost:3000/api/orthanc/dicom-web"}` via template (read `OHIF_URL` at build), `requestOptions` to `Accept: application/json` for QIDO, `imageRendering:wadors`, `thumbnailRendering:wadors`, `enableStudyList:true`, `enableStudyLazyLoad:true`, `strictZSpacingForVolumeViewport:true`, `maxNumberOfWebWorkers:3`. Keep `extensions:[]` `modes:[]` for stock bundle; dedicated OHIF extensions configured later.

#### 2) DICOMweb endpoint (QIDO/WADO/STOW)

- All DICOMweb traffic browser→`http://localhost:3000/api/orthanc/dicom-web/**`. Upstream maps to `Orthanc /dicom-web/**` (`docker/orthanc/orthanc.json DicomWeb.Root=/dicom-web/`). The proxy forwards `?query`, `Accept`, `Content-Type`, body verbatim with 60s timeout. **No other endpoint.**

#### 3) QIDO-RS

- OHIF `dataSource: dicomweb` calls `GET /api/orthanc/dicom-web/studies?{StudyInstanceUID, PatientID, StudyDate, ModalitiesInStudy, limit, offset, fuzzymatching}`. Proxy forwards to Orthanc `/dicom-web/studies?…`. No URL rewriting. Add `enableStudyList` in OHIF; GeraldOS worklist remains DB, not QIDO — OHIF's studylist is secondary for viewer-time browsing.

#### 4) WADO-RS

- Image retrieval via `GET /api/orthanc/dicom-web/studies/{StudyUID}/series/{SeriesUID}/instances/{SOP}/frames/{n}` (wadors). OHIF renders via Cornerstone + `wadors`. Proxy passes `Accept: multipart/related; type=application/octet-stream` unchanged; response `Content-Type: multipart/related` relayed. Thumbnail via `GET …/instances/{SOP}/preview` for GeraldOS strip; OHIF thumbnails via WADO thumbnailRendering.

#### 5) STOW-RS

- `POST /api/orthanc/dicom-web/studies` (Orthanc DICOMweb STOW) and `POST /api/orthanc/upload` (legacy multipart → `/instances`). STOW path requires `Content-Type: multipart/related; type=application/dicom`. Auth is server-side `orthancAuthHeader()` only.

#### 6) Authentication boundary

- Orthanc `Basic` header added only in `dicom-web/[...path]/route.ts` and `proxy/route.ts`. Browser never sees `ORTHANC_USERNAME/PASSWORD` (enforced by `publicClientConfig` whitelist audit **[EXISTS]**). OHIF runs unauthenticated against Next.js origin; Next.js is the auth perimeter via `geraldos_session` cookie + `src/proxy.ts`. No DICOMweb token needed.

#### 7) Study loading

- **Primary contract:** `GET ${OHIF_URL}/viewer?StudyInstanceUIDs=<StudyUID>[,<PriorUID>][&dataSources=dicomweb]`. `viewer-panel.tsx:buildOhifUrl(uid,{priorUid})` is the canonical URL builder. On `selected` change set `ohifStatus=loading`, update `iframe.src` (React key on UID) or `postMessage({type:"ohif-load-study", StudyInstanceUID: uid})` for in-place. Listen for `ohif-study-loaded`/`ohif-study-error`/`ohif-viewport-changed` via `window.addEventListener("message", {origin: OHIF_URL})` (origin check **[EXISTS]**). 10s fallback `→ready`.

#### 8) Prior study comparison

- **Around OHIF:** GeraldOS fetches `GET /api/workstation/context?patientId=` → `previousStudies[≤10]` (with `studyInstanceUid`). Prior picker in `ViewerPanel` sets `selectedPrior` then rebuilds `buildOhifUrl(current,{priorUid})` → `StudyInstanceUIDs=current,prior` (OHIF multi-study mode). **Inside OHIF:** Hanging protocols with `role:"prior"` viewports route the second Study to prior viewport (see 9). Sync scroll/WL is OHIF feature when HP declares `synchronized:true`; GeraldOS flags `syncScroll/linkWindowLevel` are `localStorage` and mapped to OHIF URL param `&hangingProtocolId=` + `viewportOptions.synchronization`.

#### 9) Hanging protocols

- **Around OHIF (GeraldOS):** `src/lib/hanging-protocols.ts` remains for UI chrome + grid (`rows×cols`, CSS grid cells) and custom creator tied to localStorage. **Inside OHIF:** Mirror the same protocols into `ohif-config/app-config.js` `hangingProtocol.protocolMatchingRules` / `displaySetSelectors` when OHIF custom viewer is introduced (future). For v1, GeraldOS grid wraps the iframe; Stage 2 moves HP inside OHIF (requires OHIF mode/extension config).

#### 10) Measurements & 11) Annotations

- **Inside OHIF:** Enable `@ohif/extension-measurementTracking` + `cornerstoneTools` (Length/Angle/Area/Arrow/Ellipse) via OHIF mode config. Measurements originate inside OHIF canvas.
- **Bridge:** Add GeraldOS→OHIF listener: `message {type:"ohif-measurement-added", tool, label, data:{value,units,points,boundingBox,sliceIndex,seriesInstanceUid}}` → `POST /api/annotations {studyId, orthancStudyId, seriesInstanceUid, tool, label, data, createdBy}` (existing persistence). Reverse path (load): on `study.opened` fetch `GET /api/annotations?studyId=&orthancStudyId=` → `postMessage({type:"load-annotations", annotations})` to OHIF extension (requires extension sidecar — schedule as part of Phase 2/3).
- **Around OHIF until extension:** Current manual `MeasureTab` tools remain for Phase 1; labelled **[SCAFFOLD]** until cornerstone bridge lands.

#### 12) AI overlays

- **[DELEGATED to OHIF canvas]** once `boundingBox` real (see §9). OHIF `ViewportOverlay` / `SegAnnotation` extensions render `ai_observations.boundingBox{ x,y,w,h normalised }` via same `postMessage({type:"load-ai-overlays", observations})`. GeraldOS `AiReviewOverlay` (DOM) deprecated in favour of canvas overlays; retain as fallback until canvas path proven.

#### 13) Segmentation

- DICOM-SEG stored in Orthanc (`POST /dicom-web/studies` SEG). OHIF `extension-segmentation` loads via `GET /dicom-web/studies/{UID}/series/...` and renders. GeraldOS stores pointer `ai_observations.segmentationRef = s3://…` or `orthancStudyId+SOP` reference; never the raster.

#### 14) Structured reports

- DICOM SR: On `report.released` optionally export via `POST /dicom-web/studies` with SR template (`TID 1500`) referencing `Study/SOP`. Stored in Orthanc; GeraldOS `reports` remains authoritative.

#### 15) Communication

- Contract: `postMessage {type: "ohif-load-study"|"load-annotations"|"load-ai-overlays"|"ohif-measurement-added"|"ohif-study-loaded"|"ohif-study-error"|"viewport-loaded"}`. Origin-checked. GeraldOS owns the `iframe` lifecycle; OHIF owns the canvas. No `localhost` calls from browser code — all via `OHIF_URL` origin.

**Ownership split:** *Inside OHIF* — rendering, tools, HP matching, WADO/QIDO/STOW data fetching. *Around OHIF in GeraldOS* — URL driving, worklist→study binding, context panels, report/AI orchestration, persistence, auth.

---

## 9. AI INFERENCE ARCHITECTURE

### From MOCK → REAL (the contract, not a model)

```
                DICOM (Orthanc :8042 /dicom-web/)
                           │  WADO-RS GET …/instances/{SOP}/frames/{n}
                           ▼
              Image extraction / preprocessing  [DELEGATED to Inference Service]
               (windowing, resampling, modality LUT, normalisation,
                series stacking, slice selection, de-identification if needed)
                           │
                           ▼
                 Inference engine(s)  [DELEGATED — one adapter per model]
               (MONAI bundle / ONNX Runtime / Torch / Clara-compatible / vendor API)
                           │
                     Structured model output  (raw)
                { label, score, bbox[x,y,w,h px or normalised],
                  maskPointer, heatmapPointer, measurements }
                           │
                           ▼
            AI observation normalisation  [NEW — GeraldOS normaliser]
              Map raw → ai_observations row(s):
              modality, region, category(finding|critical|normal|technical),
              description, confidence 0–100, boundingBox jsonb,
              heatmapRef/segmentationRef (S3/Orthanc pointer),
              suggestedDifferential[], literatureRefs[], similarCaseIds[],
              modelId, modelVersion, provenance
                           │
                           ▼
              GeraldOS AI governance  [EXISTS — upgraded]
                InferenceProvider wrapper:
                → INSERT ai_observations status=pending
                → audit ai.review_generated
                → publish ai.observation_suggested
                → Decision Engine if agent-proposed (rule check)
                           │
                           ▼
                 Radiologist review  [viewer-panel AiTab + overlay]
                    Accept / Reject / Modify (future)
                           │
                           ▼
                         Audit  (audit_log + event_log + reportVersions.aiAssisted)
```

#### Input contract (to `InferenceProvider`)

```ts
interface InferenceInput {
  studyInstanceUid: string;          // required
  seriesInstanceUids?: string[];     // optional scope; default = all series in study
  sopInstanceUids?: string[];        // optional instance scope
  frames?: { sopInstanceUid: string; frameNumber: number }[]; // multiframe
  modality: string;                  // "CT" | "X-Ray" | "MRI" | …
  bodyPart?: string | null;          // e.g. "Chest", "Brain"
  procedure?: string | null;
  orthancStudyId?: string;           // optimisation: skip UID→Orthanc resolve
  dicomWebBase: string;              // e.g. "http://orthanc:8042/dicom-web" (server-side)
  authHeader?: Record<string,string>; // Orthanc Basic (server-side only)
}
```

The provider internally `GET …/frames/{n}` (server-side, never browser), applies preprocessing (MONAI `transforms` / windowing per modality), and runs the model. GeraldOS never ships pixel bytes to the browser for inference.

#### Output contract (from `InferenceProvider` → normalised)

```ts
interface ModelInference {
  modelId: string;        // "geraldos-mock" | "ct-chest-nodule-v2" | vendor id
  modelVersion: string;   // semantic, e.g. "2.1.0"
  observations: {
    category: "finding" | "critical" | "normal" | "technical";
    region: string;       // anatomy label, e.g. "Right Upper Lobe"
    description: string;  // plain English, non-diagnostic: "Area of interest …"
    confidence: number;   // 0–100 (model raw → normalised)
    uncertainty?: number; // 0–100, explicit aleatoric/epistemic when available
    boundingBox?: { x:number; y:number; w:number; h:number } | null; // normalised 0–1 in frame coords
    polygon?: { x:number; y:number }[] | null; // alternative shape
    segmentationRef?: string | null;  // S3 key `s3://geraldos/segs/{obsId}.dcm` or Orthanc SOP reference
    heatmapRef?: string | null;       // S3 key `s3://geraldos/heatmaps/{obsId}.png`
    measurements?: { type:string; value:number; units:string }[]; // e.g. nodule diameter mm
    suggestedDifferential?: string[];  // fixed taxonomy, not diagnosis
    literatureRefs?: string[];
    similarCaseIds?: string[];
    evidence?: { seriesInstanceUid:string; sopInstanceUid:string; frameNumber?:number };
  }[];
  provenance: {
    preprocessing: string;   // hash/id of transform chain
    inferenceAt: string;     // ISO timestamp
    latencyMs: number;
    computeEnv: string;      // image tag / device
  };
}
```

The normaliser in GeraldOS maps `ModelInference.observations[]` → `ai_observations` rows (adds `orthancStudyId`, `studyId`, `reviewed*`, `status:pending`, `modelVersion=modelId@version`). Raw model bytes (heatmaps, masks) are uploaded to MinIO; only refs stored.

#### Safety (non-negotiable)

- **Decision support, not autonomous diagnosis:** `generateCandidates` docstring and `decision-engine` rule `no_autonomous_diagnosis (targetAction==="set_diagnosis" → fail)` stay. Categories are `finding|critical|normal|technical` — never `diagnosis`. Every observation requires `accepted|rejected|modified` before any downstream report use.
- **Provenance:** Every row carries `modelId@version + inferenceAt + computeEnv`. `report_versions.aiAssisted` + `audit_log.details.modelVersion` chain links report → observation → model.
- **Confidence handling:** Display as `%` with bands (≥80 critical, ≥60 finding) but never auto-escalate without human threshold confirmation. Uncertainty, when reported, surfaced alongside confidence.
- **Reproducibility:** Given `studyInstanceUid + seriesInstanceUid + frame + modelVersion + preprocessing hash`, re-run yields byte-identical bbox/heatmap (store transform hash).
- **Rollback / correction:** `PATCH /api/ai-review/[id] {status:"rejected"}` or `modified` **[NEW]** (amended description/bbox) creates new row or version (see §11). Original never mutated destructively; audit keeps full chain.

---

## 10. AI MODEL ADAPTER ARCHITECTURE

### Abstraction (provider-independent)

`src/lib/inference/provider.ts` **[NEW]**:

```ts
export interface InferenceProvider {
  readonly id: string;           // "mock" | "monai-ct" | "onnx-xray"
  readonly version: string;
  getCapabilities(): Promise<{ modalities:string[]; bodyParts:string[]; categories:string[]; supportsHeatmap:boolean; supportsSegmentation:boolean }>;
  getModelMetadata(): Promise<{ modelId:string; modelVersion:string; vendor?:string; trainedOn?:string; regulatory?:string }>;
  analyzeStudy(input: InferenceInput): Promise<ModelInference>;
  analyzeSeries(input: InferenceInput & { seriesInstanceUid:string }): Promise<ModelInference>;
  analyzeInstance(input: InferenceInput & { sopInstanceUid:string; frameNumber?:number }): Promise<ModelInference>;
  healthCheck(): Promise<{ ok:boolean; latencyMs:number; detail?:string }>;
}
```

#### Capability contract

- `analyzeStudy` fetches all frames for the Study (server-side WADO) unless `seriesInstanceUids` scopes it; `analyzeSeries` / `analyzeInstance` are optimised single-series/frame paths called from viewer context menu (future).
- Every provider returns **the same `ModelInference` shape** — GeraldOS normaliser is agnostic to internals. Auth to Orthanc is injected, never hardcoded.

#### Provider registry

`src/lib/inference/registry.ts` **[NEW]**:

```ts
import { MockProvider } from "./providers/mock"; // [EXISTS logic moved here]
import { HttpInferenceProvider } from "./providers/http"; // generic Python sidecar
export const INFERENCE_MODE = process.env.INFERENCE_MODE ?? "mock"; // "mock" | "http" | "monai:ct-v2"
export function getProvider(): InferenceProvider { switch … }
```

- `MockProvider` wraps current `src/lib/ai-review.ts:generateCandidates` and produces `ModelInference{modelId:"geraldos-mock@1"}` with `boundingBox=null` — remains for dev/test and for demo when `AI inference` service not deployed.
- `HttpInferenceProvider` POSTs to `http://inference:5005/analyze` (configurable `INFERENCE_URL`) with `{studyInstanceUid, dicomWebBase, auth}`; inference service returns `ModelInference`. GeraldOS never imports Torch/MONAI.
- Future: `MonaiProvider`, `OnnxProvider`, `VendorProvider` just implement the interface; swap via `INFERENCE_MODE`.

#### How future providers plug in

1. Add `services/inference/` Python service (FastAPI) with endpoints `POST /analyze`, `GET /capabilities`, `GET /health` — implements Windowing/MONAI transforms + model. Container `inference:5005` in `docker-compose.yml` **[NEW]** (see §10 compose row).
2. Vendor API: `VendorProvider` that `timedFetch(vendorURL, {headers:{Authorization:"Bearer "+VENDOR_KEY}})` — GeraldOS never sends pixel to vendor without DPA; proxy server-side.
3. All providers register in `registry.ts` and are selected by `INFERENCE_MODE` without changing `api/ai-review/route.ts:POST` (that route just calls `const provider=getProvider(); const result=await provider.analyzeStudy(input)`).

No rebuild of GeraldOS reporting/workstation when swapping model.

---

## 11. AI OBSERVATION MODEL — MINIMUM VIABLE BUT EXTENSIBLE

### Current `ai_observations` (from `src/db/schema.ts`)

```
id uuid PK, studyId uuid FK→workflowStudies?, orthancStudyId varchar(128),
modality varchar(50), region varchar(100), category varchar(50) finding|normal|technical|critical,
description text, confidence numeric(5,2), boundingBox jsonb, heatmapRef varchar(300),
suggestedDifferential jsonb, literatureRefs jsonb, similarCaseIds jsonb,
status pending|accepted|rejected, reviewedBy varchar(100), reviewedAt timestamp,
modelVersion varchar(100) default geraldos-review-1, createdAt timestamp
```

**Assessment:** Correct shape for study-level candidates; insufficient for series/instance/frame provenance, polygons/masks, uncertainty, modification history, per-frame evidence.

### Recommended schema (minimum + extensible)

**Migration — add columns only (no table rebuild, see §23):**

```sql
ALTER TABLE ai_observations ADD COLUMN series_instance_uid varchar(128);
ALTER TABLE ai_observations ADD COLUMN sop_instance_uid   varchar(128);
ALTER TABLE ai_observations ADD COLUMN frame_number       integer;
ALTER TABLE ai_observations ADD COLUMN uncertainty        numeric(5,2);
ALTER TABLE ai_observations ADD COLUMN model_id           varchar(100) DEFAULT 'geraldos-mock';
ALTER TABLE ai_observations ADD COLUMN segmentation_ref   varchar(300);
ALTER TABLE ai_observations ADD COLUMN polygon            jsonb; -- {points:[{x,y}]} normalised 0-1
ALTER TABLE ai_observations ADD COLUMN evidence           jsonb DEFAULT '{}'; -- { seriesInstanceUid, sopInstanceUid, frame, sliceIndex, windowing }
-- Status becomes pending|accepted|rejected|modified (extend check, no enum constraint)
-- reviewedBy/reviewedAt keep; add:
ALTER TABLE ai_observations ADD COLUMN modified_description text;
ALTER TABLE ai_observations ADD COLUMN provenance         jsonb DEFAULT '{}'; -- { preprocessingHash, inferenceAt, latencyMs, computeEnv }
CREATE INDEX ix_ai_obs_study ON ai_observations(study_id);
CREATE INDEX ix_ai_obs_orthanc ON ai_observations(orthanc_study_id);
CREATE UNIQUE INDEX ux_ai_obs_dedup ON ai_observations(study_id, modality, region, model_id, model_version)
  WHERE status != 'rejected'; -- idempotency (see §9)
```

**For `report_versions`:** already `aiAssisted bool` exists **[EXISTS]** — sufficient to link report→AI.

**Do NOT add:** separate `ai_observation_versions` table for v1 — `modified_description` + `provenance` + audit row suffice. If modification history grows, introduce versions in next iteration.

### Capability matrix

| Need | Field | Supported |
|---|---|---|
| study-level finding | `studyId + orthancStudyId` | YES **[EXISTS]** |
| series-level | `series_instance_uid` **[NEW]** | NEW |
| instance/frame-level | `sop_instance_uid` + `frame_number` **[NEW]** | NEW |
| bounding box | `boundingBox jsonb {x,y,w,h normalised 0-1}` **[EXISTS]** but RNG today → real provider will populate | YES (extend) |
| polygon | `polygon jsonb` **[NEW]** | NEW |
| segmentation mask | `segmentationRef varchar → MinIO s3://` or DICOM SEG in Orthanc **[NEW]** | NEW |
| heatmap | `heatmapRef → s3://` **[EXISTS]** (populate from provider) | YES |
| measurements | Derived from observation `description` today + **[NEW]** `evidence.measurements` jsonb | NEW extension |
| model provenance | `model_id + modelVersion + provenance jsonb{preprocessingHash, inferenceAt, latencyMs}` **[NEW]** | NEW |
| confidence | `confidence numeric(5,2)` **[EXISTS]** | YES |
| uncertainty | `uncertainty numeric(5,2)` **[NEW]** | NEW |
| accepted/rejected/modified | `status` enum extension **[NEW: modified]** + `modified_description` + `reviewedBy/At` **[EXISTS]** | YES |
| reviewer identity/timestamp | `reviewedBy/At` **[EXISTS]** | YES |
| evidence / literature | `evidence jsonb`, `suggestedDifferential`, `literatureRefs`, `similarCaseIds` **[EXISTS]** | YES |
| Reproducibility | `provenance + series/sop/frame + modelVersion` | NEW |

**Reject overengineering:** No separate `ai_observation_edits` table, no versioned heatmap store beyond MinIO refs, no per-voxel mask table in PG.

---

## 12. DECISION ENGINE (safety boundary)

### Current **[EXISTS — src/lib/decision-engine.ts]**

Pipeline today: `Recommendation → Rules → Validation → Approval → Execution → Audit`.

Rules (enforced):

- `no_auto_finalise_reports` — `targetModule===reports && targetAction in [sign,finalise,approve] → fail`
- `no_autonomous_diagnosis` — `targetAction==="set_diagnosis" → fail`
- `stat_priority_allowed` — `priority=stat → only in scheduling/workflow`
- `reallocation_requires_equipment_context` — `reallocate_slots → equipmentId|appointmentIds required`

### Target

```
Agent / AI / Rules Engine
          │
          ▼
     Recommendation  {agent,recommendation,rationale,priority,targetModule/Action/Payload,requestedBy}
          │
          ▼
    Decision Proposal  POST /api/decisions → INSERT ai_recommendations{status:proposed|validated, ruleResults}
          │
          ▼
   Policy / Rules  (server-side evaluateRules()) — block list, never client-supplied
          │
          ▼
      Validation  (schema + target whitelisting + scope checks)
          │
          ▼
    Human Approval (where required per taxonomy)  PATCH /api/decisions/[id]/approve {approvedBy, role}
          │
          ▼
     Execution (target adapter, never direct table write by agent)
          │
          ▼
   Audit  (audit_log + event_log)
```

### Which actions must **always require human approval** (deny execution otherwise)

| Target module | Action | Approval | Reason |
|---|---|---|---|
| `reports` | `sign`, `finalise`, `approve`, `release` | **radiologist** (and `approvedBy` required, see `reports/[id] PATCH` guard) | Clinical liability |
| `reports` | `set_diagnosis` | **never allowed** (`no_autonomous_diagnosis`) | No AI diagnosis |
| `reports` | any change when `priority:stat` with no radiologist context | `stat_priority_allowed` | Escalation abuse |
| `workflow` | `transition to signed|released|archived` | `radiologist|manager|administrator` as per §6 table | Handoff guards |
| `workflow` / `scheduling` | `reallocate_slots` | `scheduling|workflow` + equipment context | Operational disruption |
| `finance` | `invoice.submit`, `claim.submit`, `payment.record` | `manager|administrator|finance` | Financial liability |
| `equipment` | `schedule_maintenance`, `change_status` | `administrator|equipment manager` | Ops liability |
| `inventory` | `order_reorder`, `consume_critical_batch` | `inventory manager|administrator` | Supply |
| `patients` | `merge`, `delete`, `anonymise` | `administrator` + audit | PHI safety |
| `knowledge` | `publish`, `archive` | `knowledge editor|administrator` | SOP governance |
| `*` | `priority:stat` outside `scheduling|workflow` | blocked | Abuse |
| `*` | `reallocate_slots` without `equipmentId|appointmentIds` | blocked | Scope |

### Definition details

- **Action taxonomy:** `targetModule: {reports, workflow, scheduling, appointments, patients, equipment, inventory, finance, knowledge}` × `targetAction: {sign, reallocate_slots, assign, route, publish, order, …}` — whitelist in `decision-engine` (only listed modules/actions can `executed`).
- **Authorisation:** `requestedBy` (agent sub) + `approvedBy` (human sub from `geraldos_session.roles`) — checked server-side via `verifySessionToken`.
- **Approval requirements:** Policy table `requiresApproval(targetModule, targetAction, priority)` — returns required role; `proposed → validated (rule pass) → approved (human) → executed`. Failed rules never reach `validated`.
- **Idempotency:** `ai_recommendations.id` is the idempotency key for `approve/execute` (POST with `Idempotency-Key: <uuid>` → dedup). `executed` is terminal; duplicate `execute` → 409.
- **Audit:** One row per `proposed`, one per `approved|rejected`, one per `executed|failed` (distinct). `auditRef` links to `audit_log.id`.
- **Rollback / failure:** `status:failed` + `validationResults` / `details` populated; no auto-retry for `failed`; human re-proposes. Reversal is compensation (new `rejection` decision), not row deletion.

---

## 13. AGENT ARCHITECTURE (9 agents)

### Current **[SCAFFOLD]**

Registry `AGENTS[9]` (`reception, scheduling, workflow, reporting, equipment, inventory, quality, executive, knowledge`) with `mission, tools[], memory, events[], responsibilities[], color` **[EXISTS]**; runtime is `handleAgentRequest()` fallback (snapshot PG + templated replies) **[EXISTS]**; `POST /api/agents/chat → LangGraph threads/runs/wait` else fallback **[EXISTS + graceful]**.

### Target architecture

```
User message / Event / API action
         │
   Agent Router  POST /api/agents/chat  →  langGraph? run assistant(graphId) : handleAgentRequest(fallback)
         │                                       │
         ▼                                       ▼
   Decision Proposal  ←—— agent must NOT mutate PG directly; only calls tools below
         │  POST /api/decisions {agent,recommendation,targetModule/Action/Payload}
         ▼
   Decision Engine (rules, validation, approval)
```

Agents call **controlled tools** (LangGraph `tools` or fallback `src/lib/agents.ts:tools`). No `db.*` from agent code.

### Per-agent specification

| Agent | Mission | Inputs | Tools (allowed) | Events *subscribed* | Memory | Actions it can **propose** | Human approval |
|---|---|---|---|---|---|---|---|
| **Reception** | Verify identity/eligibility, manage consent, intake | `patient`, referral, insurance, consent docs | `searchPatients`, `registerPatient`, `verifyEligibility(FHIR Coverage)`, `manageConsent`, `proposeAppointment` | `patient.registered|updated`, `referral.received`, `appointment.checked_in` | Patient registry, eligibility cache, consent state | `recommend eligibility note`, `propose appointment`, `remind intake` | **executes** intake/lookup; **proposes** eligibility communication |
| **Scheduling** | Allocate slot by priority (STAT>urgent>routine, FIFO) | Appointments, equipment status, staff roster | `equipmentStatus`, `staffRoster`, `slotInventory`, `reallocateSlots(targetModule:scheduling, payload:{equipmentId,appointmentIds})` | `appointment.created|delayed|checked_in`, `equipment.online|offline`, `study.created` | Slot table, conflict index | `reallocate_slots` (requires `equipmentId|appointmentIds`) | **proposes**; **executes** only after `approved` + `Scheduling` role |
| **Workflow** | Pipe `referral→archive` TAT, bottlenecks, escalations | `workflowStudies`, event_log, equipment/queue | `pipelineSnapshot`, `transitionStudy` (via Decision `target:workflow transition`, never direct `db.update`), `priorityEscalate`, `suggestNextStage` | `referral.received` … `study.archived` (all workflow) | Pipeline counts (`inPipeline`, stage backlog, TAT breach) | `transition to assigned/opened/review`, `priority=stat` (within `scheduling|workflow` only) | **proposes** every transition; **never executes without approval** beyond `arrival` check-in |
| **Reporting** | Structure, terminology, quality, never diagnosis/finalisation | Report draft, template, prior impression, lab | `reportAssist(POST /api/reports/assist → quality, drift, critical)`, `recommendTemplate`, `qualityScore` | `report.started|drafted`, `ai.observation_suggested` | Templates, terminology map, critical list | drafting help, checklist reminders | **Decision support only**; never `sign` (blocked by rule) |
| **Equipment** | Calibration/maintenance health, downtime impact | `equipment`, `maintenanceRecords`, schedule | `fleetStatus`, `calibrationDue`, `scheduleMaintenance`, `downtimeImpactOnSchedule` | `equipment.online|offline`, `maintenance.scheduled` | Fleet health, calibration window | `propose maintenance` | **proposes** maintenance; **executes** after `approved` |
| **Inventory** | Stock/expiry, reorder advisory | `inventory_items`, `inventory_transactions` | `lowStockQuery`, `expiryScan`, `proposeReorder` | `inventory.updated|low_stock` | Stock levels, expiry dates | `propose reorder` | **never auto-orders**; proposes only |
| **Quality** | Report+AI quality gate, checklist, audit link | `ai_observations{pending}`, `report_versions{quality<70}` | `pendingObsCount`, `lowQualityReportScan`, `checklistFor(modality)` | `ai.observation_*`, `report.versioned|signed` | Thresholds, accreditation checklist | `flag low-quality`, `require checklist` | **flags**; never auto-rejects report |
| **Executive** | Ops/finance snapshot, trend, decision proposal | `invoices+claims` outstanding, inventory/equipment aggregates | `financeSnapshot`, `trendAnalysis` (read-only) | `inventory.low_stock`, `equipment.offline`, `decision.proposed` | Invoices/claims outstanding, trends | `propose forecast/action` | **proposes** to management; never executes financial mutation |
| **Knowledge** | Answer **only** from `published` SOP/protocol docs | `knowledge_documents{published}`, message query | `knowledgeSearch`, `protocolRetrieval` | `knowledge.published` | Document index, published flag, version | `cite document(s)` | **refuses** if no published match — no hallucination |

### Behavioural split (applies to every agent)

| Behaviour | Agents | Notes |
|---|---|---|
| **Reactive** (respond to inbound message) | all 9 | via `/api/agents/chat` |
| **Conversational** | `reception, reporting, knowledge` | multi-turn chat recommended |
| **Event-driven** | `scheduling, workflow, equipment, inventory, quality, executive` | `events[]` list is not just display — Phase 3 wires Redis consumer → agent dispatch |
| **Analytical** | `executive, quality, equipment` | Aggregation over `snapshot()` / `eventCounts()` |
| Can **propose** actions | all via `ai_recommendations` → Decision Engine | Always via `proposeDecision` |
| Can **execute** without approval | **none** | Even `reallocate_slots` requires `approved` Decison + `schedule` role (see §12). Current fallback never writes — keep that. |
| Must **never execute** without approval | **all** | Hard rule `no_auto_finalise_reports` + `no_autonomous_diagnosis` guard; extend per taxonomy |

**Invariant:** `src/lib/agents.ts:handleAgentRequest` may never do `db.update` on `workflowStudies/reports` etc; only `snapshot()` reads. Execution goes through `Decision Engine`.

---

## 14. EVENT-DRIVEN ARCHITECTURE (target)

### Current **[SCAFFOLD]**

- `src/lib/events.ts` — `EVENT_TYPES 39`, `EVENT_STREAM="geraldos:events"`, `EVENT_GROUP="geraldos-consumers"`, `publishEvent() { XADD (best-effort, capped 10k) + INSERT event_log durable }`, `listEvents(limit,type)` from PG. **[EXISTS]**.
- Redis Streams publishing real but **no consumers** (`EVENT_GROUP` unused, no `XREADGROUP/XACK`). Read via `listEvents` from PG. SSE `api/events/stream` polls PG, not Redis. No idempotency, no dead-letter.

### Target — one system, two faces

```
                     ┌────────────────────────────────────────────┐
  Producers          │           publishEvent(type, aggregate,     │
  ─────────          │            aggregateId, payload, source)    │
  • workflow:        │                     │                       │
    transitionStudy ─┼─►  Redis Streams ──┼─►  PostgreSQL         │
  • reports:         │    geraldos:events  │     event_log         │
    signed/versioned │    XADD MAXLEN ~10k │     (durable, PK     │
  • ai/station:      │    (transport +     │      serial, insert- │
    observations,    │     ordering +      │      only, ordered)   │
    measurements     │     consumer groups)│       │               │
  • agents:          │                     │       │               │
    decision.*       │                     │       │               │
  • orchestrator:    │                     │       └─── Consumers ─┘
    n8n, reconciler  │                     │            │  read from PG
                     └─────────────────────┘            │  (not Redis) for:
                                                        │  • GET /api/events
                                                        │  • SSE stream
  Consumers (Redis, for async automation)               │  • activity-panel
  ─────────                                              │  • command-centre
  • Agent runtime (per-AGENT group)                      │
    geraldos-consumers:<agentId>                         │
  • Notification dispatcher (single group)                │
  • n8n webhook forwarder (observer, at-least-once)     │
                                                         
                                                    
```

**Why keep Redis Streams?** Keep it — but only as **transport + ordering** for async consumers; **PG `event_log` is the durable, replayable, auditable log**. Do **not** create two competing logs.

### Specification if kept

- **Producers:** Always dual-write: `XADD` (best-effort) + `INSERT event_log` (authoritative). The `occurredAt ISO` added inside `publishEvent`. If Redis `unreachable`, `event_log` ensures no loss.
- **Consumer groups:** One group per logical consumer type:
  - `geraldos:agent-<id>` per agent (9 groups) — **event-driven agents** consume from Redis (not PG poller).
  - `geraldos:notifications` — Notification Dispatcher → `notifications` table.
  - `geraldos:n8n` — webhook forwarder.
  - Use `XGROUP CREATE geraldos:events <group> $ MKSTREAM` on boot (idempotent). GeraldOS boots the groups owner (`services/infra/init-streams.mjs` **[NEW]** or Next.js startup hook).
- **Schema:** Every stream entry: `type, aggregate, aggregateId, source, payload (JSON)`. In PG also: `id serial (ordering), eventType, aggregate, aggregateId, payload jsonb+occurredAt, source`. The **event `id: serial`** is the authoritative order; Redis `EntryID` is transport order.
- **Correlation & causation:** Add optional headers to `payload`: `correlationId (client-supplied Idempotency-Key or generated uuid)`, `causationId (ID of the command/event that caused this event)`, `idempotencyKey` — carried through Redis entry + PG row.
- **Idempotency:** Consumer table `consumer_offsets{consumerGroup, lastProcessedId}` or use Redis `XACK` + PG `ON CONFLICT ON correlationKey DO NOTHING`. Upstreams also have dedup (`studyInstanceUid` unique, `Idempotency-Key` on POSTs).
- **Retries:** Consumer `XREADGROUP COUNT 1 BLOCK 2000` loop. On handler error, `XCLAIM` after 30s idle; retry up to 5× with exponential backoff (1s→30s), then `XACK` + write to `event_log{type:consumer.dead_letter}` (DLQ) + `notifications{type:alert, severity:high}`. Never loop forever.
- **Ordering:** Within a stream, FIFO. For PG replay, `ORDER BY id` is the truth. Redis consumer ordering is stream-order; PG ordering is audit-order.
- **Replay:** Agents may query `GET /api/events?type=&limit=200&afterId=` from PG for replay; Redis `XRANGE` for transport replay. No re-processing of `ack`ed entries.
- **Observability:** `GET /api/events/counts` (today) + new `GET /api/integrations/status` field `pendingEvents{group,pending, lagMs}` from `XPENDING`/`XINFO`. Command Centre shows lag.

### Relationship matrix

| Component | Reads from | Writes to | Role |
|---|---|---|---|
| `event_log` (PG) | producers write; API reads | durable audit + replay | **source of truth** |
| Redis `geraldos:events` | producers `XADD`; consumers `XREADGROUP`/`XACK` | volatile transport + fan-out | **delivery** |
| `SSE /api/events/stream` | polls `event_log` today → Streams via `XREAD` tomorrow | pushes to browser | live activity feed |
| Agents (LangGraph + fallback) | Redis consumer groups + `GET /api/events` for recovery | `POST /api/events` + `ai_recommendations` | reactive intelligence |
| `n8n` | Redis `geraldos:n8n` group → `POST /api/webhooks/n8n` | inbound `audit + event_log` | automation |
| `notifications` | written by `transitionStudy` + consumers | read via `GET /api/notifications` | dispatch |
| `audit_log` | written by `recordAudit` (insert-only) | read for compliance | immutable |

---

## 15. SECURITY ARCHITECTURE

### Current **[EXISTS + risky degraded mode]**

- `src/lib/auth/oidc.ts` + `src/lib/auth/session.ts` (HS256 via `jose`, `SESSION_COOKIE=geraldos_session`, 8h, `httpOnly,sameSite:lax`).
- `src/app/api/auth/{login,callback,me,logout,dev}/route.ts` — full Authorization Code + JWKS verify (`verifySessionToken`).
- `src/proxy.ts` (Next.js middleware) gates when `KEYCLOAK_URL` set; allows `/login,/api/auth,/api/health,/api/webhooks,/_next` anonymously; 401 on `NextRequest: /api/*` else redirect `/login`.
- **`api/auth/dev` allowed when `!keycloakConfigured() || DEV_AUTH==="true"` → mint admin+radiologist session.** `src/proxy.ts` bypasses entirely when `!KEYCLOAK_URL`. `secretKey()` fallback `"geraldos-dev-secret-change-me"`; no `secure` flag; `roles.length===0 → allow signing` degraded path in `reports/[id]`.

### Target model

```
Browser  ──►  Keycloak  ──►  id_token( RS256, aud=geraldos-frontend, realm_access.roles )
  │                │                         │
  └──── callback ──┘                         ▼
                                  Next.js verify via JWKS  ──►  Set-Cookie: geraldos_session
                                                                (HS256, 8h, httpOnly, sameSite=lax,
                                                                 secure in prod, __Host- prefix, path:/)
                                         │
                                    src/proxy.ts (every request)
                                         │
                                  API authorization (per-route RBAC via roles)
                                         │
                         ┌───────────────┴───────────────┐
                         │  Service-to-service           │
                         │  Orthanc Basic (server-only)  │
                         │  HAPI FHIR (optional Bearer)  │
                         │  MinIO SigV4 (aws4fetch)      │
                         │  LangGraph X-Api-Key          │
                         │  n8n X-Api-Key / webhook token│
                         │  Inference service Bearer      │
                         └───────────────────────────────┘
                                                         
                                    audit_log (every decision, transition, sign, AI review)
```

#### OIDC & session

- `KEYCLOAK_URL`, `KEYCLOAK_REALM=geraldos`, `KEYCLOAK_CLIENT_ID=geraldos-frontend`, `KEYCLOAK_CLIENT_SECRET` (confidential client when available). Issuer `=${KEYCLOAK_URL}/realms/${REALM}` canonical.
- Discovery `/.well-known/openid-configuration` → JWKS → `jwtVerify(id_token, jwks)`. Verify `iss, aud, exp, iat`, extract `sub, email, preferred_username, realm_access.roles[]`.
- Issue internal session `HS256` with `sub, name, email, roles[], iss="geraldos"`, `exp 8h`, `jti=uuid` (add **[NEW]** for revocation), `httpOnly, secure (prod), sameSite=lax, __Host-` prefix, `path:/, maxAge 28800`.
- Logout `GET /api/auth/logout` clears cookie + (optional) Keycloak back-channel logout when `end_session_endpoint` available.

#### Roles & permissions

| Role | Tooling | Permissions (illustrative) |
|---|---|---|
| `administrator` | admin/ops | `*:*` except none; manages `roles, branches, tariffs` |
| `radiologist` | reader + reporter + approver | `patients:read, worklist:read, report:{create,update,sign,release}, ai_review:{accept,reject}, imaging:read` |
| `radiographer` | acquisition | `patients:read, appointments:checkin, workflow:study_created, imaging:upload` |
| `receptionist` | intake | `patients:read|create, appointments:create, referrals:create` |
| `manager` | finance+ops | `finance:{invoice,analytics}, report:release (after signed), equipment:read, inventory:read` |
| `viewer` | read-only | `worklist:read, imaging:read, knowledge:read` |

Map via `roles` table `permissions jsonb string[]` + server-side `requireRole(roles, "radiologist")` helper **[NEW — src/lib/auth/requireRole.ts]**. Every mutating route (`reports/[id] PATCH sign`, `workflow/[id] PATCH transition to signed|released`) must assert `checkRole(token.roles)` — not just signing.

#### Service-to-service auth

- **Orthanc:** `Basic base64(ORTHANC_USERNAME:ORTHANC_PASSWORD)` constructed server-side in `orthancAuthHeader()` — never to browser. Add `ORTHANC_URL` required in prod (fail boot if missing).
- **HAPI FHIR:** `FHIR_URL` optional; if FHIR requires auth, add `FHIR_API_KEY→Authorization: Bearer`. No credential leaves server.
- **MinIO:** SigV4 via `aws4fetch` (`MINIO_ACCESS_KEY/SECRET_KEY`); presign server-side.
- **n8n:** Outbound `N8N_API_KEY → X-API-Key`; inbound webhook `POST /api/webhooks/n8n` validates `x-n8n-token == N8N_WEBHOOK_TOKEN` env **[NEW]**.
- **LangGraph:** `LANGGRAPH_API_KEY → X-Api-Key` on `POST /threads/:id/runs/wait`; `inference:5005` `INFERENCE_API_KEY → Bearer`.
- No secret enters `publicClientConfig`.

#### Secrets

- All in `.env` / Docker secrets / platform vault. `AUTH_SECRET` must be 32+ bytes (validated at boot, no fallback in prod). No secret in git. `.env.example` values labelled `replace-me`. The current defaults (`orthanc, geraldos-secret, …`) are **compose-dev only**.

#### `KEYCLOAK_URL` absent — the degraded-mode policy

- **`development` (explicit `NODE_ENV=development`):**
  - `GET /api/auth/dev` enabled only when `DEV_AUTH==="true"` AND `NODE_ENV!=="production"` (gate at handler) — remove `!keycloakConfigured()` auto-enable.
  - `src/proxy.ts` when `!KEYCLOAK_URL` → **bypass** (current) but log `"auth: degraded (no KEYCLOAK_URL, dev-only)"`.
  - `reports/[id] PATCH sign` `roles.length===0 → allow` **kept only in dev** (behind `NODE_ENV` check).
- **`production` (`NODE_ENV=production` or `GERALDOS_ENV=production`):**
  - `!KEYCLOAK_URL` → **boot fails** (`throw new Error("KEYCLOAK_URL required in production")` at `validateEnv()` **[NEW]**). No degraded mode.
  - `api/auth/dev` returns `403 dev_auth_disabled` (current but gated by `NODE_ENV`).
  - `AUTH_SECRET` fallback throw if not 32+ bytes.
  - `cookies: { secure: true, __Host- }`, HSTS header, no CORS `*` in production (replace with `NEXT_PUBLIC_APP_URL` allowlist).

#### PHI exposure & browser security

- Never send `patients.mrn` in URLs as PII path? Acceptable as business key via query param in context fetch; never in HTML `title`. Ensure `Cache-Control: no-store` on workstation/API responses, `Content-Security-Policy` frame-ancestors restrict iframe source, `X-Content-Type-Options: nosniff`.

#### Audit logging

- Every `decision.proposed|approved|executed`, `report.*`, `workflow.transition`, `ai.review_generated|observation_reviewed`, `study.opened|assigned` → `audit_log{userId=sub, action, module, entityType, entityId, details{roles, latency, modelVersion}, ipAddress=x-forwarded-for}` **[EXISTS — extend to stamp `jti` + `correlationId`]**. Insert-only; no `PUT/DELETE /api/audit`.

---

## 16. MULTI-TENANCY / ORGANIZATIONAL MODEL

### Current **[EXISTS — single-org with branches]**

Tables: `branches{id,name,code unique,address,phone,manager,status}`, `employee_records{staffId FK,employeeNumber unique,department,employmentType,branchId FK, salary, dates}`, `staff`, `equipment{location}`, `system_settings`, `roles`. No `organizations` table. App does not scope `patients/appointments/studies/invoices` by `branchId`; they are global. `employee_records.branchId` is the only branch link.

### Tenancy decision

**Tenant model for GeraldOS 1.0: single organisation, multiple branches/facilities.**

```
Organization (implied: "Gerald Holdings")  [NOT A TABLE — config in system_settings {orgName}]
     │
   Branches / Facilities  (branches)  — one row per physical site  [EXISTS]
     │
  ┌──┼─────────────┐
  │               │
 Departments   Users / Roles  (employee_records.department + branches + roles)
  │               │
  Equipment    Patients / Appointments / Studies / Invoices / Inventory
  (location)
```

- **Do NOT introduce `organizations` table yet.** Reasons: (a) Postgres schema is stable, (b) single customer is Gerald Holdings group, (c) branches already capture facilities, (d) multi-org would require row-level tenant column on every table + RLSP/infrequent joins + rare benefit — see below.
- **Do add branch scoping gradually** without breaking: add `workflow_studies.branchId varchar(branches.id) [NEW nullable]` and `appointments.branchId?` (derived from `equipment.location` / scheduling page `branchId` param), plus `invoices.branchId` exists **[EXISTS]** — then scope Command Centre tiles by `branchId` filter when UI asks. Don't retroactively backfill with a destructive migration.
- **When to add organisations:** if GeraldOS is offered as SaaS to external hospital groups — then introduce `organizations{id,name,slug,plan,status}` + migrate `branches.organizationId` + tenant column on PHI tables — a cross-cutting migration to schedule only upon commercial commitment. Keep that design doc ready, not built.

**Ownership:** Back-office settings under `src/app/administration/page.tsx` + `api/{branches,employees,roles,settings/system}` — no immediate multi-tenant rewrite.

---

## 17. OBSERVABILITY

### Current **[SCAFFOLD — integration health real; rest minimal]**

- `GET /api/health` + `GET /api/integrations/status` (per-service connected/unreachable/not_configured + latencyMs + detail; DB `SELECT 1` + 9 probes via `checkAllIntegrations()`) polled every 30s on dashboard **[EXISTS]**.
- Event counts via `GET /api/events?limit=` / `/api/analytics` (real aggregates) **[EXISTS]**.
- No structured app logs beyond `console.error` on audit/event_log write fail, no Prometheus, no trace.

### Target — visible in **Operations Command Centre** `src/app/page.tsx`

| Signal | Source | Command Centre tile / alert |
|---|---|---|
| **Application logs** | `pino` structured JSON (level, req id, route, latency, error) sidecar → stdout (picked up by Docker logs/ELK) | Log search link (future). For MVP, server console + `/api/analytics` error rate |
| **Integration health** | `GET /api/integrations/status` (10 services) | Health grid (red/amber/green) with latency sparklines, already on dashboard — add `ORTHANC/OHIF/FHIR/REDIS/MINIO/LangGraph/n8n/Dicoogle` row + last-checked |
| **Request latency** | Middleware `X-Response-Time` + `audit_log.ipAddress` + `event_log.occurredAt` | `p95` per API group on analytics card |
| **Failed DICOM transfers** | Orthanc `Changes` + reconciler `reconcile_failed` event + `/api/orthanc/studies` error surges | Banner `DICOM transfer degraded (Orthanc unreachable)` + event alert |
| **Failed inference jobs** | `inference:5005` `/health` + `InferenceProvider.healthCheck()` + `ai.review_failed` event | AI queue card: `pending inference jobs 3 — latency 2.4s` |
| **Failed events** | `consumer.dead_letter` count + Redis `XPENDING len` | Event reliability row: `dead letters 0 · lag 0s` |
| **Agent failures** | `decision.status=failed` count + `POST /api/agents/chat` 5xx | Agent panel `Quality: 2 failed decisions` |
| **Workflow bottlenecks** | `workflowStudies` stage histogram + TAT `now - createdAt` per stage | Board `review backlog 42 — TAT p95 18h` |
| **Report turnaround time** | `reports{createdAt→signedAt}` | `median TAT 6.2h` on analytics |
| **AI processing time** | `ai_observations{createdAt}` − `publishEvent{ai.review_completed}.payload.inferenceAt` | `median inference 1.1s` |
| **Orthanc / DB / Redis health** | `integration status` + `db.execute(SELECT 1)` error rate | Health row with detail; Redis `PING` already probes |

**Minimal for now:** keep `GET /api/health` + `GET /api/integrations/status`; add `GET /api/orthanc/health` probe in `integrations/status` (already via `orthanc/system`); add `/api/inference/health` (new).

---

## 18. FAILURE & RECOVERY ARCHITECTURE (per external dependency)

| Dep | Timeout | Retry | Fallback / Degraded | User notification | Audit | Recovery |
|---|---|---|---|---|---|---|
| **Orthanc** | `timedFetch 8s` (`/studies?expand`), `15s` proxy, `60s` DICOMweb proxy | Reconciler `3× 250ms/1s/5s` then `reconcile_failed` + advance cursor; DICOMweb proxy `502` → retry button in viewer | Worklist shows DB; viewer shows `Orthanc unreachable — try again` + local thumbnail strip hidden; upload queue retained in browser (no auto drop) | Toast + banner + dashboard `unreachable` | `audit:study.reconcile_failed` + `event: consumer.dead_letter` | Reconciler backoff 1→30s; recovered `since` catches up replay |
| **OHIF** | `3.5s` health, viewer load `10s` fallback→ready if no message | Iframe `onError` → `ohifStatus=error` + `Refresh` button + external-tab fallback link | GeraldOS thumbnail strip + series panel remain; report/AI/annotations still usable | Viewer error card `OHIF unreachable — open externally` | — | `checkAllIntegrations ohif:unreachable`; no retry of image load until study change |
| **Keycloak** | `3.5s` `/.well-known`, `3.5s` `token_endpoint` | Login/callback `3×` on JWKS fetch failure (network) | **Dev only:** degraded dev-auth (see §15). **Prod:** boot fails if `KEYCLOAK_URL` unset → operator must fix; session remains valid 8h if IdP transient | Login spinner + `Auth service unreachable — contacting IdP` | `audit:auth.login_failed` | JWKS cache (5m) survives transient; back-channel logout re-tried async |
| **HAPI FHIR** | `6s` workstation labs (`/Observation?subject…`) | labs best-effort one-shot (no retry; non-critical) | `fhirLabSummary=null` (panel shows `No/labs unavailable`) | No banner — just panel `FHIR not configured / unreachable if FHIR_URL set` | — | Next study open retries FHIR naturally |
| **Redis** | `ioredis connectTimeout 2s`, `maxRetriesPerRequest:1`, lazy | `getRedis()` backoff `30s` after `redisFailedAt` | Every `publishEvent` still `INSERT event_log` (durable). Consumers fall back to polling `GET /api/events`. No dropped event. | Silent (logged `event_log write failed` if PG also down) | — (but `event_log` is durable) | Consumer group auto-reconnect when Redis returns |
| **MinIO** | `3.5s` health probe, S3 SigV4 presign 30s | `status`/`presign` retries 1×; S3 PUT is client→MinIO directly (no GeraldOS retry) | Object upload fails → UI toast + retry presign | Toast `Storage unavailable — retry` | — | Bucket auto-create on `status` success |
| **LangGraph** | `5s` thread/run | `/api/agents/chat → fallback handleAgentRequest(snapshot)` | Fallback **always answers** from live PG state (snapshot + token-ranked knowledge) | Panel shows `AI runtime unreachable — using local advisory` (optional) | `audit:agent.fallback` | Re-attempt threads on next message |
| **n8n** | `3s` trigger, `10s` healthz | `POST /api/n8n/trigger` retries 1×; webhook inbound not retried | Clinical path never depends on n8n; n8n is observer/automation only | None for clinical; automation dashboard `unreachable` | `audit:webhook.n8n_received` | Replay via `POST /api/events` manual type when n8n recovers |
| **AI Inference** | `InferenceProvider` server fetch `30s` (WADO frame) + `20s` model | `ai-review POST` retries once on model timeout; final failure inserts `ai_observations{category:technical, status:"pending", description:"Inference failed — retry"}` or `event:ai.review_failed` | Workstation shows `AI review unavailable — run again`; reporting assist still works (heuristic) | Toast + panel `Inference service unreachable` | `audit:ai.review_failed{modelVersion, latency}` | Retry button idempotent (dedup on study+model, see §11) |

**Rule:** GeraldOS **never silently loses workflow state**: every failure that could lose a transition is audited + event + notification, retried, and reconciled via `since` cursor or `event_log` replay.

---

## 19. IMPLEMENTATION PHASES

> Each phase names its **owner agent(s)** (from §20), **files**, **DB changes**, **API contracts**, **external integrations**, **tests**, **acceptance criteria** and **risks**. Phases are sequenced by dependency — each completes before the next is integration-blocked.

### Phase 0 — Foundation / Safety  [Owner: Agent J + A]  — 1 week

- **Objectives:** close production security hole, define env contract, lock file ownership, add provider abstraction seam (no behaviour change).
- **Files:** `src/proxy.ts` (gate `NODE_ENV` + `secure` cookie), `src/lib/auth/{session,requireRole}.ts`, `src/app/api/auth/dev/route.ts` (prod gate), `.env.example` (clarify dev-only), new `src/lib/env.ts validateEnv()` **[NEW]**, `src/lib/inference/provider.ts` + `registry.ts` seam **[NEW]** (just the interface, Mock still delegates to `generateCandidates`).
- **DB:** Add `system_settings` row `{key:"env", value:{nodeEnv}}` (optional).
- **API:** No new routes; middleware behaviour changes only in prod. Add `GET /api/integrations/status` latency for new `inference` health (mock at this phase).
- **External:** none.
- **Tests:** Unit `proxy:dev-bypass gated` + `requireRole(radiologist)` + `InferenceProvider Mock contract` (`ai-review` suite keeps passing).
- **Acceptance:** `NODE_ENV=production && KEYCLOAK_URL unset → boot fails`, `api/auth/dev → 403` in prod; `MockProvider` passes `generateCandidates` backwards-compat test.
- **Risks:** Gate mistakenly blocks dev — mitigate with `GERALDOS_ENV` override documented.
- **Dependency for:** everything.

### Phase 1 — Imaging Infrastructure Integration  [A + C]  — 1 week

- **Objectives:** OHIF config live, DICOMweb proxy verified E2E, Orthanc PG plugin ambiguity resolved, upload reconciled.
- **Files:** `docker-compose.yml:ohif volumes`, `ohif-config/app-config.js` parametrised (`NEXT_PUBLIC_DICOMWEB_BASE`), `src/app/api/orthanc/dicom-web/[...path]/route.ts` (verified `OPTIONS` CORS, `60s` timeout already), `docker/orthanc/orthanc.json` (resolve `AuthenticationEnabled` to env authority, doc plugin path; add `TODO` if PG plugin missing — keep filesystem mode for now).
- **DB:** none (add `ux_workflow_studies_study_uid` prep if not in Phase 2).
- **API:** No new routes; existing DICOMweb QIDO/WADO/STOW proven via curl + iframe E2E.
- **External:** Orthanc + OHIF.
- **Tests:** Contract `GET /api/orthanc/dicom-web/studies?StudyInstanceUID=…` via mock Orthanc; integration `iframe src contains StudyInstanceUIDs & loads`; `docker compose config` mounts app-config.
- **Acceptance:** `curl localhost:3001/app-config.js` contains `/api/orthanc/dicom-web`; selecting a worklist study renders Orthanc DICOM frames in OHIF iframe (manual verification + screenshot in PR) OR, when no Orthanc running, clear error with retry button.
- **Risks:** `ohif/app:latest` image drift — pin to SHA once proven.
- **Depends on:** Phase 0.

### Phase 2 — PACS ↔ Worklist Reconciliation  [C + B]  — 1.5 weeks

- **Objectives:** new Orthanc study (whether modality STOW or manual upload) appears in worklist without human intervention, idempotently.
- **Files:** new `src/lib/orthanc-reconciler.ts` + `src/app/api/orthanc/reconcile/route.ts` (`GET /changes?since=&limit=100`, cursor in Redis/PG, match logic PatientID→`patients.mrn`, accession, StudyUID, IoT) or `services/reconciler.mjs` sidecar; `src/app/api/orthanc/studies/route.ts` stays for reads.
- **DB:** Migration `CREATE UNIQUE INDEX ux_workflow_studies_study_uid ON workflow_studies(study_instance_uid) WHERE study_instance_uid IS NOT NULL` + `ADD COLUMN branchId?` optional + cursor storage in `system_settings(key=orthanc_since)` if not using Redis.
- **API:** `POST /api/orthanc/reconcile {cursor?}` (manual trigger + polling schedule), `POST /api/webhooks/orthanc-stable` (optional Lua fast-path) **[NEW optional]**.
- **External:** Orthanc `Changes API`; optional Lua `docker/orthanc/orthanc.lua`.
- **Tests:** Integration `Orthanc changes → new study → worklist entry` (mock Orthanc with `/changes` + `/studies/{id}?expand`); idempotency `same Change replay → no duplicate`; incompleteness `IsStable false → not yet sent_to_orthanc`.
- **Acceptance:** `STOW sample dicom-samples/XR001_001.dcm → within poll interval row in GET /api/worklist (studyInstanceUid matches)`, duplicate STOW → no duplicate row.
- **Risks:** Cursor persistence losing track → full rescan `since=0` recovery path documented.
- **Depends on:** Phase 1.

### Phase 3 — Clinical Workstation (view/HP/comparison, annotation bridge)  [D + E]  — 2 weeks

- **Objectives:** workstation becomes the daily radiologist workplace: OHIF-native HP, prior comparison scroll-sync, measurement bridge.
- **Files:** `src/components/workstation/{viewer-panel.tsx,clinical-panel.tsx,ai-review-overlay.tsx,workstation-context.tsx}`, `ohif-config/app-config.js` (HP mirror), `src/lib/hanging-protocols.ts` (mirror OHIF protocol IDs), new `src/lib/annotation-bridge.ts` **[NEW]** `postMessage ←→ POST /api/annotations`.
- **DB:** `ai_observations` extended columns per §11 (series/sop/frame, uncertainty, segmentationRef, provenance) via migration; `study_annotations.data` shape documentation.
- **API:** Existing `GET /api/annotations?studyId=` / `POST /api/annotations` (real but extended payload); `GET /api/workstation/context` (extended with series metadata if needed).
- **External:** OHIF `@ohif/extension-measurementTracking` + `cornerstoneTools`; Orthanc WADO for frames.
- **Tests:** UI `viewer-panel: comparisonMode toggles dual-UID URL`; Integration `measurement added in OHIF → POST /api/annotations → GET after reload`; HP `defaultProtocolFor(modality,procedure) → correct grid`.
- **Acceptance:** Prior comparison in one OHIF iframe with two studies, HP grid drives layout, measurement tool click in OHIF creates persisted annotation that survives reload and shows in clinical panel.
- **Risks:** OHIF extension wiring is fiddly — ship Phase 3 as two PRs (HP+comparison, then annotation bridge).
- **Depends on:** Phase 1 + 2.

### Phase 4 — Reporting (sign→release guard completeness, SR optional)  [E + B]  — 1 week

- **Objectives:** reporting is audit-clean and legally defensible; voice dictation seam.
- **Files:** `src/app/reporting/page.tsx`, `src/components/workstation/report-editor.tsx`, `src/lib/reporting.ts` (prepareDraft + scoreReport + drift), `src/app/api/reports/{route,[id],assist,templates,versions}/route.ts` (enhance `PATCH` dedup via Idempotency-Key).
- **DB:** `report_versions` already real; add index on `reportId,version`; add `reports.releasedAt? [NEW nullable]` + `branchId?` if multi-site.
- **API:** `PATCH /api/reports/[id]` enhancement (idempotent `If-Match`/Idempotency-Key → single version); optional `POST /api/orthanc/storage-commitment` on release (DICOM-SEG/SR export) **[NEW optional]**.
- **External:** none (FHIR `DocumentReference` export optional).
- **Tests:** Unit `scoreReport` + `prepareDraft` (already 4 suites) + workflow `draft → sign (require approvedBy) → released (require signed) → archived` integration.
- **Acceptance:** `report signed → report_signed event + workflow.stage=signed guard passes; release without signed → 400`. No auto-finalise path.
- **Depends on:** Phase 0 (role gate).

### Phase 5 — AI Inference Boundary  [F + B]  — 1 week

- **Objectives:** `InferenceProvider` abstraction real; mock still passes but `HttpInferenceProvider` can talk to sidecar; GeraldOS no longer knows model details.
- **Files:** `src/lib/inference/{provider.ts,registry.ts,providers/mock.ts,providers/http.ts}` **[NEW]**, `services/inference/` (FastAPI `POST /analyze`, `GET /health`, window/MONAI transform stub) **[NEW]** (keep very small — even a placeholder sidecar that returns synthetic bboxes based on Orthanc studies proves the seam), `docker-compose.yml:inference`.
- **DB:** ai_observations extended columns (migration covers both Phases 3+5 — single migration to avoid churn).
- **API:** `GET /api/inference/health`, `GET /api/ai-review?studyId=` (unchanged), `POST /api/ai-review` now calls `getProvider().analyzeStudy(input)` rather than `generateCandidates` directly (seam introduced, mock still returns same shape).
- **External:** Python inference sidecar.
- **Tests:** Contract `MockProvider.analyzeStudy(studyUid) → observations[≥2] with confidence∈[0,100]`; integration `HttpProvider health → 200`.
- **Acceptance:** `INFERENCE_MODE=mock → same 3 candidates as before`; `INFERENCE_MODE=http` with sidecar running → inference hits sidecar and observations appear with same DB shape but derived from sidecar payload.
- **Depends on:** Phase 2.

### Phase 6 — AI Review (governance + overlay in canvas)  [F + D]  — 1.5 weeks

- **Objectives:** candidate→review→accept/reject→overlay inside OHIF is real, auditable and provenance-complete.
- **Files:** `src/lib/ai-review.ts` now only exports `TECHNICAL_CHECKS, assessTechnicalQuality` (keep); generateCandidates path deprecated in favour of provider; `src/app/api/ai-review/{route,[id]}/route.ts` (invoke provider, handle `status:modified`), `src/components/workstation/ai-review-overlay.tsx` deprecated vs OHIF canvas overlays (bridge alike to annotations).
- **DB:** `ai_observations.posture` columns added in Phase 5 sufficient; add `ADD COLUMN modified_reason text` if needed.
- **API:** `PATCH /api/ai-review/[id] {status:accepted|rejected|modified, modifiedDescription?}` → audit + events `ai.observation_accepted|rejected|modified`.
- **External:** OHIF overlay extension, MinIO heatmap/seg refs rendering.
- **Tests:** E2E `POST ai-review (mock) → 3 pending → PATCH one accepted → filtered counts`; overlay visual regression on mock bbox (DOM or canvas snapshot).
- **Acceptance:** AI candidate with `boundingBox {x,y,w,h normalised}` renders as box inside OHIF frame at correct coords; heatmap `s3://…` renders when present; every action audit row appears in `audit_log`.
- **Depends on:** Phase 5 + 3.

### Phase 7 — Agent Runtime  [H + I]  — 1.5 weeks

- **Objectives:** agents move from registry+snapshot-fallback to event-driven LangGraph workers with Decision Engine enforcement.
- **Files:** `services/langgraph_agent.py` (define `geraldos-agent` graph with tools: `searchPatients`, `slotInventory`, etc.), `backend/app/agents/orchestration.py` (if used — prefer Next.js `api/agents/chat` as edge), `src/lib/agents.ts` (add `requiresApproval` per agent), `src/app/agents/page.tsx` (chat now hits LangGraph else fallback is documented).
- **DB:** `ai_recommendations` already; add `agentRuns{threadId,graphId,latency,error}` optional for observability.
- **API:** `POST /api/agents/chat` already calls LangGraph else fallback — add tool routing: `POST /api/decisions` from agent tool-call path, `POST /api/agents/chat/stream` **[NEW optional]** SSE.
- **External:** LangGraph `langgraph-api:latest` + `LANGSMITH_API_KEY` + deployed assistant; Redis for agent memory (optional).
- **Tests:** `POST /api/agents/chat {agentId:"reception",message:"check patient"} → reply` works both with LangGraph unreachable (fallback) and reachable (mock graph test doubles).
- **Acceptance:** Killing LangGraph container does not break chat (fallback still returns `snapshot()`);
  restarting restores threaded runs; no agent can write to `workflowStudies` directly (grep for `db.update` in agents — none).
- **Depends on:** Phase 0 (Decision Engine) + 14-event infra.

### Phase 8 — Event-Driven Automation (+ n8n refinement)  [I + A]  — 1 week

- **Objectives:** Redis streams gain real consumers; n8n automation is reliable and observable; no event lost between PG durability and Redis delivery.
- **Files:** new `services/infra/init-streams.mjs` (creates groups), consumer forwarder `services/n8n-consumer.mjs` **[NEW optional]** (XREADGROUP→POST /api/webhooks/n8n), `src/app/api/events/stream/route.ts` upgraded to prefer Redis `XREAD BLOCK` with PG fallback, `src/lib/events.ts` extended with `correlationId/causationId, idempotencyKey`.
- **DB:** `consumer_offsets?` or `system_settings(redis_since)`; DLQ via `event_log{type:consumer.dead_letter}`.
- **API:** `GET /api/events?afterId=&type=` (already `type,limit`) + `GET /api/integrations/status` now surfaces `pendingEvents, lagMs`.
- **External:** Redis, n8n (install workflows declaratively in `services/n8n-flows/*.json`).
- **Tests:** Consumer integration `publishEvent → consumer receives exactly once → XACK` (Redis Testcontainers or mock); duplicate correlation key → no duplicate `notifications`.
- **Acceptance:** Command Centre shows `pending 0 · lag 0s`; killing Redis then publishing events → `event_log` keeps writes, Redis recovers and consumers catch up; n8n workflows fire on `report.released` with `x-n8n-token` verified.
- **Depends on:** Phase 2.

### Phase 9 — Operations Intelligence  [B + E]  — 1 week

- **Objectives:** Command Centre becomes a genuine ops surface (TAT, bottlenecks, low-stock/reorder proposals, utilisation).
- **Files:** `src/app/page.tsx`, `src/app/api/{command-centre,analytics,workflow}/route.ts`, `src/lib/{command-centre,decision-engine}` (executive trends), `src/app/equipment`, `src/app/inventory`.
- **DB:** indexes `idx_workflow_studies_stage`, `idx_workflow_studies_createdAt`, etc. (migration).
- **API:** `GET /api/analytics` already; extend with `?branchId=&from=&to=`; `GET /api/command-centre` augmented with `tATp95, pendingByStage, lowStock[], offlineEquipment[]`.
- **External:** none.
- **Tests:** Analytics `GET /api/analytics` smoke with seeded data; `report turnaround p95` computed correctly.
- **Depends on:** Phase 2+4.

### Phase 10 — Production Hardening  [J + A + B]  — 1.5 weeks

- **Objectives:** pass Production Gate (§26) before go-live.
- **Files:** hardening of `next.config.ts` headers (CSP, HSTS, `X-Frame-Options` allow OHIF origin), `src/proxy.ts` perf, `drizzle/…` backup/recovery doc, `scripts/start-services.sh` → compose with healthcheck deps, `vitest` + `playwright` suite, secret management (Docker secrets or platform vault).
- **DB:** retention policy `event_log` archival window, `audit_log` immutable, `migrations` ordering (§23) hardened.
- **API:** rate limiting via Redis `INCR` per IP/route (optional), `Retry-After` on 429.
- **External:** all.
- **Tests:** Load `100 studies QIDO` throughput; `orthanc unreachable 5m → recovery`; security `DEV_AUTH in prod → 403`.
- **Acceptance:** gates in §26 all green; runbook in `docs/RUNBOOK.md`.
- **Depends on:** all above.

---

## 20. CODING-AGENT ORCHESTRATION PLAN (non-conflicting work packages)

> Each agent owns a **disjoint file set**. Shared files require **interface-row ownership** (mutually exclusive lines). Cross-agent contracts are HTTP/DB schemas, not function couplings.

| Agent | Codename | Responsibility | May modify (owns) | Must NOT modify | Consumes (contract) | Exposes (contract) | DB ownership | Tests to create | Completion criteria |
|---|---|---|---|---|---|---|---|---|---|
| **A** | **Infra/Compose/Integrations** | Docker stack, health, mounts, env, orthanc config | `docker-compose.yml`, `docker/**`, `ohif-config/**`, `.env.example`, `src/lib/integrations/**`, `src/app/api/health/route.ts`, `src/app/api/integrations/*`, `src/app/api/orthanc/health|plugins/route.ts`, `services/*helper.mjs` not owned by B/C/F | `src/db/schema.ts` (read OK, not owner), `src/lib/workflow.ts`, `src/lib/ai-review.ts` | Orthanc `/system`, OHIF `GET /`, Keycloak `/.well-known`, etc | `GET /api/integrations/status`, `GET /api/health`, `publicClientConfig()` | none (owns no tables) | `integrations.status returns connected/unreachable/not_configured for 9 probes` + `compose config volume mount check` | OHIF config reachable at `:3001/app-config.js` and DICOMweb via `/api/orthanc/dicom-web` returns `200` |
| **B** | **Database / Domain Model** | Canonical schema, migrations, constraints, indexes, seeds | `src/db/schema.ts`, `src/db/**`, `drizzle/**`, `src/lib/seed-new-modules.ts`, `src/app/api/seed/route.ts` | `src/app/api/*` handlers other than seed (read OK) | — | `Drizzle schema (tables, indexes, constraints)`, seed payload | **`owns all tables`** — every table's definition + constraints + indexes | `migration dry-run (db:push) idempotent`, seed `workflowStudies` count after poll | All migrations in §11 applied, `ux_workflow_studies_study_uid` unique enforced, `ai_observations` extended columns live, no handler broke |
| **C** | **PACS ↔ Worklist Sync (Reconciler)** | Orthanc Changes ↔ worklist bridge, dedup, patient match | `src/lib/orthanc-reconciler.ts` **[NEW]**, `src/app/api/orthanc/{reconcile,webhooks/orthanc-stable}/route.ts` **[NEW]**, `services/reconciler.mjs` **[NEW]**, `docker/orthanc/orthanc.lua` **[NEW optional]** | `src/components/workstation/*` (read only) | `Orthanc GET /changes`, `GET /studies/{id}?expand`, `POST /api/workflow`, `GET /api/patients` | `POST /api/orthanc/reconcile`, `POST /api/webhooks/orthanc-stable`, cursor contract (`since`) | **writes** `workflowStudies`, `patients` (stub on miss) — coordinates with B's schema but C owns reconciler logic | `STOW→worklist within poll`, `duplicate Change no duplicate row`, `PatientID mismatch creates stub` | Sample DICOM dropped in Orthanc appears in `GET /api/worklist` with correct `studyInstanceUid` without human action |
| **D** | **OHIF Integration (viewer chrome)** | Iframe lifecycle, HP mirror, comparison URL, overlay canvas bridge (outside-in) | `src/components/workstation/viewer-panel.tsx`, `src/components/workstation/ai-review-overlay.tsx` (deprecated path), `src/lib/hanging-protocols.ts`, `ohif-config/app-config.js` *contents* (shared with A for mount) | `src/app/api/ai-review/*` (read only), `src/lib/ai-review.ts` | `GET /api/workstation/context` (priors), `GET /api/annotations?studyId=` | `buildOhifUrl`, viewer `postMessage` contract | none | `prior picker builds StudyInstanceUIDs=uid,prior` + `message handler origin-check` + `HangingProtocol custom persist` | Two-study OHIF view via `StudyInstanceUIDs=cur,prior` works; HP selection persists |
| **E** | **Clinical Workstation (4 panels)** | `WorkstationProvider`, panels, command palette, keyboard, fullscreen, report AI | `src/app/workstation/page.tsx`, `src/components/workstation/{workstation-context.tsx,worklist-panel.tsx,clinical-panel.tsx,activity-panel.tsx,report-editor.tsx,workstation-command-palette.tsx,context-menu.tsx}`, `src/app/api/workstation/context/route.ts`, `src/app/api/reports/assist/route.ts` linkage, `src/app/api/worklist/**` reads | `src/app/api/orthanc/dicom-web/**`, `src/lib/decision-engine.ts` | `GET /api/worklist`, `GET /api/orthanc/studies` (aux), `POST /api/reports`, `POST /api/reports/assist`, `POST /api/workstation/context` | Workstation state contract (`selected:WorklistEntry`, `studyDetail: orthanc enriched`) | **writes** `study_annotations`, `study_bookmarks` via `/api/annotations` (but owned by E) | `openStudy transitions assigned→opened`, `reportEditor creates draft → sign requires approvedBy 400`, `command palette actions` | Radiologist can: select worklist → see context+priors → invoke OHIF → run AI tab → measure → dictate (seam) → assist → sign → release (see MVP) |
| **F** | **AI Inference Service** | Provider abstraction, mock + HTTP adapter, Python sidecar seam | `src/lib/inference/**` **[NEW]**, `src/lib/ai-review.ts` (only keep `TECHNICAL_CHECKS/assessTechnicalQuality`; delete `generateCandidates` body to `providers/mock.ts`), `services/inference/**` **[NEW]**, `docker-compose.yml:inference` | `src/app/api/ai-review/[id]/route.ts` patch semantics (but F may call provider inside `api/ai-review/route.ts` POST — interface row: F mutates `analyzeStudy` call, E/G own UI review) | Orthanc `WADO /frames`, MinIO heatmap upload | `InferenceProvider` interface (`analyzeStudy/Series/Instance`, `healthCheck`, `getCapabilities`) | **no DB ownership** — writes are via `api/ai-review` proxy, not direct | `MockProvider cap set = X-Ray/CT/MRI equal to generateCandidates`; `HttpProvider healthCheck 200` | `INFERENCE_MODE=mock` yields same 3 candidates; `=http` with sidecar yields real-shaped `ModelInference` → same `ai_observations` rows |
| **G** | **AI Review (governance)** | Candidate persistence, accept/reject/modify, confidence/uncertainty, audit | `src/app/api/ai-review/{route,[id]}/route.ts`, `src/components/workstation/ai-review-overlay.tsx` (future canvas bridge) shim, `src/lib/ai-review.ts` keep audit parts | `src/lib/inference/providers/**` (not G) | `InferenceProvider.analyzeStudy(..)` result, `GET /api/annotations` for mask ref | `POST /api/ai-review {studyId,modality}` → `ai_observations[]`, `PATCH /api/ai-review/[id] {accepted|rejected|modified}` | **writes** `ai_observations` (G is table owner for rows, but F produces payload) | `pending→accepted transitions publish ai.observation_accepted`, `confidence band rendering`, `boundingBox normalised round-trip` | AI Review tab + overlay + decision audit loop complete with provenance fields per §11 |
| **H** | **Agent Runtime** | 9 agents, LangGraph graph, fallback, tools calling Decisions | `services/langgraph_agent.py`, `backend/app/agents/orchestration.py` (if brought into compose), `src/lib/agents.ts`, `src/app/api/agents/chat/route.ts`, `src/app/agents/page.tsx` | `src/lib/decision-engine.ts` (read only), `src/app/api/decisions/*` (read) | `POST /api/decisions` (to propose), PG `snapshot()` | `POST /api/agents/chat {agentId,message} → reply {text,sources}` (+ optional stream) | **no DB writes** — proposes `ai_recommendations` via `ai_recommendations` table through `decisions` API only | `chat fallback works when LangGraph down` + `tool call → ai_recommendations row created with agent id` | No agent `db.update(workflowStudies)` remains (grep proof); `langgraph` `ok` when `LANGSMITH_API_KEY` set, fallback otherwise |
| **I** | **Event Infrastructure** | Stream groups, consumers, DLQ, SSE, notification dispatch | `src/lib/events.ts`, `src/app/api/events/{route,stream}/route.ts`, `src/app/api/notifications/route.ts`, `src/app/api/webhooks/n8n/route.ts`, `services/infra/**` **[NEW]** | `src/lib/agents.ts` event declarations (read) | `publishEvent` from all producers | `GET /api/events?type=&limit=&afterId=`, `GET /api/events/stream` (SSE), Redis `XREADGROUP` groups | **writes** `event_log`, `notifications` | `publish→ XADD + PG insert` + `consumer XREADGROUP → XACK exactly once` mock | Pending graph `0`, SSE emits within 2s of publish, dead-letter on forced handler error |
| **J** | **Security / Testing** | Auth hardening, RBAC, secret management, test pyramid, CI | `src/proxy.ts`, `src/lib/auth/**`, `src/app/api/auth/**`, `vitest.config.ts`, `__tests__/**`, `playwright/**` **[NEW]**, `next.config.ts` security headers | `src/lib/inference/**`, `services/inference/**` | Keycloak `/.well-known`, session JWT | `auth gate + requireRole helper` | none (owns no tables) | `DEV_AUTH in prod → 403`, `sign without radiologist → 403`, `orthanc secrets never in publicClientConfig`, security regression + workflow e2e | Production Gate (§26) checklist: auth+authorization+DICOM+sign+audit+events sections pass |

**Cross-agent safety:** no two agents touch the same `src/app/api/*` Route Handler file as owner — interface rows are exclusive (e.g. F touches `api/ai-review/route.ts:POST` `provider` call, G touches `api/ai-review/[id]/route.ts:PATCH` status update; merge policy requires both approvers when touching same Route Handler).

---

## 21. FILE OWNERSHIP MATRIX

| Path / Module | Owner Agent | Read (all) | Modify (owner) | Interface contract |
|---|---|---|---|---|
| `docker-compose.yml` | A (infra) | all | A (with B for `inference:` stanza) | Service ports/env per §10; OHIF volume mount row owned by A |
| `ohif-config/app-config.js` | A (mount) + D (contents) | all | A mounts line; D authors `window.config` | `dataSources[0].configuration.{qidoRoot,wadoRoot,wadoUriRoot,stowRoot}` |
| `docker/orthanc/**` | A (+ C for `orthanc.lua`) | all | A owns JSON; C may add `orthanc.lua` | `DicomWeb.Root=/dicom-web/`, plugin notes |
| `docker/minio, postgres, dikoogle` | A | all | A | bucket `geraldos` |
| `src/db/schema.ts`, `drizzle/**`, `src/app/api/seed/route.ts` | **B** | all | B only | `workflow_studies.patientId`, `ai_observations.series_instance_uid` etc. |
| `src/lib/integrations/**` | A | all | A (minio, orthanc auth) | `integrationConfig`, `orthancAuthHeader()`, `timedFetch` |
| `src/lib/orthanc-reconciler.ts`, `services/reconciler.mjs`, `src/app/api/orthanc/reconcile/**`, `src/app/api/webhooks/orthanc-stable/**` | **C** | all | C | Cursor `since`, match on `PatientID|accession→workflowStudies` |
| `src/lib/hanging-protocols.ts` | D | all | D | `buildProtocols(modality) → HangingProtocol[]` |
| `src/components/workstation/viewer-panel.tsx`, `ai-review-overlay.tsx` | D | all | D (with E for `workstation-context` coordination — `selected`/`studyDetail` read-only to D) | `buildOhifUrl(uid,priorUid)` + `postMessage` types |
| `src/components/workstation/workstation-context.tsx`, `worklist-panel.tsx`, `clinical-panel.tsx`, `activity-panel.tsx`, `report-editor.tsx`, `workstation-command-palette.tsx` + `src/app/workstation/page.tsx` | **E** | all | E | `openStudy(entry)` + context data shape |
| `src/app/api/worklist/**`, `src/app/api/workflow/**`, `src/app/api/workstation/context/**` | E (worklist/workflow) + B (schema) | all | E for handlers, B for schema; interface: E never renames `workflow_studies` columns | worklist `entries[]`, workflow `transitionStudy` side-effects |
| `src/app/api/annotations/**`, `src/app/api/bookmarks/**` | E | all | E | `tool+data jsonb` contract |
| `src/lib/inference/**`, `services/inference/**`, `docker-compose.yml:inference:` | **F** | all | F | `InferenceProvider` |
| `src/lib/ai-review.ts` | F (providers) + G (review) | all | F owns `MockProvider` section (`generateCandidates` migrated), G owns review lifecycle constants (`TECHNICAL_CHECKS`) | `assessTechnicalQuality(modality)` |
| `src/app/api/ai-review/**`, `src/app/api/ai-review/[id]/**` | **G** | all | G (F touches POST provider call only — interface row) | `studyId|orthancStudyId + modality → observations[]` |
| `src/lib/agents.ts`, `src/app/api/agents/chat/**`, `src/app/agents/**`, `services/langgraph_agent.py`, `backend/app/agents/**` | **H** | all | H | `POST /api/agents/chat {agentId,message}` |
| `src/lib/decision-engine.ts`, `src/app/api/decisions/**` | J (rules) writes, H/E read/propose | all | J owns `RULES/evaluateRules/proposeDecision`; H/E call `proposeDecision` | Decision status `proposed→validated→approved→executed` |
| `src/lib/events.ts`, `src/app/api/events/**`, `src/app/api/notifications/**`, `src/app/api/webhooks/n8n/**` | **I** | all | I | `EVENT_TYPES`, `publishEvent(...)`, `EVENT_STREAM="geraldos:events"` |
| `src/lib/reporting.ts`, `src/app/reporting/**`, `src/app/api/reports/**` | E (UI) + B (schema) — reporting logic is E, tables are B | all | E for assist/score/report-editor; B for `reports/report_versions/report_templates` schema | `POST /api/reports/assist {studyId,modality,…} → {quality,drift,critical,measurements}` |
| `src/lib/auth/**`, `src/proxy.ts`, `src/app/api/auth/**`, `__tests__/**`, `vitest.config.ts` | **J** | all | J | `verifySessionToken`, `requireRole`, `DEV_AUTH` gate, `SESSION_COOKIE` shape |
| `src/components/ui/**`, `src/lib/utils.ts`, `src/lib/command-centre.ts` | A/E as today | all | A/E (no ownership split needed — shared, low conflict) | — |
| `__tests__/**`, `playwright/**` **[NEW]** | J (owns harness) — domain tests owned by domain agent (e.g. ai-review tests by G, reporting tests by E) | all | Domain agent writes its `lib/**.test.ts`; J writes security/workflow e2e | Coverage gate 70% line on `src/lib/*` |

Where ownership is shared (e.g. `src/app/api/ai-review/route.ts`), **row-level ownership**: `F` may touch `lines: provider call` (2–10), `G` may touch `lines: response + audit + publish`. Shared-file PRs require both owners as reviewers.

---

## 22. API CONTRACT STRATEGY (stable contracts)

> All mutating APIs require `Cookie: geraldos_session=<HS256>` when `KEYCLOAK_URL` set (enforced in `src/proxy.ts`; 401 on `/api/*` otherwise).

### Clinical APIs

| Route | Method | Request | Response | Authz | Side effects / Events | Audit | Errors |
|---|---|---|---|---|---|---|---|
| `POST /api/patients` | POST | `{mrn, firstName, lastName, dateOfBirth, gender, phone?,…}` | `201 {id, mrn}` | `receptionist,admin` | `event: patient.registered` | `audit:patient.registered` | 400 missing field, 409 `mrn unique`, idempotency `Idempotency-Key` returns 201/200 same id |
| `GET /api/patients?q=&mrn=` | GET | query | `{patients[]}` | any authenticated | — | — | 200 even when empty |
| `POST /api/workflow` | POST | `{patientId, modality, procedure, bodyPart?, priority?, appointmentId?}` | `201 {study{id, stage:referral,draft}, stageLabel}` | `receptionist,radiographer,admin` | `referral.received` + `worklist.updated`, `notifications` if `urgent|stat` | `workflow.created` | 400 missing, 409 `Idempotency-Key` |
| `PATCH /api/workflow/[id]` | PATCH | `{action:"transition",to:Stage,…} | {action:"assign",radiologistId}|{priority}|{studyInstanceUid}` | `{study, transitioned:bool, fromStage,toStage}` | see §6 guards; guards skip when `to==from` | `workflow.transition` + `worklist.updated` (+ `notifications`) or `workflow.updated` + `workflow.reassigned` | forward-only else 409, guard `sent_to_orthanc` requires uid 400, `assigned|opened` requires radiologist 400, `signed` requires `reports.status=signed` 400 |
| `GET /api/worklist?view=&q=&modality=&radiologist=&machine=&physician=&location=&priority=&stage=` | GET | query | `{entries[]: WorklistEntry{ id, accessionNumber, studyInstanceUid, modality, procedure, bodyPart, stage, priority, patient*, radiologist*, machine*, physician,… }}` sorted by priority | authenticated | — | — | 200 (no 404) |

### Imaging APIs

| Route | Method | Contract |
|---|---|---|
| `GET /api/orthanc/studies` | GET | `{studies:{orthancId, studyInstanceUid, patientName, patientId, description, accessionNumber, modalities, seriesCount, studyDate}[]}` — merges `GET /studies?expand + GET /series?expand` (modality derivation) |
| `GET /api/orthanc/studies/[id]` | GET | `{study:{ orthancId, studyInstanceUid, series[]:{orthancId, seriesInstanceUid, modality, description, instances[]}}}` enriched |
| `GET /api/orthanc/proxy?p=studies/<id>/…` | GET | Sanitised REST proxy — `p` no leading `/` or `?` — abort `400` else upstream `res.status` + `content-type` |
| `* /api/orthanc/dicom-web/[...path]` | GET/POST/PUT/DELETE | QIDO/WADO/STOW pass-through — sanitised segments → `ORTHANC_URL/dicom-web/${path}${search}`, forward `Accept/CT`, `Basic` auth, binary passthrough, `60s` timeout, `502` on unreachable |
| `POST /api/orthanc/upload` | POST | `multipart/related` or `multipart/form-data` DICOM → Orthanc `POST /instances` (legacy) |
| `POST /api/orthanc/reconcile` **[NEW]** | POST | `{cursor?:string} → {cursor, processed, created, updated, failed[], nextSince}` — manually trigger reconciler sweep |
| `POST /api/webhooks/orthanc-stable` **[NEW optional]** | POST | `{StudyInstanceUID, PatientID, ...}` from Lua — same dedup as reconciler, `audit + worklist.updated` |

### Workflow APIs (already covered above under Clinical — but as governance)

- `GET /api/workflow` → `[{study..., stageLabel}]` ordered `desc createdAt`.
- `GET /api/workflow/[id]` → `{study, stageLabel, nextStages[]}`.

### Reporting APIs

| Route | Contract |
|---|---|
| `GET /api/reports` → `ReportRow[]` | leftJoin patients/radiologists |
| `POST /api/reports {studyId?, patientId, status:"draft", …}` → `201 ReportRow` | insert draft |
| `GET /api/reports/[id]` → `{report + patientFirstName/LastName}` | 404 if missing |
| `PATCH /api/reports/[id] {findings?,impression?,recommendation?,templateName?, status?:"draft"|"pending_review"|"signed", approvedBy?, changedBy?, qualityScore?, aiAssisted?}` → `{report}` | Guards: `status:signed → approvedBy required (400), radiologist role (403)`; snapshot to `reportVersions` before mutate; `report.versioned` + `report.signed|drafted` events; audit. |
| `POST /api/reports/assist {studyId?, reportId?, templateId?, modality?, findings?,impression?, recommendation?}` → `{template, suggestedSections, checklist, bodyPartHints, reminder, quality{score,incompleteSections}, criticalFindings[], terminologyDrift[], measurements[], priorStudies[]}` | Pure decision support — never writes; audit `report.ai_assist` |
| `GET /api/reports/templates` / `POST /api/reports/templates {name,modality,sections,checklist}` | CRUD `report_templates` |
| `GET /api/reports/[id]/versions` **[EXISTS scaffolding, finish]** → `{versions: report_versions[]}` | Insert-only history |

### AI APIs

| Route | Contract |
|---|---|
| `GET /api/ai-review?studyId=&orthancStudyId=&status=&modality=` → `{observations: AiObservation[]}` | order `desc createdAt` |
| `POST /api/ai-review {studyId?, orthancStudyId?, modality, bodyPart?, procedure?}` → `201 {observations: AiObservation[], sources:[modelId@version]}` | Calls `InferenceProvider` (`getProvider().analyzeStudy`) else `MockProvider`; inserts `pending` rows; `publish ai.observation_suggested`, audit `ai.review_generated`; idempotent on `(studyId,modelVersion)` or `Idempotency-Key` |
| `GET /api/ai-review/[id]` → single observation | 404 if absent |
| `PATCH /api/ai-review/[id] {status:"accepted"|"rejected"|"modified"[NEW], reviewedBy?, modifiedDescription?}` → `{observation}` | Sets `reviewedBy/At,status`; audit + `ai.observation_accepted|rejected|modified` |
| `GET /api/inference/health` **[NEW]** → `{ok, latencyMs, detail, capabilities}` | Delegates to `provider.healthCheck()` |
| `POST /api/annotations {studyId?, orthancStudyId?, seriesInstanceUid?, tool, label?, data}` → `201 annotation` | insert `study_annotations`; read via `GET /api/annotations?studyId=&orthancStudyId=` |
| `DELETE /api/annotations/[id]` → 204 | delete own annotation |
| `GET /api/bookmarks` / `POST | DELETE /api/bookmarks/[id]` | user-scoped save |
| `GET /api/workstation/context?studyId=&patientId=&orthancStudyId=&modality=` → `{previousStudies, reports, teachingFiles, fhirLabSummary, similarCases}` | Reads + FHIR best-effort |

### Agent & Decision APIs

| Route | Contract |
|---|---|
| `POST /api/agents/chat {agentId:9, message:string, context?}` → `{reply:string, sources?}` | Try `LangGraph POST /threads/:id/runs/wait` else `handleAgentRequest(snapshot)` |
| `GET /api/decisions?agent=&status=` → `Decision[]` | list |
| `POST /api/decisions {agent,recommendation,rationale?,priority?,targetModule?,targetAction?,targetPayload?}` → `{decision{status:proposed|validated,ruleResults}}` | Evaluate `RULES` server-side |
| `GET /api/decisions/[id]` / `POST /api/decisions/[id]/approve|reject|execute {approvedBy}` → terminal `approved|rejected|executed|failed` | Role + rule checks, audit |

### Event APIs

| Route | Contract |
|---|---|
| `GET /api/events?limit=&type=&afterId=` → `{events:{id, eventType, aggregate, aggregateId, payload, source, occurredAt, correlationId?}[]}` | from `event_log` |
| `POST /api/events {type, aggregate, aggregateId?, payload?, source?}` → `201 {ok:true}` | Validates `type ∈ EVENT_TYPES ∪ custom.*`, `aggregate required`; `publishEvent(type,aggregate,aggregateId,payload,source:manual)` |
| `GET /api/events/stream` → `text/event-stream` `data: {events}` | today `event_log` poll; future Redis `XREAD BLOCK` |
| `GET /api/notifications`, `PATCH /api/notifications/[id] {read:true}` | read/mark |

### Integration APIs

- `GET /api/integrations/status` → `{summary{total,connected,unreachable,notConfigured}, integrations:IntegrationHealth[]}` **[EXISTS]** extend with `inference` probe + `pendingEvents` Redis.
- `GET /api/integrations/client-config` → `publicClientConfig()` (whitelist).
- `GET /api/health` → `{status, version, uptime}`.

### Administration APIs (finish scaffolding)

`GET/POST /api/{branches, employees, roles, equipment, inventory, tariffs, claims, invoices, payments, knowledge, analytics}` — retain current scaffold but treat as back-office **REAL** after B's schema finalisation; `settings/system` `GET/PUT /api/settings/system {key,value}` controls `systemSettings`.

Every API defines **`error: {code, detail}` shape** on non-2xx with stable `code` string for programmatic clients.

---

## 23. DATABASE MIGRATION STRATEGY (Drizzle)

> Current: `drizzle.config.json → src/db/schema.ts`, `drizzle/0000_redundant_the_twelve.sql` as initial push, `package.json: db:push` via `drizzle-kit push` (no `up/down` versioned files beyond `drizzle/meta`). That's **destructive push**, not versioned migrations.

### Target policy

1. **Stop `db:push` in non-dev.** Introduce `drizzle-kit generate` versioned SQL files `drizzle/0001_…sql, 0002_…sql, …` with header `/* GER-XXX — adds ux_workflow_studies_study_uid */`. Checked in, reviewed, applied in CI via `drizzle-kit migrate` (or `npm run db:migrate` new script). `meta/_journal.json` appends entries — current `idx:0` stays as immutable baseline.

2. **Backward compatibility:** Every migration is **expand-only** for at least one release (add nullable columns/indexes/constraints first; code reads both shapes; second migration may make `NOT NULL`/`UNIQUE WHERE NOT NULL` after backfill). No `DROP COLUMN` in a feature PR.

3. **Seed data vs test data:** `src/app/api/seed/route.ts` remains **demo seed** (callable via `POST /api/seed` + `curl` in `README: curl -X POST http://localhost:3000/api/seed`), guarded by `GERALDOS_SEED_ENABLED` in prod (deny). **Test data** is `__tests__/helpers/seed.ts` factory rows inserted per-suite into ephemeral transactions (never via seed route).

4. **Indexes:** Add in Phase 9 migration:
   ```sql
   CREATE INDEX ix_workflow_studies_patient ON workflow_studies(patient_id);
   CREATE INDEX ix_workflow_studies_stage   ON workflow_studies(stage);
   CREATE INDEX ix_workflow_studies_created ON workflow_studies(created_at DESC);
   CREATE UNIQUE INDEX ux_workflow_studies_study_uid ON workflow_studies(study_instance_uid)
     WHERE study_instance_uid IS NOT NULL; -- idempotency for reconciler (Phase 2)
   CREATE INDEX ix_reports_study ON reports(study_id);
   CREATE INDEX ix_report_versions_report ON report_versions(report_id, version);
   CREATE INDEX ix_ai_obs_study ON ai_observations(study_id);
   CREATE INDEX ix_event_log_type ON event_log(event_type);
   CREATE INDEX ix_audit_log_entity ON audit_log(entity_type, entity_id);
   ```

5. **Foreign keys:** Add `FK appointments.patientId → patients.id`, `workflowStudies.patientId`, `reports.studyId`, `report_versions.reportId` etc — already declared in `schema.ts` as `.references`, but verify `0000` emitted `FOREIGN KEY (…) REFERENCES …` (if not, add via migration — Drizzle's `pgTable.references` sometimes does not emit constraints in push mode).

6. **Uniqueness constraints:** `patients.mrn unique` **[EXISTS]**, `workflowStudies.accessionNumber unique` **[EXISTS]**, new `ux_workflow_studies_study_uid` (see above), `branches.code unique`, `employee_records.employee_number unique`, `tariffs.code unique`, `roles.name unique` all already in schema — keep.

7. **Idempotency constraints:** New `ux_ai_obs_dedup(study_id, modality, region, model_id, model_version) WHERE status != 'rejected'` (see §11) for `ai_observations` dedup on provider re-call.

8. **Audit retention:** `audit_log` and `event_log` are insert-only, never purged; add retention view `event_log_partition_yyyy_mm` planning for 12 months online + cold archive to S3 (partitioning doc, not yet built). Command Centre paginates.

9. **Migration ordering:** `0000_redundant_the_twelve` **never edited**. New migrations ordered strictly by `drizzle/meta/_journal.json` `idx` increment; PRs compare that file in CI to detect conflicts (two PRs claiming same idx → rebase).

10. **Pre-apply check:** `npm run typecheck` + `npm run test` must pass before `drizzle-kit migrate` in CI; `next build` verifies API handlers against `schema`.

---

## 24. TEST STRATEGY — PYRAMID

### Pyramid

```
             UI (critical workstation flows — Playwright)
   ───────────────────────────────────────────────────────
               Workflow (end-to-end clinical lifecycle)
   ───────────────────────────────────────────────────────
            Contract (Orthanc/OHIF/FHIR/Keycloak/AI)
   ───────────────────────────────────────────────────────
           Integration (DB + API + external via Testcontainers)
   ───────────────────────────────────────────────────────
                         Unit (domain rules)
```

### Layer definitions

| Layer | Owner | Scope | Tooling |
|---|---|---|---|
| **Unit** | Domain agent per `src/lib/*` | Pure functions: `evaluateRules` (decision-engine), `scoreReport/prepareDraft/terminologyDrift` (reporting), `generateCandidates/assessTechnicalQuality` (ai-review mock), `stageIndex/nextStageOf/isWorkflowStage`, `buildProtocols/defaultProtocolFor` | Already `vitest 4.1.10` + `__tests__/lib/{ai-review,decision-engine,events,reporting}.test.ts` **[EXISTS — 4 suites]** — extend to cover new `InferenceProvider Mock`, `orthanc-reconciler matchPriority`, `requireRole` |
| **Integration** | Workflow/E agents | DB + API under `pg` Testcontainers or docker-compose `postgres:5432`: `POST /api/workflow → GET /api/worklist → PATCH workflow transition → GET …` chain; `POST /api/reports → PATCH sign (403 vs 201)`; `POST api/ai-review → PATCH accept` | `vitest` + `drizzle-orm` test pool + `msw` or real fetch against `next dev` on `127.0.0.1:3000` |
| **Contract** | Infra (A) | `Orthanc /dicom-web/studies?expand` shape, OHIF `app-config.js` parsed, FHIR `Patient` → `patient:mrn`, Keycloak `/.well-known`, MinIO presign sig, n8n webhook | `pact`-style or direct `timedFetch` against mock Orthanc/FHIR/… containers |
| **Workflow (E2E)** | J (E2E owner) | Full `patient → appointment → study → STOW → reconcile → worklist → opened → context → AI (mock) → annotation → report draft → assist → signed → released → archived + audit/event trail` | `playwright` **[NEW]** against running compose + Next.js (seed once, then E2E traverse worklist → viewer iframe assertion → report sign) |
| **Security** | J | `api/auth/dev 403 in prod`, `orthanc creds never in client-config`, `report sign without radiologist 403`, `DEV_AUTH bypass gated`, `webhook token 401` | `vitest` security suite + `zaproxy` optional |
| **AI** | G (ai-review) | `InferenceProvider` contract + `ai_observations` fields + `boundingBox normalised` + `provenance` + human `accept/reject` audit | Unit `MockProvider` + contract `HttpProvider GET /health 200`; no model accuracy testing (out of GeraldOS scope) |
| **UI** | D/E | Workstation: worklist selection updates viewer URL; `viewer-panel` comparison toggle builds `StudyInstanceUIDs=uid,prior`; `report-editor` template selection; `command palette` open | `playwright` (Chromium) headless |

### First tests to exist before further expansion (block feature PRs until green)

1. `unit: decision-engine::evaluateRules` — the 4 rules matrix ( `no_auto_finalise`, `no_autonomous_diagnosis`, `stat_priority_allowed`, `reallocation_requires_equipment_context`) × `proposeDecision` status mapping.
2. `unit: workflow::stageIndex` — forward-only guarantee: `stageIndex("signed") > stageIndex("assigned")` and `isWorkflowStage(unknown)→false`.
3. `integration: api/workflow transition happy-path` — `POST workflowStudies{stage:referral} → PATCH assigned:{radiologistId} → PATCH opened → assert {stage:opened, stageLabel:"Study Opened", event written, audit written}`.
4. `integration: api/reports sign guard` — `POST report draft → PATCH {status:"signed"}` without `approvedBy → 400`; without `radiologist` role (when Keycloak wire) → `403`; with → `200 + audit + event`.
5. `integration: api/ai-review lifecycle` — `POST {studyId, modality:CT} → observations length ≥2, pending → PATCH [0] accepted → {status:accepted, reviewedBy}`.
6. `contract: dicom-web proxy` — `GET /api/orthanc/dicom-web/studies?PatientID=*` forwarded with `Basic` auth and returns passthrough status/content-type.
7. `security: publicClientConfig never leaks` — `GET /api/integrations/client-config → body not containing ORTHANC_PASSWORD|MINIO_SECRET_KEY|KEYCLOAK_CLIENT_SECRET`.
8. `e2e (smoke): worklist → viewer` — `GET /api/worklist?view=all → pick first → openStudy renders viewer-panel with iframe src ~ StudyInstanceUIDs`.
9. `unit: ai inference mock contract` — `MockProvider.analyzeStudy({studyInstanceUid, modality:"CT"}) → {modelId:"geraldos-mock", observations[0].confidence ∈[0,100]}`.

---

## 25. MVP DEFINITION — SMALLEST GENUINELY CREDIBLE PLATFORM

> "More than a UI demo" means the **clinical loop actually runs against real infrastructure** (Orthanc PACS, Postgres, OHIF proxy, Decision Engine, audit), even if AI is mock.

### MVP must demonstrate

```
Patient → appointment → study (DB)
  → DICOM (dicom-samples) → Orthanc (STOW / /instances)        [real via compose]
    → PACS/Worklist reconciliation  [real reconciler, §7]
      → worklist (DB) → radiologist workstation (4-panel)        [real]
        → OHIF iframe (WADO via GeraldOS dicom-web proxy)        [real, mounted]
          → AI decision-support candidates (mock provider ok)    [mock OK for MVP]
            → prior studies + clinical context + FHIR labs       [read-only, real probe; FHIR seed optional]
              → report draft (template) → AI terminology assist  [real, heuristic OK]
                → radiologist approval → report signed (requires roles + approvedBy) [real guard]
                  → release (requires signed) → archived
                    → audit + event trail (every step) + notification + analytics
```

### What must **NOT** remain mocked for MVP

| Component | MVP requirement | Why |
|---|---|---|
| **Patient / appointment / workflowStudies pipeline** | REAL (PG) | Core SOR — mock would hide reconciliation |
| **Orthanc + DICOMweb proxy (+ mount)** | REAL | Without it, imaging chain is demo |
| **PACS→Worklist reconciler** | REAL | The #1 broken link; MVP must close it |
| **OHIF iframe driven by worklist** | REAL (mounted config) | Without it, no image proof |
| **Report lifecycle (draft→sign→release with guards + version + audit)** | REAL | Clinical liability boundary |
| **Decision Engine rule evaluation** | REAL (unit-tested) | Safety cannot be mock for MVP |
| **Event log + Audit log** | REAL | Every transition auditable |

### What **can** remain mocked/degraded for MVP

| Component | MVP posture | Notes |
|---|---|---|
| AI model (`InferenceProvider`) | Mock (`generateCandidates`) behind the `InferenceProvider` seam | Seam built in Phase 0, but sidecar not required for MVP — mock proves contract |
| Heatmaps/segmentation rasters | Empty ref / null bbox is acceptable for MVP | Overlay renders when present, hidden otherwise |
| Hanging protocols inside OHIF | GeraldOS chrome only OK for MVP; OHIF-native HP in Phase 3 | Acceptable degrad |
| Voice dictation | MISSING (no placeholder) | Deferred |
| Real HAPI FHIR Patient resources | FHIR proxy live, fallback `null` labs acceptable | Not MVP-blocking |
| Keycloak realm | Degraded dev-auth acceptable only while documenting *"production requires KEYCLOAK_URL"* — gate must exist per §15 | MVP can demo with `DEV_AUTH` but migration to OIDC must be documented in RUNBOOK |
| n8n workflows | Observer-only | Not MVP-blocking |
| LangGraph deployed graph | Fallback `handleAgentRequest` mock replies acceptable | Seam proven, graph deploy deferred |
| Dicoogle indexing | `not_configured` OK | Search via worklist covers MVP |

---

## 26. PRODUCTION READINESS GATE (all green before go-live)

| Gate | Criterion | Verified by |
|---|---|---|
| **Security — authentication** | `KEYCLOAK_URL` required when `NODE_ENV=production`; `api/auth/dev → 403`; JWKS verify, 8h HMAC session, `secure, httpOnly, sameSite:lax, __Host-` cookie; login→callback→me loop works | J: `prod-env gate test` + manual login via Keycloak |
| **Security — authorization** | Per-route RBAC via `requireRole`; `reports sign` and `workflow signed|released` require `radiologist` (+ `manager|admin` for release); `DEV_AUTH` gated by `NODE_ENV`, fallback secret removed, `roles.length===0` allow removed | J: security suite |
| **Security — secret hygiene** | `publicClientConfig` never returns `ORTHANC_PASSWORD|MINIO_SECRET_KEY|KEYCLOAK_CLIENT_SECRET`; `AUTH_SECRET` 32+ bytes; no defaults in prod compose; SAST scan | J: `client-config leak` test |
| **DICOM reliability** | STOW of `dicom-samples/*` 100/100 succeeds; WADO frame `GET /api/orthanc/dicom-web/…/frames/1` returns `multipart/related` <10s; Orthanc Changes→worklist latency <10s | C: contract + reconciler E2E |
| **Worklist synchronization** | Duplicate STOW never duplicates worklist row (unique studyUID); new `PatientID` match verified (known MRN) → `workflowStudies.patientId` joins; unknown → stub flagged `needs_verification`; cursor survives reboot | C: idempotency + match tests |
| **OHIF end-to-end** | `curl localhost:3001/app-config.js` contains `/api/orthanc/dicom-web`; workstation `selected → iframe src StudyInstanceUIDs` renders frame; prior comparison `StudyInstanceUIDs=cur,prior` renders both; error path shows retry | A+D: E2E `worklist→viewer` |
| **Report integrity** | Every `PATCH reports` with content snapshots `report_versions` (version increment); `report signed` requires `approvedBy`; `release` guard `requires signed`; `released→archived` only forward | E: workflow integration test |
| **Auditability** | Every `workflow transition, decision, report sign, AI generate/accept` has `audit_log` row with `userId,ipAddress,jti,correlationId`; `event_log` row with `payload.occurredAt`; immutable (no API can delete) | J: `audit completeness` suite + `GET /api/events` replay |
| **AI provenance & human oversight** | Every `ai_observations` has `modelId@version + provenance`; UI requires explicit `Accept|Reject` (no auto-diagnosis); `no_autonomous_diagnosis` rule covered; reporting never consumed `ai` without human confirmation | G: ai-review + decision-engine suites |
| **Event reliability** | Dual-write (`XADD best-effort + event_log durable`); consumers `XACK` exactly-once (dedup on correlation key); dead-letter on 5 failures; `GET /api/integrations/status` shows `pendingEvents` | I: consumer idempotency tests |
| **Database integrity** | Migrations are versioned (no push in prod), FK & unique constraints hold, `workflowStages` forward-only enforced, backup (`pg_dump` nightly) & restore tested documented | B: migration ordering + DB constraints |
| **Backup/recovery** | Postgres WAL/nightly dump, MinIO object versioning, Orthanc `StorageDirectory` backup; recovery runbook `docs/RUNBOOK.md` rehearsed | J |
| **Observability** | Command Centre shows `connected/unreachable` for all 9 probes + latencies, `worklist depth by stage`, `report TAT p95`, `inference latency`, `event dead-letters` | I + product: dashboard screenshot in gate review |
| **Performance** | `/api/worklist?view=all` p95 <500ms at 10k `workflowStudies`; DICOMweb QIDO <2s; viewer iframe TTFR <5s (warm) | Load: `k6` or similar |
| **Failure recovery** | Documented for each dep (§18) with `timeout → retry → fallback → notification → audit → reconciliation` and verified by 30-min `orthanc down` chaos drill (stop service, publish 3 STOW, restart — all recovered) | I + C chaos test |

No gate passes with "mocked for MVP" — gates require the **real** component at go-live.

---

## 27. ARCHITECTURAL RISKS (top 20)

| # | Risk | Probability | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | **PACS↔Worklist desync** — study visible in Orthanc but never in worklist | High (today: 100% until reconciler) | **Critical** — clinical work hidden | Hybrid reconciler (§7) with `since` cursor + dedup index, dual-write events, Command Centre `worklist depth` reconciliation metric | C |
| 2 | **DICOM identity error** — `PatientID/MRN` mismatch causes wrong-patient study | Med | Critical | MRN-canonical `patients` SOR; name+DOB fuzzy threshold + `needs_verification` flag; accession cross-check; manual reconciliation UI (future) | C + B |
| 3 | **Anonymised sample DICOM PatientID collision** — synthetic `MRN-****` duplicates | Low | Med | Sample DICOM `PatientID` prefixed `TEST-` and filtered before live-Orthanc sync; live patient MRNs validated against `patients.mrn` before auto-create | C |
| 4 | **OHIF coupling drift** — `ohif/app:latest` breaking API | Med | High | Pin image SHA after proven; mount + bake config; contract test `app-config.js` reply; treat OHIF as DELEGATED (never vendor inside) | A+D |
| 5 | **AI hallucination presented as finding** | High if real model | High | `Decision Engine no_autonomous_diagnosis`, `status:pending` never auto-accept, provenance visible, no execution of diagnosis; acceptance is explicit UI action with audit | G + J |
| 6 | **AI provenance loss / model versioning silent upgrade** | Med | High | Every `ai_observations.modelVersion` + `provenance` hash mandatory; `report_versions.aiAssisted` chain; `GET /api/inference/health` shows `capabilities` | F+G |
| 7 | **Event duplication / double side-effect** | Med | Med | `Idempotency-Key` on POSTs + dedup unique indexes (`study_uid`, `ai dedup`), consumer dedup on `correlationId`, exactly-once `XACK` | I |
| 8 | **Distributed transaction split** — PG write succeeds but Orthanc/reconciler event not yet, or vice versa | Med | Med | No distributed 2PC — use **outbox via `event_log`** (durable first) + reconciler cursor (at-least-once); consumer idempotency makes split replay safe | I+ C |
| 9 | **Monolithic Next.js backend scaling** — all Route Handlers in one process | Med | Med | Keep GeraldOS orchestration-only (no pixel/model) — compute delegated; Next.js scales horizontally behind LB; stateless `event_log` is the lock; add `/api/health` liveness for k8s | A |
| 10 | **Security bypass in degraded dev-auth leaking to prod** | **High** (today: `DEV_AUTH=true` by default, fallback secret) | **Critical** | Phase 0 gates (`NODE_ENV` checks, boot fail, `secure` cookie, leak test, `!approvedBy→400`) | J |
| 11 | ** PHI exposure via DICOMweb proxy or client-config** | Low | Critical | Server-only `Basic` auth + whitelist `publicClientConfig` test + `Cache-Control: no-store` + DICOM de-id in inference sidecar | J |
| 12 | **Database growth** — `event_log`/`audit_log`/`report_versions` unbounded | High | Med | Partition `event_log` by month (plan), retention window to S3, no purge API, indexes per §23 | B |
| 13 | **Agent autonomy creep** — agent proposes→auto-executes without approval | Med | High | Invariant: agents only call `POST /api/decisions`; `evaluateRules` inside `api/decisions` (never client); no `db.update` in `agents.ts` | H + J |
| 14 | **External dependency cascade** — Orthanc/Redis/FHIR down blocks clinical path | Med | High | Per-§18 timeout/retry/fallback; clinical path (worklist→report→sign) never requires n8n/LangGraph/FHIR; Redis optional (PG durable) | I |
| 15 | **Workflow forward-only violated by patch** — client writes arbitrary `stage` | Low | Med | Only `transitionStudy()` path enforces `stageIndex` guard; no direct `db.update(workflowStudies.stage)` outside that function — lint rule or grep CI | E + J |
| 16 | **Report version loss on concurrent edits** | Low | High | `PATCH reports` is serialised per id (no concurrent transaction); `Idempotency-Key` + `updatedAt` check; conflict 409 on stale `version` | E + B |
| 17 | **Orthanc PG plugin vs filesystem storage drift** | Low | Med | Default to filesystem until plugin proven; migration plan documents re-store; never dual-store by accident | A |
| 18 | **Multi-tenancy creep / premature abstraction** | Med | Low | Explicitly defer `organizations` (§16) until commercial requirement; migration doc exists but not built | B |
| 19 | **Over-engineered Series/SOP table** — PG duplicate of Orthanc authority | Low | Med | Keep DICOM level as references (§5); decision note in ARCHITECTURE.md prevents PRs adding `series` table without ADR | B |
| 20 | **Test gap before expansion** — features ship without workflow E2E | High | High | Block §24 first-8 tests gate before Phases 2–6 PRs merge; CI `typecheck + test` mandatory | J |

---

## 28. WHAT WE SHOULD NOT BUILD — DO NOT REINVENT

- **PACS / DICOM storage** — Orthanc. GeraldOS references `StudyInstanceUID`; never pixels.
- **DICOMweb server** — Orthanc `DicomWeb.Root`. GeraldOS proxies, doesn't serve.
- **DICOM WADO/QIDO/STOW engine** — Orthanc handles bytes. No GeraldOS decode.
- **Medical image rendering** — OHIF/Cornerstone. GeraldOS overlays are metadata references.
- **MPR / 3D volume reconstruction** — OHIF/Weasis.
- **Identity provider / RBAC directory** — Keycloak.
- **FHIR server / R4 resource store** — HAPI FHIR.
- **Full-text / DICOM tag search engine** — Dicoogle (when needed). GeraldOS worklist is structured filters, not generic search.
- **Object storage** — MinIO (S3). Presign, not serve.
- **Message broker** — Redis Streams (existing). No bespoke queue.
- **Workflow automation platform** — n8n. GeraldOS calls `trigger`/`webhook`, does not re-implement cron/state machine.
- **Agent framework / graph runtime** — LangGraph. GeraldOS defines agents as **missions+tools**; runtime lives in `langchain/langgraph-api`.
- **Model training / model evaluation / DICOM de-identification research pipeline** — out of scope; GeraldOS consumes inference via `InferenceProvider`.
- **Billing engine re-imagined as ledger** — GeraldOS uses `invoices+line_items+claims` tables (already sufficient) — no new double-entry ledger until finance team requests.
- **Voice dictation renderer** — uses Web Speech / Whisper sidecar via `MediaRecorder` POST; don't build STT from scratch.
- **DICOM SEG / GSPS object authoring** — OHIF extension / Orthanc stores; GeraldOS references.
- **Custom medical terminology NLP NER beyond `terminologyDrift`/`CRITICAL_FINDINGS_TERMS`** — keep heuristic today; delegate to clinical NLP service when funded.
- **A marketing "AI diagnosis" page** — explicitly disallowed; every AI surface must carry *"decision support only, radiologist confirms"*.

---

## 29. FINAL MASTER BLUEPRINT (executive architecture)

### GeraldOS owns

- The **operations, orchestration, intelligence and UX layer**: Worklist, Scheduling, Reception, Workstation orchestration (4-panel), Reporting lifecycle (versioned, audited, signed, released, never autonomous), Decision Engine (rules×validation×human approval), AI **orchestration** (not inference), Agent coordination (9 agents as missions+tools), Knowledge governance (published-only), Equipment/Inventory intelligence, Analytics, Notifications, Event coordination (DL + Redis Streams), Audit/Governance, cross-system Context Assembly, clinical workflow state machine, and the **seams** to every delegated system.

### Orthanc owns

- DICOM storage (C-STORE/`/instances`), Index (per-study `MainDicomTags`, `Series[]`), REST (`/studies`, `/series`, `/instances`, `/system`, `Changes`), DICOMweb (`/dicom-web/QIDO, WADO, STOW`), optional Lua hooks (`OnStableStudy`), MWL (future). GeraldOS calls it server-side with `Basic` auth; never stores pixels.

### OHIF owns

- Web viewer rendering (Cornerstone, tools — Length/Angle/Area, MPR, HP matching, SEG/GSPS/overlay extensions), QIDO/WADO client, `app-config.js` data-source wiring. GeraldOS drives it via `?StudyInstanceUIDs=` and `postMessage`; renders inside `<iframe>`.

### Keycloak owns

- Identity, OIDC Authorization Code, JWKS, `realm_access.roles`, SSO, session SSO propagation. GeraldOS consumes discovery + verifies `id_token` + mints internal HMAC session `geraldos_session` (not issuer).

### HAPI FHIR owns

- `Patient`, `Observation` (labs), `Coverage` (eligibility), `DocumentReference` (optional `report.released` export). GeraldOS proxies R4, maps `mrn ↔ Patient.identifier`, surfaces labs in `workstation/context`.

### LangGraph owns

- Agent graph execution — stateful Threads, tool loops, `assistant_id = geraldos-agent`. GeraldOS defines `services/langgraph_agent.py` graph declarative; falls back to `handleAgentRequest(snapshot)` when runtime unreachable.

### Redis owns

- Volatile transport: `geraldos:events` Stream (MAXLEN ~10k), consumer groups (`geraldos:agent-*`, `geraldos:notifications`, `geraldos:n8n`), optional cache. GeraldOS dual-writes `event_log` (PG) as durable source.

### n8n owns

- Cross-system automation as **observer** (report distribution, HL7/FHIR bridges, SMS). Triggered via `POST /api/n8n/trigger` and inbound `POST /api/webhooks/n8n`; never on clinical critical path.

### AI Inference service owns **[NEW]**

- Image extraction (WADO frame fetch, windowing, resampling, stacking), preprocessing transforms, model execution (MONAI/ONNX/Torch/Clara/vendor), `ModelInference` output, heatmap/seg bytes → MinIO S3; exposes `POST /analyze`, `GET /capabilities`, `GET /health`. GeraldOS consumes via `InferenceProvider` interface, never the weights.

---

## At-a-glance target artefacts

| Artefact | Status |
|---|---|
| **Target architecture (text diagram §3)** | Authoritative — layers + ownership explicit |
| **Canonical domain model (table §4)** | `patients` SOR, `workflowStudies` orchestration Study, Orthanc for Series/Instance — 27 entities specified |
| **DICOM boundary (§5)** | Orthanc is authority; GeraldOS stores `studyInstanceUid (+ seriesInstanceUid per annotation/observation refs)` — no `series` table |
| **Clinical workflow (§6)** | 13 transitions, each with trigger, source, mutation, external, event, notification, audit, permission, failure, retry, idempotency |
| **PACS↔Worklist reconciler (§7)** | **Hybrid A primary (Changes poll `since` cursor, dedup by studyUID, MRN→patient match, accession unique, incomplete & rejections handling, retries, DLQ)**; B optional fast-path, C observer |
| **OHIF integration (§8)** | Mount/bake + same-origin proxy QIDO/WADO/STOW + `StudyInstanceUIDs=uid[,prior]` + HP mirror + measurement/overlay bridge via `postMessage` |
| **AI inference contract (§9)** | `InferenceInput → ModelInference` (confidence, bbox/heatmap/mask, provenance), decision-support-only safety, reproducibility, audit |
| **Model adapter (§10)** | `InferenceProvider {analyzeStudy|Series|Instance, getCapabilities, getModelMetadata, healthCheck}` + `MockProvider` + `HttpInferenceProvider` sidecar seam |
| **AI observation schema (§11)** | `ai_observations + series_instance_uid, sop_instance_uid, frame_number, uncertainty, model_id, segmentation_ref, polygon, evidence, provenance` — minimum extensible |
| **Decision Engine (§12)** | `no_auto_finalise_reports, no_autonomous_diagnosis, stat_priority_allowed, reallocation_requires_equipment_context` + taxonomy that **all** financial/equipment/patient/Knowledge writes require human approval |
| **Agent runtime (§13)** | 9 agents per (mission|inputs|tools|events|memory|actions|approval); all reactive+proposing, 3 conversational, 4 event-driven, 0 executing without Decision |
| **Event architecture (§14)** | Dual-write `event_log (PG durable, PK serial, ordered)` + `Redis Streams geraldos:events (transport, MAXLEN 10k, groups per agent/notif/n8n, XACK, correlationId, retries×5→DLQ)` |
| **Security model (§15)** | OIDC → HS256 `geraldos_session`; per-route `requireRole`; `DEV_AUTH` gated by `NODE_ENV`, prod boot fails when `KEYCLOAK_URL` unset, `secure, httpOnly, sameSite` cookie, service-to-service `Basic/SigV4/ApiKey`, PHI `no-store` |
| **Multi-tenancy (§16)** | **Single organisation, multi-branch via `branches`** — defer `organizations` until SaaS; no tenant column now |
| **Observability (§17)** | Health grid (9 probes+latency), TAT/bottleneck/AI-latency/analytics on Command Centre |
| **Failure & recovery (§18)** | Timeout/retry/fallback/notification/audit/recovery table per dep |
| **Implementation phases (§19)** | `0 Safety → 1 Imaging → 2 Reconciler → 3 Workstation → 4 Reporting → 5 Inference seam → 6 AI Review → 7 Agents → 8 Events → 9 Analytics → 10 Hardening` with owners, files, DB, acceptance, risks |
| **Coding-agent ownership (§20)** | 10 non-conflicting packages A-J + file-ownership matrix (§21) — interface-row coordination prevents simultaneous redesign |
| **API contract strategy (§22)** | Clinical/Imaging/Workflow/Reporting/AI/Agent/Decision/Event/Integration/Admin contracts grouped with request/response/events/audit/error |
| **Migration strategy (§23)** | Versioned `drizzle-kit generate/migrate` (no push in prod), expand-only, unique/idempotency constraints, audit retention |
| **Test strategy (§24)** | Unit → Integration → Contract → Workflow E2E → Security → AI → UI pyramid + 9 must-have first tests |
| **MVP definition (§25)** | Real PACS↔worklist↔OHIF↔report-sign↔audit chain (mock AI OK); must-not-mock vs can-degrade matrix |
| **Production gate (§26)** | 14 gates (security, DICOM, worklist, OHIF, report integrity, audit, AI provenance, events, DB, backup, observability, perf, chaos) |
| **Risks (§27)** | Top 20 with probability/impact/mitigation/owner |
| **Do-not-build list (§28)** | PACS, DICOMweb, renderer, IdP, FHIR server, Dicoogle indexer, MinIO, Redis broker, n8n runtime, LangGraph runtime, model training, … |

---

## ABSOLUTE CONSTRAINTS — GOVERN FUTURE CODING

1. Do not modify code in this phase — this blueprint is **architecture first**.
2. Subsequent phases must preserve the split **"file exists but mis-mounted/isolated/mock" → fix mount/bridge/seam, not recreate**.
3. GeraldOS remains orchestration/intelligence/product — every `DELEGATED` row is enforced by code review.
4. No unnecessary microservice for theatrical reasons — Next.js monolith stays; only the **inference** sidecar is a separate process (because model dependencies and GPU cadence demand it).
5. AI stays human-supervised; every autonomous path passes `Decision Engine` (autostate transitions outside `transitionStudy` are forbidden).
6. Every clinically significant action is `audit_log + event_log` (both).
7. Every integration has `timeout → retry → fallback → notification → audit → reconciliation`.
8. Every async operation has an idempotency key (header or natural unique index).
9. Multiple agents execute via §20+§21 ownership without conflicting — cross-agent files require dual review, contracts are HTTP schemas not shared function imports.

---

*End of GeraldOS Master Implementation & Architecture Blueprint — Phase 2.*
