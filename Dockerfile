# Build App
FROM node:lts-slim AS build

WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build && \
    echo "Build complete"

# Take the build output and run it
FROM node:lts-slim AS deploy

WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package*.json ./

RUN npm ci --omit=dev

RUN mkdir -p /app/public

COPY --from=build /app/dist ./dist
COPY --from=build /app/.env ./

EXPOSE 4000

CMD ["npm", "run", "start:prod"]

