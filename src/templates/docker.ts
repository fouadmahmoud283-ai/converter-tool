/**
 * Docker configuration templates
 */

export function generateDockerfile(): string {
  return `# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \\
    adduser -S expressapp -u 1001

# Copy built files from builder
COPY --from=builder --chown=expressapp:nodejs /app/dist ./dist
COPY --from=builder --chown=expressapp:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=expressapp:nodejs /app/package.json ./

# Set user
USER expressapp

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
`;
}

export function generateDockerCompose(envVars: string[]): string {
  const envList = envVars.map(v => `      - \${${v}}`).join('\n');
  
  return `version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "\${PORT:-3000}:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
${envList}
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # Optional: Redis for caching/sessions
  # redis:
  #   image: redis:7-alpine
  #   ports:
  #     - "6379:6379"
  #   volumes:
  #     - redis-data:/data
  #   networks:
  #     - app-network
  #   restart: unless-stopped

networks:
  app-network:
    driver: bridge

# volumes:
#   redis-data:
`;
}

import type { SelfHostedConfig } from '../config.js';

/**
 * Generate Docker Compose for self-hosted mode with PostgreSQL and optional MinIO
 */
export function generateSelfHostedDockerCompose(config: SelfHostedConfig): string {
  const dbConfig = config.database || {};
  const storageConfig = config.storage || { provider: 'local' };
  const includeMinIO = storageConfig.provider === 'minio' || storageConfig.provider === 'both';
  
  const dbName = dbConfig.name || 'app_db';
  const dbUser = dbConfig.user || 'postgres';
  const dbPassword = dbConfig.password || 'postgres';
  
  const minioConfig = storageConfig.minio || {};
  const minioAccessKey = minioConfig.accessKey || 'minioadmin';
  const minioSecretKey = minioConfig.secretKey || 'minioadmin';
  const minioBucket = minioConfig.bucket || 'app-storage';
  
  let compose = `version: '3.8'

services:
  # Express API Server
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "\${PORT:-3001}:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
      - DATABASE_URL=postgresql://${dbUser}:${dbPassword}@postgres:5432/${dbName}?schema=public
      - JWT_SECRET=\${JWT_SECRET}
      - JWT_REFRESH_SECRET=\${JWT_REFRESH_SECRET}
      - STORAGE_PROVIDER=\${STORAGE_PROVIDER:-local}
      - LOCAL_STORAGE_PATH=/app/uploads`;

  if (includeMinIO) {
    compose += `
      - MINIO_ENDPOINT=minio
      - MINIO_PORT=9000
      - MINIO_ACCESS_KEY=\${MINIO_ACCESS_KEY:-${minioAccessKey}}
      - MINIO_SECRET_KEY=\${MINIO_SECRET_KEY:-${minioSecretKey}}
      - STORAGE_BUCKET=${minioBucket}`;
  }

  compose += `
    volumes:
      - uploads:/app/uploads
    depends_on:
      postgres:
        condition: service_healthy`;
  
  if (includeMinIO) {
    compose += `
      minio:
        condition: service_healthy`;
  }

  compose += `
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # PostgreSQL Database
  postgres:
    image: postgres:16-alpine
    ports:
      - "\${DB_PORT:-5432}:5432"
    environment:
      - POSTGRES_DB=${dbName}
      - POSTGRES_USER=${dbUser}
      - POSTGRES_PASSWORD=${dbPassword}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${dbUser} -d ${dbName}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
`;

  if (includeMinIO) {
    compose += `
  # MinIO Object Storage (S3-compatible)
  minio:
    image: minio/minio:latest
    ports:
      - "\${MINIO_PORT:-9000}:9000"
      - "\${MINIO_CONSOLE_PORT:-9001}:9001"
    environment:
      - MINIO_ROOT_USER=\${MINIO_ACCESS_KEY:-${minioAccessKey}}
      - MINIO_ROOT_PASSWORD=\${MINIO_SECRET_KEY:-${minioSecretKey}}
    volumes:
      - minio-data:/data
    command: server /data --console-address ":9001"
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  # MinIO initial bucket setup
  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set myminio http://minio:9000 \${MINIO_ACCESS_KEY:-${minioAccessKey}} \${MINIO_SECRET_KEY:-${minioSecretKey}};
      mc mb myminio/${minioBucket} --ignore-existing;
      mc anonymous set download myminio/${minioBucket}/public;
      exit 0;
      "
    networks:
      - app-network
`;
  }

  compose += `
networks:
  app-network:
    driver: bridge

volumes:
  postgres-data:
  uploads:`;

  if (includeMinIO) {
    compose += `
  minio-data:`;
  }

  compose += '\n';

  return compose;
}

/**
 * Generate Dockerfile for self-hosted mode (includes Prisma)
 */
export function generateSelfHostedDockerfile(): string {
  return `# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl wget

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \\
    adduser -S expressapp -u 1001

# Create uploads directory
RUN mkdir -p /app/uploads && chown expressapp:nodejs /app/uploads

# Copy built files from builder
COPY --from=builder --chown=expressapp:nodejs /app/dist ./dist
COPY --from=builder --chown=expressapp:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=expressapp:nodejs /app/package.json ./
COPY --from=builder --chown=expressapp:nodejs /app/prisma ./prisma

# Set user
USER expressapp

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Run migrations and start server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
`;
}

/**
 * Generate .env.example for self-hosted mode
 */
export function generateSelfHostedEnvExample(config: SelfHostedConfig): string {
  const dbConfig = config.database || {};
  const storageConfig = config.storage || { provider: 'local' };
  const includeMinIO = storageConfig.provider === 'minio' || storageConfig.provider === 'both';
  
  let env = `# Server Configuration
NODE_ENV=development
PORT=3001

# Database Configuration
DATABASE_URL=postgresql://${dbConfig.user || 'postgres'}:${dbConfig.password || 'postgres'}@localhost:${dbConfig.port || 5432}/${dbConfig.name || 'app_db'}?schema=public

# JWT Secrets (generate with: openssl rand -hex 32)
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production

# Storage Configuration
STORAGE_PROVIDER=${storageConfig.provider || 'local'}
LOCAL_STORAGE_PATH=./uploads
`;

  if (includeMinIO) {
    const minioConfig = storageConfig.minio || {};
    env += `
# MinIO Configuration (S3-compatible storage)
MINIO_ENDPOINT=${minioConfig.endpoint || 'localhost'}
MINIO_PORT=${minioConfig.port || 9000}
MINIO_ACCESS_KEY=${minioConfig.accessKey || 'minioadmin'}
MINIO_SECRET_KEY=${minioConfig.secretKey || 'minioadmin'}
MINIO_USE_SSL=false
STORAGE_BUCKET=${minioConfig.bucket || 'app-storage'}
`;
  }

  env += `
# Backend URL (for generating file URLs)
BACKEND_URL=http://localhost:3001

# CORS Origins (comma-separated)
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
`;

  return env;
}

export function generateDockerIgnore(): string {
  return `# Dependencies
node_modules

# Build output (we build in Docker)
dist

# Development files
.env
.env.local
.env.*.local
*.log

# Git
.git
.gitignore

# IDE
.idea
.vscode
*.swp
*.swo

# Testing
coverage
.nyc_output

# Docker
Dockerfile*
docker-compose*
.docker

# Documentation
README.md
docs

# Misc
*.md
.editorconfig
.prettierrc
.eslintrc*

# Uploads (for self-hosted mode)
uploads/
`;
}
