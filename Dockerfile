FROM node:20-alpine

WORKDIR /app

# Dependencies
COPY package*.json ./
RUN npm ci

# Source
COPY . .

# Prisma client generate
RUN npx prisma generate

# Build
RUN npm run build

EXPOSE 3001

# Migration + start
CMD sh -c "npx prisma migrate deploy && node --max-old-space-size=512 dist/main.js"
