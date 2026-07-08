# ---- deps ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app/entrytwo
COPY package*.json ./
RUN npm ci

# ---- build ----
FROM deps AS build
WORKDIR /app/entrytwo
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ---- runner ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app/entrytwo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# docker CLI is required so the running container can self-update (pull + recreate).
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/entrytwo/node_modules ./node_modules
COPY --from=build /app/entrytwo/.next ./.next
COPY --from=build /app/entrytwo/public ./public
COPY --from=build /app/entrytwo/prisma ./prisma
COPY --from=build /app/entrytwo/package.json ./package.json
COPY --from=build /app/entrytwo/next.config.ts ./next.config.ts
COPY --from=build /app/entrytwo/compose.yaml ./compose.yaml
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
