FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts vitest.config.ts playwright.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY shared ./shared
COPY examples/activities.json examples/activities.csv ./examples/
COPY tests ./tests
RUN npm run build \
    && mkdir third-party-licenses \
    && cp node_modules/react/LICENSE third-party-licenses/react.LICENSE \
    && cp node_modules/react-dom/LICENSE third-party-licenses/react-dom.LICENSE \
    && cp node_modules/lucide-react/LICENSE third-party-licenses/lucide-react.LICENSE \
    && cp node_modules/@fontsource-variable/manrope/LICENSE third-party-licenses/manrope.LICENSE \
    && npm prune --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ARG VERSION=dev
ARG REVISION=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="im-overdue" \
    org.opencontainers.image.description="Private single-user time account with a browser UI and SQLite storage." \
    org.opencontainers.image.source="https://github.com/ill-yes/im-overdue" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.revision="${REVISION}" \
    org.opencontainers.image.created="${BUILD_DATE}"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 PUID=99 PGID=100 IM_OVERDUE_DB=/data/im-overdue.sqlite
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/third-party-licenses ./third-party-licenses
COPY LICENSE NOTICE CONTRIBUTING.md ./
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/im-overdue-entrypoint
COPY docker/healthcheck.mjs ./healthcheck.mjs
RUN mkdir /data
VOLUME ["/data"]
EXPOSE 4317
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["/usr/local/bin/im-overdue-entrypoint", "--healthcheck"]
ENTRYPOINT ["/usr/local/bin/im-overdue-entrypoint"]
CMD ["node", "dist-server/server/index.js"]
