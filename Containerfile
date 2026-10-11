# Podium server + UI. Build: podiumctl build   (or: podman build -t localhost/podium:latest -f Containerfile .)
FROM docker.io/library/node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY frontend/package.json frontend/
RUN npm ci
# The UI imports the view types from server/src/fleet, so both trees are needed before either build.
COPY server server
COPY frontend frontend
RUN npm run build -w frontend && npm run build -w server

FROM docker.io/library/node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 PODIUM_DB=/data/podium.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/frontend/dist frontend/dist
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 4317
CMD ["node", "server/dist/index.js"]
