# Multi-stage build. --include=dev in the build stage is required: with
# NODE_ENV=production set, npm ci skips devDependencies by default, but
# @nestjs/cli (which `nest build` needs) lives there. Mirrors render.yaml's
# buildCommand/startCommand so the container behaves the same as the Render
# deploy it replaces.
#
# This host's network path times out a large fraction of the container
# bridge's outbound connections to registry.npmjs.org — confirmed at the
# packet level, not fixable by npm tuning alone. docker-tls-bridge (a local
# mitmproxy, see its systemd unit) already works around the identical problem
# for the Docker daemon's own registry pulls, so the build routes through it
# too: 172.17.0.1 is the docker0 bridge gateway, reachable from any
# container, and NODE_EXTRA_CA_CERTS trusts the bridge's MITM certificate
# (mitm-ca.pem, copied from /etc/mitmproxy/mitmproxy-ca-cert.pem on this
# server — not meant to leave it).
FROM node:22-slim AS npmconfig
COPY mitm-ca.pem /usr/local/share/ca-certificates/mitm-ca.crt
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/mitm-ca.crt
ENV HTTP_PROXY=http://172.17.0.1:8080
ENV HTTPS_PROXY=http://172.17.0.1:8080
ENV NO_PROXY=localhost,127.0.0.1
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set proxy http://172.17.0.1:8080 && \
    npm config set https-proxy http://172.17.0.1:8080

FROM npmconfig AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM npmconfig AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# The proxy/CA setup above is a build-time-only workaround for this host's
# npm registry connectivity. Left set, it broke the running app's own
# Postgres connection to Supabase (a raw TLS socket, not HTTP — but Node
# picks up these vars globally) with a silent hang. The running container
# talks to Supabase directly, so none of this belongs past the build.
ENV HTTP_PROXY=
ENV HTTPS_PROXY=
ENV http_proxy=
ENV https_proxy=
ENV NODE_EXTRA_CA_CERTS=

EXPOSE 3000
CMD ["node", "dist/main.js"]
