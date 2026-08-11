FROM ghcr.io/ohif/app:3.9.2
COPY app-config.js /usr/share/nginx/html/app-config.js
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]
