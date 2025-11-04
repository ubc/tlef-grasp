# Multi-stage build for GRASP Application
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Development stage
FROM node:20-alpine AS development

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies)
RUN npm install

# Copy application code
COPY . .

# Expose port
EXPOSE 8070

# Start development server
CMD ["npm", "run", "dev:server"]

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy dependencies from base
COPY --from=base /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 8070

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8070/auth/me', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start production server
CMD ["npm", "start"]

