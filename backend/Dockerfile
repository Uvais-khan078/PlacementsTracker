FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.js routes.js appwrite.js ./
COPY scripts ./scripts
USER node
EXPOSE 5000
CMD ["node", "index.js"]
