# Build App
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci --legacy-peer-deps

COPY . .

RUN npm run build

# Take the build output and run it
FROM node:22-alpine AS deploy

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev --legacy-peer-deps

COPY --from=build /app/dist ./dist

EXPOSE 4000

CMD ["npm", "run", "start:prod"]

