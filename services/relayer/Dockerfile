FROM oven/bun:1.4.4
WORKDIR /app
COPY package.json bun.lock ./
COPY web/package.json web/package.json
COPY services/relayer/package.json services/relayer/package.json
RUN bun install --frozen-lockfile --production
COPY services/relayer/src services/relayer/src
COPY web/src web/src
ENV RELAYER_PORT=3037
EXPOSE 3037
CMD ["bun", "services/relayer/src/index.ts"]
