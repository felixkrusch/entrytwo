FROM node:20-bookworm-slim

WORKDIR /updater

RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io wget ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# cosign (keyless + pinned-key image signature verification)
RUN curl -sSfL https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 \
    -o /usr/local/bin/cosign \
    && chmod +x /usr/local/bin/cosign

COPY server.mjs ./server.mjs

EXPOSE 4000
ENV UPDATER_PORT=4000
CMD ["node", "server.mjs"]
