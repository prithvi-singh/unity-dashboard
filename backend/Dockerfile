FROM node:20-alpine

# Create a non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Transfer ownership to non-root user
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

CMD ["node", "server.js"]
