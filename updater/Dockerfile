FROM docker:27-cli

ARG TARGETARCH

WORKDIR /updater

RUN apk add --no-cache nodejs wget ca-certificates curl \
    && docker compose version

# cosign (keyless + pinned-key image signature verification)
RUN case "$TARGETARCH" in \
      amd64) sha=bcfeae05557a9f313ee4392d2f335d0ff69ebbfd232019e3736fb04999fe1734 ;; \
      arm64) sha=2cbcea1873ad76274c3f241ef175d204654e3aac3e73e6ec4504e5227015cb0a ;; \
      *) exit 1 ;; \
    esac \
    && curl -sSfL "https://github.com/sigstore/cosign/releases/download/v2.5.2/cosign-linux-${TARGETARCH}" \
    -o /usr/local/bin/cosign \
    && printf '%s  /usr/local/bin/cosign\n' "$sha" | sha256sum -c - \
    && chmod +x /usr/local/bin/cosign

COPY updater/server.mjs ./server.mjs

EXPOSE 4000
ENV UPDATER_PORT=4000
CMD ["node", "/updater/server.mjs"]
