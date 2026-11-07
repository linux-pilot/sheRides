FROM node:20-alpine
WORKDIR /app
# Lockfile + npm ci: every build installs exactly the versions in package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5000
CMD ["node", "--watch", "index.js"]
