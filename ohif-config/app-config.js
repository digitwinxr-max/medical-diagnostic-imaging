/**
 * OHIF Viewer — GeraldOS configuration
 *
 * All DICOMweb traffic (QIDO-RS / WADO-RS / STOW-RS) flows through the GeraldOS
 * same-origin proxy at /api/orthanc/dicom-web — the browser never talks to
 * Orthanc directly, so no CORS configuration is required and Orthanc
 * credentials never leave the server. Endpoints are read from environment
 * variables server-side (ORTHANC_URL / ORTHANC_USERNAME / ORTHANC_PASSWORD).
 *
 * `extensions`/`modes` must be arrays (the standalone ohif/app bundle carries
 * the actual implementations) — omitting them breaks app boot.
 *
 * Deployment-portable: GeraldOS origin is resolved at runtime from
 * NEXT_PUBLIC_APP_URL (build-time) or window.GERALDOS_APP_URL or by
 * deriving from OHIF location (3001 -> 3000) for local dev. Do not hardcode
 * production hostnames here.
 */
var geraldosUrl = (typeof window !== 'undefined' && (window.NEXT_PUBLIC_APP_URL || window.GERALDOS_APP_URL)) || 'http://localhost:3000';
if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.port === '3001' && !window.NEXT_PUBLIC_APP_URL && !window.GERALDOS_APP_URL) {
  geraldosUrl = window.location.origin.replace(':3001', ':3000');
}
window.config = {
  routerBasename: '/',
  extensions: [],
  modes: [],
  showStudyList: true,
  defaultDataSourceName: 'dicomweb',
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  strictZSpacingForVolumeViewport: true,
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      displaySetName: 'DICOM Web',
      configuration: {
        friendlyName: 'GeraldOS DICOMweb (Orthanc)',
        name: 'Orthanc',
        wadoUriRoot: geraldosUrl + '/api/orthanc/dicom-web',
        qidoRoot: geraldosUrl + '/api/orthanc/dicom-web',
        stowRoot: geraldosUrl + '/api/orthanc/dicom-web',
        wadoRoot: geraldosUrl + '/api/orthanc/dicom-web',
        requestOptions: {
          headers: {
            Accept: 'application/json',
          },
        },
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyList: true,
        enableStudyLazyLoad: true,
      },
    },
  ],
};
