FROM oven/bun:1.4.4
WORKDIR /app
COPY package.json bun.lock ./
COPY web/package.json web/package.json
COPY services/relayer/package.json services/relayer/package.json
COPY services/npc/package.json services/npc/package.json
RUN bun install --frozen-lockfile --production
COPY services/npc services/npc
ENV NPC_PORT=3038
EXPOSE 3038
CMD ["bun", "services/npc/src/index.ts"]
