ARG NODE_IMAGE=node:24.11.1-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY apps ./apps
RUN pnpm --filter api build && pnpm --filter web build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable \
  && npx playwright install --with-deps chromium \
  && chown -R node:node /ms-playwright
USER node
EXPOSE 8004
CMD ["node", "apps/api/dist/server.js"]
