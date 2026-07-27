# node-pty（ネイティブモジュール）のビルドにpython3/make/g++が必要なためDebianベースを使用
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/server.js"]
