# $UNCATCHABLE website (Coolify build pack "Dockerfile"): the static page served by nginx, plus the small launch API
# (server/api.mjs, plain Node, no dependencies) that finds the $UNCATCHABLE CA, pool and curve on-chain.
# Files are copied by name on purpose, so brand/ (source images, prep script) is never published.
# Optional env (Coolify): UNC_CREATOR, UNC_SINCE, UNC_MINT (pins the CA by hand), SOLANA_RPC.
FROM nginx:1.27-alpine

# nodejs for the API; su-exec runs it as the unprivileged nginx user
RUN apk add --no-cache nodejs su-exec
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY index.html og-image.png favicon.png apple-touch-icon.png /usr/share/nginx/html/
COPY img/ /usr/share/nginx/html/img/
COPY server/api.mjs server/launch.mjs /srv/uncatchable/server/
COPY docker-start.sh /docker-start.sh
RUN chmod +x /docker-start.sh
ENV API_HOST=127.0.0.1 API_PORT=8787

EXPOSE 80
CMD ["/docker-start.sh"]
