# Bug Hunter — production image.
# Runs the TypeScript server directly with tsx (tsx is a devDependency, so it is
# installed explicitly). Put secrets in the platform's env vars or --env-file;
# never bake .env into the image.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .

EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]
