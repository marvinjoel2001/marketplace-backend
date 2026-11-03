# Multi-stage Dockerfile for NestJS Marketplace Backend
FROM node:22-alpine AS builder

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# Production Runner
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat chromium nss freetype harfbuzz ca-certificates ttf-freefont su-exec

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium-nonroot
ENV PORT=4000

# Reuse the builder's node_modules: the pinned Prisma CLI (db push) and tsx (first-boot seed)
# are devDependencies, and `npx prisma` would otherwise download an incompatible latest major.
COPY package*.json ./
COPY prisma ./prisma/
COPY scripts ./scripts/
COPY --chmod=755 scripts/chromium-nonroot.sh /usr/local/bin/chromium-nonroot
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# The launcher also drops Chromium's privileges if Railway overrides USER for its volume.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# Apply reviewed PostgreSQL migrations, optionally import the legacy volume, then start the API.
CMD ["node", "scripts/start-production.cjs"]
