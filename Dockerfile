# Hosted (remote MCP) mode: a stateless multi-user Streamable HTTP server.
# Build:  docker build -t lingochunk-mcp .
# Run:    docker run -p 8100:8100 -e LINGOCHUNK_BASE_URL=http://host:8000 lingochunk-mcp
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
# The build's generate step (scripts/generate-guides.ts, run by `npm run
# build` and by npm ci's `prepare`) embeds skills/*/SKILL.md into
# src/generated/guides.ts — both trees must be in the build context.
COPY scripts ./scripts
COPY skills ./skills
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# index.ts reads ../package.json (relative to dist/) for the version.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8100
USER node
CMD ["node", "dist/index.js", "--http"]
