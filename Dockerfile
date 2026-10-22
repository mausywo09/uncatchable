# $UNCATCHABLE website (Coolify build pack "Dockerfile"): one static page served by nginx.
# Files are copied by name on purpose, so brand/ (source images, prep script) is never published.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY index.html og-image.png favicon.png apple-touch-icon.png /usr/share/nginx/html/
COPY img/ /usr/share/nginx/html/img/

EXPOSE 80
