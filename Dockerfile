FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
# Hosting platforms set PORT; 8787 is the default for local runs.
EXPOSE 8787
USER node
CMD ["npm", "start"]
