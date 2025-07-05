# Build App
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci --prefer-offline

COPY . .

RUN npm run build

# Take the build output and run it
FROM node:22-alpine AS deploy

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev --prefer-offline

# Temporarily copy the .env file
COPY .env ./

COPY --from=build /app/dist ./dist

EXPOSE 4000

CMD ["npm", "run", "start:prod"]

