FROM oven/bun:1.4.4
WORKDIR /app
COPY package.json bun.lock ./
COPY web/package.json web/package.json
COPY services/relayer/package.json services/relayer/package.json
COPY services/npc/package.json services/npc/package.json
RUN bun install --frozen-lockfile --production
COPY services/relayer services/relayer
ENV RELAYER_PORT=3037
EXPOSE 3037
CMD ["bun", "services/relayer/src/index.ts"]
