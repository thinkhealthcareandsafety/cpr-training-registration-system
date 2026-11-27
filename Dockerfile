FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
