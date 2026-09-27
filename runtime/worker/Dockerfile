FROM node:20-alpine
RUN addgroup -S haspad && adduser -S haspad -G haspad
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
USER haspad
EXPOSE 3001
CMD ["node","server.js"]