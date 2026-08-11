FROM node:20-alpine
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3000 NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
EXPOSE 3000
CMD ["sh", "-c", "npm start -H 0.0.0.0 -p \"$PORT\""]
