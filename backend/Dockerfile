FROM node:20-alpine

# Create a non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# ═══════════════════════════════════════════════════════════════════════════════
# Verify the deployment includes our code changes — this will FAIL the Docker
# build if the wrong code is in the image, preventing a broken deploy.
RUN grep -q 'api/zoho' server.js || (echo "ERROR: server.js does not contain /api/zoho mount — stale Docker layer?" >&2 && exit 1)
RUN echo "server.js verification: OK (/api/zoho marker found)"
# ═══════════════════════════════════════════════════════════════════════════════

# Transfer ownership to non-root user
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

CMD ["node", "server.js"]
