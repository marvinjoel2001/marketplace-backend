# Multi-stage Dockerfile for NestJS Marketplace Backend
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_URL="file:./prisma/dev.db"

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Persist SQLite database volume
VOLUME ["/app/prisma"]

EXPOSE 4000

CMD ["sh", "-c", "npx prisma db push && node dist/main.js"]
