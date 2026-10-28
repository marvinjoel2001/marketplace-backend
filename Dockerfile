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

RUN apk add --no-cache openssl libc6-compat chromium nss freetype harfbuzz ca-certificates ttf-freefont

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PORT=4000
ENV DATABASE_URL="file:/app/prisma/dev.db"

# Reuse the builder's node_modules: the pinned Prisma CLI (db push) and tsx (first-boot seed)
# are devDependencies, and `npx prisma` would otherwise download an incompatible latest major.
COPY package*.json ./
COPY prisma ./prisma/
COPY scripts ./scripts/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Chromium runs with its sandbox; do not launch the browser as root.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# db push is additive for this schema; the seed only runs when the database has no categories.
CMD ["sh", "-c", "npx prisma db push && node scripts/seed-if-empty.cjs && node dist/main.js"]
