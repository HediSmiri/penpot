# Point both corepack (pnpm download) and pnpm (deps) at a reachable registry.
# Defaults to the public npm registry; override for a mirror, e.g.:
#   --build-arg NPM_REGISTRY=http://registry.<org>:4873
ARG NPM_REGISTRY=https://registry.npmjs.org

FROM node:24 AS build
LABEL maintainer="Penpot <docker@penpot.app>"
ARG NPM_REGISTRY
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY \
    npm_config_registry=$NPM_REGISTRY \
    NODE_OPTIONS=--dns-result-order=ipv4first
WORKDIR /src
COPY mcp/package.json mcp/pnpm-workspace.yaml mcp/pnpm-lock.yaml ./
COPY mcp/packages ./packages
# corepack ships with node:24 and pins pnpm from package.json's packageManager
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter mcp-common run build
RUN pnpm --filter mcp-server run build

FROM node:24
LABEL maintainer="Penpot <docker@penpot.app>"
ENV LANG=C.UTF-8 \
    NODE_ENV=production \
    PENPOT_MCP_SERVER_HOST=0.0.0.0 \
    PENPOT_MCP_REMOTE_MODE=true
WORKDIR /app/packages/server
COPY --from=build /src/ /app/
EXPOSE 4401 4402
USER node
CMD ["node", "/app/packages/server/dist/index.js", "--multi-user"]
