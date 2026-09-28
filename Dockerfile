FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json nest-cli.json ./
ENV DATABASE_URL=postgresql://build:build@localhost:5432/QueueFlow
RUN npx prisma generate

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN addgroup -S queueflow && adduser -S queueflow -G queueflow \
  && chown -R queueflow:queueflow /app
USER queueflow
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
