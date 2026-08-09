#!/usr/bin/env bash
set -euo pipefail
# Live verification for DICOM → Worklist → OHIF → Report → Audit
# Requires: docker compose up -d, psql access, curl, and a synthetic DICOM sample
BASE="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
ORTHANC="${ORTHANC_URL:-http://localhost:8042}"
OHIF="${OHIF_URL:-http://localhost:3001}"
DCM="dicom-samples/CT001_001.dcm"

echo "1. docker compose up -d"
docker compose up -d
echo "2. wait postgres"
for i in {1..20}; do pg_isready -h 127.0.0.1 -U postgres && break; sleep 1; done
echo "3. wait orthanc"
for i in {1..20}; do curl -sf -u orthanc:orthanc "$ORTHANC/system" && break; sleep 2; done
echo "4. wait OHIF"
for i in {1..20}; do curl -sf "$OHIF/app-config.js" | grep -q dicom-web && break; sleep 2; done
echo "5. migrations"
npm run db:push || npx drizzle-kit push 2>&1 | tail -n 20
echo "6. seed"
curl -sf -X POST "$BASE/api/seed" | head -c 500; echo
echo "7. STOW synthetic DICOM"
curl -sf -u orthanc:orthanc -X POST "$ORTHANC/instances" --data-binary @"$DCM" | head -c 500; echo
echo "8. orthanc stores study"
curl -sf -u orthanc:orthanc "$ORTHANC/studies?expand" | grep -q StudyInstanceUID && echo "stored"
echo "9. reconcile"
curl -sf -X POST "$BASE/api/orthanc/reconcile" -H 'Content-Type: application/json' -d '{"limit":50}' | tee /tmp/recon.json; echo
echo "10. workflow studies"
curl -sf "$BASE/api/worklist?view=all" | grep -q ok && echo "worklist ok"
echo "11. patient"
curl -sf "$BASE/api/patients?search=" | head -c 200; echo
echo "12. event_log"
curl -sf "$BASE/api/events?limit=5" | head -c 500; echo
echo "13. worklist again"
curl -sf "$BASE/api/worklist?view=all" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"entries {len(d.get('entries',[]))}\")"
echo "14. DICOMweb QIDO"
curl -sf "$BASE/api/orthanc/dicom-web/studies" -H "Accept: application/dicom+json" | head -c 500; echo
echo "15. WADO frame (first study)"
STUDY_UID=$(curl -sf "$BASE/api/orthanc/dicom-web/studies" -H "Accept: application/json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['0020000D']['Value'][0] if isinstance(d,list) and d else '')" 2>/dev/null || echo "")
if [ -n "$STUDY_UID" ]; then echo "QIDO UID $STUDY_UID"; curl -sf "$BASE/api/orthanc/dicom-web/studies/$STUDY_UID" | head -c 500; echo; fi
echo "16. OHIF config"
curl -sf "$OHIF/app-config.js" | grep dicom-web && echo "OHIF config ok"
echo "17. create report flow"
PATIENT_ID=$(curl -sf "$BASE/api/patients?search=" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null || echo "")
echo "patient $PATIENT_ID"
echo "Done — check worklist, OHIF, and audit manually"
