FROM node:24.22.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY *.ts ./
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318
EXPOSE 4318
CMD ["node_modules/.bin/tsx","server.ts"]
