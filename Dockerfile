FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="church-translation" \
	org.opencontainers.image.source="https://github.com/SenRanja/FOCUS-translation" \
	org.opencontainers.image.revision="${VCS_REF}"

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY packages/contracts/src packages/contracts/src
RUN mkdir -p /app/data /app/log && chown node:node /app/data /app/log

USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]