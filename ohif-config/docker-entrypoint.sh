#!/bin/sh
echo "<script>window.GERALDOS_APP_URL='${GERALDOS_APP_URL:-}';</script>" >> /usr/share/nginx/html/index.html || true
exec nginx -g "daemon off;"
