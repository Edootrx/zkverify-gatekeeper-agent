FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY circuits ./circuits
EXPOSE 8080
CMD ["node", "src/server.js"]
