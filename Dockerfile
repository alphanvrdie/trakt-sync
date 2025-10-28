FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create directories for persistence
RUN mkdir -p /app/config /app/logs

# Default command (will be overridden by docker-compose)
CMD ["node", "sync-auto.mjs", "auto-sync"]