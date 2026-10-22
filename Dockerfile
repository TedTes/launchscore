FROM node:20-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/scanner/package.json packages/scanner/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @launchscore/scanner --filter api --frozen-lockfile=false
COPY packages/scanner packages/scanner
COPY apps/api apps/api
RUN pnpm --filter @launchscore/scanner build && pnpm --filter api build && pnpm --filter api deploy --prod --legacy /output

FROM mcr.microsoft.com/playwright:v1.64.1-jammy
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /output ./
COPY --from=build /app/packages/scanner/dist ./node_modules/@launchscore/scanner/dist
CMD ["node", "dist/server.js"]
