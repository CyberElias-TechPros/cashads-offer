# syntax=docker/dockerfile:1.7
# Multi-target build for the CashAds monorepo:
#   docker build --target api -t cashads-api .
#   docker build --target web -t cashads-web .

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build -w @cashads/api \
 && NEXT_OUTPUT=standalone npm run build -w @cashads/web

# ---------------------------------------------------------------- API image
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/api/package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

# ---------------------------------------------------------------- Web image
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
