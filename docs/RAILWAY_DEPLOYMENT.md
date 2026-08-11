# Railway Deployment
Services: GeraldOS (public), PostgreSQL (private), Redis (private), Orthanc (private), OHIF (public).
Orthanc persistent volume: /var/lib/orthanc/db.
Migration: npm run db:migrate.
Entry injects GERALDOS_APP_URL via nginx before serving; Orthanc stays private via GeraldOS /api/orthanc/proxy server-side.
OHIF uses existing GeraldOS server-side proxy /api/orthanc/dicom-web which forwards to private Orthanc using server-side credentials. Browser never sees ORTHANC_URL/USERNAME/PASSWORD. Entry script runs nginx only (build-time config via COPY). No runtime injection needed because app-config.js is baked into image.
