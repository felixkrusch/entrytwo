# ---- deps ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app/entrytwo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY scripts/check-node.mjs ./scripts/check-node.mjs
RUN npm ci

# ---- build ----
FROM deps AS build
WORKDIR /app/entrytwo
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next build collects page data and validates AUTH_SECRET in production mode
ENV AUTH_SECRET=build-placeholder-not-for-runtime
ENV AUTH_TRUST_HOST=true
RUN npx prisma generate
RUN npm run build

# ---- runner ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app/entrytwo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Docker operations are isolated in the updater sidecar. The app container only
# needs wget for its health check and CA roots for outbound HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/entrytwo/node_modules ./node_modules
COPY --from=build /app/entrytwo/.next ./.next
COPY --from=build /app/entrytwo/public ./public
COPY --from=build /app/entrytwo/.grok ./.grok
COPY --from=build /app/entrytwo/prisma ./prisma
COPY --from=build /app/entrytwo/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/entrytwo/scripts ./scripts
COPY --from=build /app/entrytwo/package.json ./package.json
COPY --from=build /app/entrytwo/next.config.ts ./next.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh \
    && mkdir -p .data/files .data/backups uploads logs backups

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
