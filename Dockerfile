FROM node:22-alpine AS dependencies
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM node:22-alpine AS builder
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/web
COPY --from=dependencies /app/web/node_modules ./node_modules
COPY web ./
COPY content /repository-build/content
ENV REPOSITORY_ROOT=/repository-build
RUN npx next build

FROM node:22-alpine AS runner
RUN apk add --no-cache git openssh-client
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    REPOSITORY_ROOT=/repository
WORKDIR /app
COPY --from=builder --chown=node:node /app/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/web/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/web/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
