const GERALDOS_APP_URL = (typeof window !== 'undefined' && window.GERALDOS_APP_URL) ? window.GERALDOS_APP_URL : (typeof process !== 'undefined' && process.env.GERALDOS_APP_URL) ? process.env.GERALDOS_APP_URL : '';
window.config = {
  routerBasename: '/',
  servers: {
    dicomWeb: [
      {
        name: 'GeraldOS DICOMweb',
        qidoRoot: GERALDOS_APP_URL ? GERALDOS_APP_URL + '/api/orthanc/dicom-web' : '/api/orthanc/dicom-web',
        wadoRoot: GERALDOS_APP_URL ? GERALDOS_APP_URL + '/api/orthanc/dicom-web' : '/api/orthanc/dicom-web',
        wadoUriRoot: GERALDOS_APP_URL ? GERALDOS_APP_URL + '/api/orthanc/dicom-web' : '/api/orthanc/dicom-web',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadouri',
        thumbnailRendering: 'wadors',
      },
    ],
  },
};
