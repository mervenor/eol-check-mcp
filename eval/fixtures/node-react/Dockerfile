FROM node:18.19.0-alpine3.19 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:18.19.0-alpine3.19
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
CMD ["npm", "start"]
