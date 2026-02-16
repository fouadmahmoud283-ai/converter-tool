import path from 'node:path';
import fs from 'fs-extra';
import { generateDependenciesObject } from '../utils/dependencies.js';
import { generateEnvExample } from '../utils/env.js';
import { ConverterConfig, defaultConfig, SelfHostedConfig } from '../config.js';
import { generateDockerfile, generateDockerCompose, generateDockerIgnore, generateSelfHostedDockerCompose, generateSelfHostedDockerComposeDev, generateSelfHostedDockerfile, generateSelfHostedEnvExample } from './docker.js';
import { generateSwaggerConfig, generateSwaggerSetup } from './swagger.js';
import { generateValidationMiddleware, generateSchemasIndex } from './validation.js';
import { generateAuthMiddleware, generateAuthTypes } from './auth.js';
import { generateGracefulShutdown, generateClusterSetup, generateHealthCheck } from './server-utils.js';
import { generateStreamingUtils, generateStreamingTypes } from './streaming.js';
import { generateWebSocketSetup, generateWebSocketTypes } from './websocket.js';
import { generateReadme } from './readme.js';
import { generateAuthProxy, generateDatabaseProxy, generateStorageProxy } from './supabase-proxy.js';
import { generatePrismaSchema, generatePrismaClient, generateDbUtils, generateCrudService, generateRestApiGenerator } from './prisma.js';
import { generateAuthService, generateSelfHostedAuthRoutes, generateSelfHostedAuthMiddleware } from './auth-selfhosted.js';
import { generateStorageService, generateStorageRoutes } from './storage-selfhosted.js';

export type BackendOptions = {
  config?: Partial<ConverterConfig>;
  functionNames?: string[];
};

export async function writeBackendScaffold(
  backendDir: string,
  detectedDependencies: Set<string>,
  envVars: Set<string>,
  options: BackendOptions = {}
): Promise<void> {
  const config = { ...defaultConfig, ...options.config };
  const functionNames = options.functionNames ?? [];
  
  await fs.ensureDir(backendDir);

  // Merge detected dependencies with required base dependencies
  const extraDeps = generateDependenciesObject(detectedDependencies);
  
  // Add optional dependencies based on config
  const optionalDeps: Record<string, string> = {};
  if (config.swagger) {
    optionalDeps['swagger-ui-express'] = '^5.0.0';
  }
  if (config.validation) {
    optionalDeps['zod'] = '^3.22.4';
  }
  
  const pkg = {
    name: 'converted-backend',
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'tsx watch src/index.ts',
      build: 'tsc -p tsconfig.json',
      start: 'node dist/index.js',
      'start:prod': 'NODE_ENV=production node dist/index.js',
      'start:cluster': 'NODE_ENV=production CLUSTER_MODE=true node dist/index.js',
      lint: 'eslint src --ext .ts',
      test: 'vitest run',
      'test:watch': 'vitest'
    },
    dependencies: {
      cors: '^2.8.5',
      dotenv: '^16.4.1',
      express: '^4.19.2',
      helmet: '^7.1.0',
      'express-rate-limit': '^7.1.5',
      morgan: '^1.10.0',
      ws: '^8.16.0',
      ...extraDeps,
      ...optionalDeps,
      ...(config.dependencies ?? {})
    },
    devDependencies: {
      '@types/cors': '^2.8.17',
      '@types/express': '^4.17.21',
      '@types/morgan': '^1.9.9',
      '@types/node': '^20.11.10',
      '@types/swagger-ui-express': '^4.1.6',
      '@types/ws': '^8.5.10',
      tsx: '^4.7.0',
      typescript: '^5.4.5',
      vitest: '^1.3.1'
    }
  };

  await fs.writeJson(path.join(backendDir, 'package.json'), pkg, { spaces: 2 });

  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      rootDir: 'src',
      esModuleInterop: true,
      resolveJsonModule: true,
      lib: ['ES2022', 'DOM'],
      skipLibCheck: true,
      strict: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true
    },
    include: ['src/**/*.ts'],
    exclude: ['node_modules', 'dist']
  };

  await fs.writeJson(path.join(backendDir, 'tsconfig.json'), tsconfig, { spaces: 2 });

  // Generate .env.example with detected env vars
  const envExample = generateEnvExample(new Set(envVars));
  await fs.writeFile(path.join(backendDir, '.env.example'), envExample, 'utf8');

  // Create directory structure
  await fs.ensureDir(path.join(backendDir, 'src', 'handlers'));
  await fs.ensureDir(path.join(backendDir, 'src', 'routes'));
  await fs.ensureDir(path.join(backendDir, 'src', 'lib'));
  await fs.ensureDir(path.join(backendDir, 'src', 'shared'));
  await fs.ensureDir(path.join(backendDir, 'src', 'middleware'));
  await fs.ensureDir(path.join(backendDir, 'src', 'utils'));
  await fs.ensureDir(path.join(backendDir, 'src', 'schemas'));
  await fs.ensureDir(path.join(backendDir, 'src', 'types'));

  // Write adapter (Request/Response bridge)
  await writeAdapter(backendDir);

  // Write middleware
  await writeMiddleware(backendDir);

  // Write main index with config options
  await writeIndex(backendDir, config);

  // Write auth middleware
  await fs.writeFile(
    path.join(backendDir, 'src', 'middleware', 'auth.ts'),
    generateAuthMiddleware(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'types', 'auth.d.ts'),
    generateAuthTypes(),
    'utf8'
  );

  // Write server utilities
  await fs.writeFile(
    path.join(backendDir, 'src', 'utils', 'shutdown.ts'),
    generateGracefulShutdown(),
    'utf8'
  );
  
  // Write clustering support
  await fs.writeFile(
    path.join(backendDir, 'src', 'utils', 'cluster.ts'),
    generateClusterSetup(),
    'utf8'
  );

  // Write enhanced health check
  await fs.writeFile(
    path.join(backendDir, 'src', 'routes', 'health.ts'),
    generateHealthCheck(),
    'utf8'
  );

  // Write validation middleware and schemas
  if (config.validation) {
    await fs.writeFile(
      path.join(backendDir, 'src', 'middleware', 'validation.ts'),
      generateValidationMiddleware(),
      'utf8'
    );
    await fs.writeFile(
      path.join(backendDir, 'src', 'schemas', 'index.ts'),
      generateSchemasIndex(functionNames),
      'utf8'
    );
  }

  // Write Swagger/OpenAPI docs
  if (config.swagger) {
    await fs.writeFile(
      path.join(backendDir, 'src', 'lib', 'swagger.ts'),
      generateSwaggerSetup(),
      'utf8'
    );
    // Write openapi.json to src folder so swagger.ts can find it easily
    await fs.writeFile(
      path.join(backendDir, 'src', 'openapi.json'),
      generateSwaggerConfig(functionNames),
      'utf8'
    );
  }

  // Write Docker files
  if (config.docker) {
    await fs.writeFile(
      path.join(backendDir, 'Dockerfile'),
      generateDockerfile(),
      'utf8'
    );
    await fs.writeFile(
      path.join(backendDir, 'docker-compose.yml'),
      generateDockerCompose(Array.from(envVars)),
      'utf8'
    );
    await fs.writeFile(
      path.join(backendDir, '.dockerignore'),
      generateDockerIgnore(),
      'utf8'
    );
  }

  // Write streaming utilities
  await fs.writeFile(
    path.join(backendDir, 'src', 'lib', 'streaming.ts'),
    generateStreamingUtils(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'types', 'streaming.d.ts'),
    generateStreamingTypes(),
    'utf8'
  );

  // Write WebSocket support
  await fs.writeFile(
    path.join(backendDir, 'src', 'lib', 'websocket.ts'),
    generateWebSocketSetup(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'types', 'websocket.d.ts'),
    generateWebSocketTypes(),
    'utf8'
  );

  // Write Supabase proxy routes (for auth, database, storage)
  await fs.writeFile(
    path.join(backendDir, 'src', 'routes', 'proxy-auth.ts'),
    generateAuthProxy(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'routes', 'proxy-database.ts'),
    generateDatabaseProxy(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'routes', 'proxy-storage.ts'),
    generateStorageProxy(),
    'utf8'
  );

  // Write README
  await fs.writeFile(
    path.join(backendDir, 'README.md'),
    generateReadme(functionNames, Array.from(envVars), {
      hasDocker: config.docker ?? true,
      hasSwagger: config.swagger ?? true,
      hasClustering: config.clustering ?? false,
    }),
    'utf8'
  );

  // Write .gitignore
  const gitignore = `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
`;
  await fs.writeFile(path.join(backendDir, '.gitignore'), gitignore, 'utf8');
}

async function writeAdapter(backendDir: string): Promise<void> {
  const adapter = `import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

/**
 * Convert Express Request to Fetch API Request
 * This allows Deno-style handlers to work with Express
 */
export function createRequest(req: ExpressRequest): Request {
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:3001';
  const baseUrl = process.env.BASE_URL ?? \`\${protocol}://\${host}\`;
  const url = new URL(req.originalUrl, baseUrl);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    }
  }

  const method = req.method.toUpperCase();
  let body: BodyInit | undefined;
  
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (typeof req.body === 'string') {
      body = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      body = req.body;
    } else if (req.body !== undefined && req.body !== null) {
      body = JSON.stringify(req.body);
      // Ensure content-type is set for JSON
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
  }

  return new Request(url.toString(), { method, headers, body });
}

/**
 * Convert Fetch API Response to Express Response
 */
export async function sendResponse(res: ExpressResponse, response: Response): Promise<void> {
  // Set status
  res.status(response.status);

  // Copy headers
  response.headers.forEach((value, key) => {
    // Skip content-encoding as Express handles this
    if (key.toLowerCase() !== 'content-encoding') {
      res.setHeader(key, value);
    }
  });

  // Get content type to determine how to send body
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const json = await response.json();
      res.json(json);
    } catch {
      const text = await response.text();
      res.send(text);
    }
  } else if (contentType.includes('text/')) {
    const text = await response.text();
    res.send(text);
  } else {
    // Binary or other content
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  }
}

/**
 * Create a JSON response helper (matches Deno's Response.json)
 */
export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  const body = JSON.stringify(data);
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  return new Response(body, { ...init, headers });
}

/**
 * CORS headers helper - commonly used in Lovable edge functions
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

/**
 * Create a CORS preflight response
 */
export function corsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
`;

  await fs.writeFile(path.join(backendDir, 'src', 'lib', 'adapter.ts'), adapter, 'utf8');
}

async function writeMiddleware(backendDir: string): Promise<void> {
  const errorHandler = `import type { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err.message);
  
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 ? 'Internal Server Error' : err.message;

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
`;

  const requestLogger = `import morgan from 'morgan';

export const requestLogger = morgan(
  process.env.NODE_ENV === 'production'
    ? 'combined'
    : ':method :url :status :response-time ms'
);
`;

  await fs.writeFile(path.join(backendDir, 'src', 'middleware', 'errorHandler.ts'), errorHandler, 'utf8');
  await fs.writeFile(path.join(backendDir, 'src', 'middleware', 'requestLogger.ts'), requestLogger, 'utf8');
}

async function writeIndex(backendDir: string, config: ConverterConfig): Promise<void> {
  const swaggerImport = config.swagger 
    ? `import { setupSwagger } from './lib/swagger.js';`
    : '';
  
  const swaggerSetup = config.swagger 
    ? `\n// Setup API documentation\nsetupSwagger(app);`
    : '';
  
  const clusterImports = config.clustering
    ? `import { setupCluster } from './utils/cluster.js';`
    : '';
  
  const clusterCheck = config.clustering
    ? `
// Cluster mode for production
if (process.env.CLUSTER_MODE === 'true') {
  if (!setupCluster()) {
    // Primary process - don't start server
    process.exit(0);
  }
}
`
    : '';

  const index = `import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import routes from './routes/index.js';
import { healthRouter } from './routes/health.js';
import { authProxyRouter } from './routes/proxy-auth.js';
import { databaseProxyRouter } from './routes/proxy-database.js';
import { storageProxyRouter } from './routes/proxy-storage.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { setupGracefulShutdown } from './utils/shutdown.js';
${swaggerImport}
${clusterImports}
${clusterCheck}
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ${JSON.stringify(config.cors?.origins ?? ['*'])};

app.use(cors({
  origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? '*' : corsOrigins,
  methods: ${JSON.stringify(config.cors?.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'])},
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-client-info', 
    'apikey', 
    'x-api-key',
    'X-Original-URL',
    'Prefer',
    'Range',
    'X-Supabase-Auth',
    'x-supabase-api-version',
    'x-my-custom-header',
    'Accept',
    'Accept-Language',
    'Content-Language',
  ],
  exposedHeaders: ['Content-Range', 'Range', 'X-Supabase-Api-Version'],
  credentials: ${config.cors?.credentials ?? true},
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: ${config.rateLimit?.windowMs ?? 15 * 60 * 1000}, // ${Math.round((config.rateLimit?.windowMs ?? 15 * 60 * 1000) / 60000)} minutes
  max: process.env.RATE_LIMIT ? parseInt(process.env.RATE_LIMIT) : ${config.rateLimit?.max ?? 100},
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'development',
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: 'text/*' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' }));

// Request logging
app.use(requestLogger);
${swaggerSetup}

// Health routes
app.use(healthRouter);

// Network test endpoint - helps debug connectivity to Supabase
app.get('/test-supabase', async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    return res.status(500).json({ error: 'SUPABASE_URL not configured' });
  }
  
  try {
    console.log('Testing connection to:', supabaseUrl);
    const response = await fetch(\`\${supabaseUrl}/rest/v1/\`, {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY || '',
      },
    });
    res.json({
      status: 'ok',
      supabaseUrl,
      responseStatus: response.status,
      message: 'Successfully connected to Supabase',
    });
  } catch (error) {
    console.error('Supabase connection test failed:', error);
    res.status(500).json({
      status: 'error',
      supabaseUrl,
      error: error instanceof Error ? error.message : 'Unknown error',
      cause: error instanceof Error && 'cause' in error ? String((error as any).cause) : null,
    });
  }
});

// Supabase proxy routes (auth, database, storage)
// These allow the frontend to route all Supabase requests through this backend
app.use('/proxy', authProxyRouter);
app.use('/proxy', databaseProxyRouter);
app.use('/proxy', storageProxyRouter);

// Mount API routes (converted edge functions)
const basePath = process.env.BASE_PATH ?? '/functions/v1';
app.use(basePath, routes);

// Root info
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Express backend converted from Supabase Edge Functions',
    version: process.env.npm_package_version || '1.0.0',
    basePath,
    docs: ${config.swagger ? "'/api-docs'" : 'null'},
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Start server
const port = Number(process.env.PORT ?? ${config.port ?? 3001});
const server = app.listen(port, () => {
  console.log(\`
🚀 Express server running!
   Local:   http://localhost:\${port}
   API:     http://localhost:\${port}\${basePath}
   Health:  http://localhost:\${port}/health${config.swagger ? '\n   Docs:    http://localhost:${port}/api-docs' : ''}
  \`);
});

// Setup graceful shutdown
setupGracefulShutdown(server);
`;

  await fs.writeFile(path.join(backendDir, 'src', 'index.ts'), index, 'utf8');
}

/**
 * Write self-hosted backend scaffold with PostgreSQL, JWT auth, and local/MinIO storage
 */
export async function writeSelfHostedBackendScaffold(
  backendDir: string,
  detectedDependencies: Set<string>,
  envVars: Set<string>,
  options: BackendOptions = {}
): Promise<void> {
  const config = { ...defaultConfig, ...options.config };
  const selfHosted = config.selfHosted || { enabled: true };
  const functionNames = options.functionNames ?? [];
  
  await fs.ensureDir(backendDir);

  // Merge detected dependencies with required base dependencies
  const extraDeps = generateDependenciesObject(detectedDependencies);
  
  // Self-hosted specific dependencies
  const selfHostedDeps: Record<string, string> = {
    '@prisma/client': '^5.11.0',
    'bcrypt': '^5.1.1',
    'jsonwebtoken': '^9.0.2',
    'multer': '^1.4.5-lts.1',
    'mime-types': '^2.1.35',
  };
  
  // Add MinIO if configured
  const storageProvider = selfHosted.storage?.provider || 'local';
  if (storageProvider === 'minio' || storageProvider === 'both') {
    selfHostedDeps['minio'] = '^8.0.0';
  }
  
  // Add optional dependencies based on config
  const optionalDeps: Record<string, string> = {};
  if (config.swagger) {
    optionalDeps['swagger-ui-express'] = '^5.0.0';
  }
  if (config.validation) {
    optionalDeps['zod'] = '^3.22.4';
  }
  
  const pkg = {
    name: 'converted-backend-selfhosted',
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'tsx watch src/index.ts',
      build: 'tsc -p tsconfig.json',
      start: 'node dist/index.js',
      'start:prod': 'NODE_ENV=production node dist/index.js',
      'start:cluster': 'NODE_ENV=production CLUSTER_MODE=true node dist/index.js',
      'db:generate': 'prisma generate',
      'db:push': 'prisma db push',
      'db:migrate': 'prisma migrate dev',
      'db:migrate:deploy': 'prisma migrate deploy',
      'db:studio': 'prisma studio',
      'db:seed': 'tsx prisma/seed.ts',
      lint: 'eslint src --ext .ts',
      test: 'vitest run',
      'test:watch': 'vitest',
      'docker:up': 'docker-compose up -d',
      'docker:down': 'docker-compose down',
      'docker:logs': 'docker-compose logs -f',
    },
    dependencies: {
      cors: '^2.8.5',
      dotenv: '^16.4.1',
      express: '^4.19.2',
      helmet: '^7.1.0',
      'express-rate-limit': '^7.1.5',
      morgan: '^1.10.0',
      ws: '^8.16.0',
      ...selfHostedDeps,
      ...extraDeps,
      ...optionalDeps,
      ...(config.dependencies ?? {})
    },
    devDependencies: {
      '@types/bcrypt': '^5.0.2',
      '@types/cors': '^2.8.17',
      '@types/express': '^4.17.21',
      '@types/jsonwebtoken': '^9.0.6',
      '@types/morgan': '^1.9.9',
      '@types/multer': '^1.4.11',
      '@types/mime-types': '^2.1.4',
      '@types/node': '^20.11.10',
      '@types/swagger-ui-express': '^4.1.6',
      '@types/ws': '^8.5.10',
      'prisma': '^5.11.0',
      'tsx': '^4.7.0',
      'typescript': '^5.4.5',
      'vitest': '^1.3.1'
    },
    prisma: {
      seed: 'tsx prisma/seed.ts'
    }
  };

  await fs.writeJson(path.join(backendDir, 'package.json'), pkg, { spaces: 2 });

  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      rootDir: 'src',
      esModuleInterop: true,
      resolveJsonModule: true,
      lib: ['ES2022', 'DOM'],
      skipLibCheck: true,
      strict: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true
    },
    include: ['src/**/*.ts'],
    exclude: ['node_modules', 'dist']
  };

  await fs.writeJson(path.join(backendDir, 'tsconfig.json'), tsconfig, { spaces: 2 });

  // Generate .env.example for self-hosted mode
  const envExample = generateSelfHostedEnvExample(selfHosted);
  await fs.writeFile(path.join(backendDir, '.env.example'), envExample, 'utf8');
  
  // Create .env from example for development
  await fs.writeFile(path.join(backendDir, '.env'), envExample, 'utf8');

  // Create directory structure
  await fs.ensureDir(path.join(backendDir, 'src', 'handlers'));
  await fs.ensureDir(path.join(backendDir, 'src', 'routes'));
  await fs.ensureDir(path.join(backendDir, 'src', 'lib'));
  await fs.ensureDir(path.join(backendDir, 'src', 'shared'));
  await fs.ensureDir(path.join(backendDir, 'src', 'middleware'));
  await fs.ensureDir(path.join(backendDir, 'src', 'utils'));
  await fs.ensureDir(path.join(backendDir, 'src', 'schemas'));
  await fs.ensureDir(path.join(backendDir, 'src', 'types'));
  await fs.ensureDir(path.join(backendDir, 'src', 'services'));
  await fs.ensureDir(path.join(backendDir, 'prisma'));
  await fs.ensureDir(path.join(backendDir, 'uploads')); // Local storage directory

  // Write Prisma files
  await fs.writeFile(
    path.join(backendDir, 'prisma', 'schema.prisma'),
    generatePrismaSchema({ config: selfHosted }),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'lib', 'prisma.ts'),
    generatePrismaClient(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'lib', 'db-utils.ts'),
    generateDbUtils(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'lib', 'crud-service.ts'),
    generateCrudService(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'lib', 'rest-api-generator.ts'),
    generateRestApiGenerator(),
    'utf8'
  );

  // Write Prisma seed file
  const seedFile = `import prisma from '../src/lib/prisma.js';
import { hashPassword } from '../src/services/auth.js';

async function main() {
  console.log('Seeding database...');
  
  // Create admin user
  const adminPassword = await hashPassword('admin123');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash: adminPassword,
      fullName: 'Admin User',
      emailVerified: true,
      metadata: { role: 'admin' },
    },
  });
  
  console.log('Created admin user:', admin.email);
  
  // Add more seed data here as needed
  
  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
`;
  await fs.writeFile(path.join(backendDir, 'prisma', 'seed.ts'), seedFile, 'utf8');

  // Write auth service and routes
  await fs.writeFile(
    path.join(backendDir, 'src', 'services', 'auth.ts'),
    generateAuthService({ config: selfHosted }),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'routes', 'auth.ts'),
    generateSelfHostedAuthRoutes(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'middleware', 'auth.ts'),
    generateSelfHostedAuthMiddleware(),
    'utf8'
  );

  // Write storage service and routes
  await fs.writeFile(
    path.join(backendDir, 'src', 'services', 'storage.ts'),
    generateStorageService({ config: selfHosted }),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'routes', 'storage.ts'),
    generateStorageRoutes(),
    'utf8'
  );

  // Write adapter (Request/Response bridge)
  await writeAdapter(backendDir);

  // Write middleware
  await writeMiddleware(backendDir);

  // Write main index for self-hosted mode
  await writeSelfHostedIndex(backendDir, config);

  // Write server utilities
  await fs.writeFile(
    path.join(backendDir, 'src', 'utils', 'shutdown.ts'),
    generateGracefulShutdown(),
    'utf8'
  );
  
  // Write clustering support
  await fs.writeFile(
    path.join(backendDir, 'src', 'utils', 'cluster.ts'),
    generateClusterSetup(),
    'utf8'
  );

  // Write enhanced health check for self-hosted
  await fs.writeFile(
    path.join(backendDir, 'src', 'routes', 'health.ts'),
    generateSelfHostedHealthCheck(),
    'utf8'
  );

  // Write validation middleware and schemas
  if (config.validation) {
    await fs.writeFile(
      path.join(backendDir, 'src', 'middleware', 'validation.ts'),
      generateValidationMiddleware(),
      'utf8'
    );
    await fs.writeFile(
      path.join(backendDir, 'src', 'schemas', 'index.ts'),
      generateSchemasIndex(functionNames),
      'utf8'
    );
  }

  // Write Swagger/OpenAPI docs
  if (config.swagger) {
    await fs.writeFile(
      path.join(backendDir, 'src', 'lib', 'swagger.ts'),
      generateSwaggerSetup(),
      'utf8'
    );
    await fs.writeFile(
      path.join(backendDir, 'src', 'openapi.json'),
      generateSelfHostedSwaggerConfig(functionNames),
      'utf8'
    );
  }

  // Write Docker files for self-hosted
  if (config.docker) {
    await fs.writeFile(
      path.join(backendDir, 'Dockerfile'),
      generateSelfHostedDockerfile(),
      'utf8'
    );
    await fs.writeFile(
      path.join(backendDir, 'docker-compose.yml'),
      generateSelfHostedDockerCompose(selfHosted),
      'utf8'
    );
    await fs.writeFile(
      path.join(backendDir, 'docker-compose.dev.yml'),
      generateSelfHostedDockerComposeDev(selfHosted),
      'utf8'
    );
    await fs.writeFile(
      path.join(backendDir, '.dockerignore'),
      generateDockerIgnore(),
      'utf8'
    );
  }

  // Write streaming utilities
  await fs.writeFile(
    path.join(backendDir, 'src', 'lib', 'streaming.ts'),
    generateStreamingUtils(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'types', 'streaming.d.ts'),
    generateStreamingTypes(),
    'utf8'
  );

  // Write WebSocket support
  await fs.writeFile(
    path.join(backendDir, 'src', 'lib', 'websocket.ts'),
    generateWebSocketSetup(),
    'utf8'
  );
  await fs.writeFile(
    path.join(backendDir, 'src', 'types', 'websocket.d.ts'),
    generateWebSocketTypes(),
    'utf8'
  );

  // Write README for self-hosted mode
  await fs.writeFile(
    path.join(backendDir, 'README.md'),
    generateSelfHostedReadme(functionNames, selfHosted),
    'utf8'
  );

  // Write .gitignore
  const gitignore = `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
uploads/
`;
  await fs.writeFile(path.join(backendDir, '.gitignore'), gitignore, 'utf8');

  // Write uploads/.gitkeep
  await fs.writeFile(path.join(backendDir, 'uploads', '.gitkeep'), '', 'utf8');
}

async function writeSelfHostedIndex(backendDir: string, config: ConverterConfig): Promise<void> {
  const swaggerImport = config.swagger 
    ? `import { setupSwagger } from './lib/swagger.js';`
    : '';
  
  const swaggerSetup = config.swagger 
    ? `\n// Setup API documentation\nsetupSwagger(app);`
    : '';
  
  const clusterImports = config.clustering
    ? `import { setupCluster } from './utils/cluster.js';`
    : '';
  
  const clusterCheck = config.clustering
    ? `
// Cluster mode for production
if (process.env.CLUSTER_MODE === 'true') {
  if (!setupCluster()) {
    // Primary process - don't start server
    process.exit(0);
  }
}
`
    : '';

  const index = `import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import routes from './routes/index.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { storageRouter } from './routes/storage.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { setupGracefulShutdown } from './utils/shutdown.js';
${swaggerImport}
${clusterImports}
${clusterCheck}
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ${JSON.stringify(config.cors?.origins ?? ['http://localhost:5173', 'http://localhost:3000'])};

app.use(cors({
  origin: corsOrigins.length === 1 && corsOrigins[0] === '*' ? '*' : corsOrigins,
  methods: ${JSON.stringify(config.cors?.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'])},
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-api-key',
    'Accept',
    'Accept-Language',
    'Content-Language',
  ],
  exposedHeaders: ['Content-Range', 'X-Total-Count', 'X-Page', 'X-Page-Size'],
  credentials: ${config.cors?.credentials ?? true},
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: ${config.rateLimit?.windowMs ?? 15 * 60 * 1000},
  max: process.env.RATE_LIMIT ? parseInt(process.env.RATE_LIMIT) : ${config.rateLimit?.max ?? 100},
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'development',
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: 'text/*' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

// Request logging
app.use(requestLogger);
${swaggerSetup}

// Health routes
app.use(healthRouter);

// Auth routes (self-hosted JWT authentication)
app.use('/auth', authRouter);

// Storage routes (file upload/download)
app.use('/storage', storageRouter);

// Mount API routes (converted edge functions)
const basePath = process.env.BASE_PATH ?? '/functions/v1';
app.use(basePath, routes);

// Root info
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Express Backend (Self-Hosted)',
    version: process.env.npm_package_version || '1.0.0',
    basePath,
    mode: 'self-hosted',
    docs: ${config.swagger ? "'/api-docs'" : 'null'},
    endpoints: {
      auth: '/auth',
      storage: '/storage',
      functions: basePath,
      health: '/health',
    },
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Start server
const port = Number(process.env.PORT ?? ${config.port ?? 3001});
const server = app.listen(port, () => {
  console.log(\`
🚀 Self-Hosted Express server running!
   Local:    http://localhost:\${port}
   API:      http://localhost:\${port}\${basePath}
   Auth:     http://localhost:\${port}/auth
   Storage:  http://localhost:\${port}/storage
   Health:   http://localhost:\${port}/health${config.swagger ? '\n   Docs:     http://localhost:${port}/api-docs' : ''}

📦 Mode: Self-Hosted (PostgreSQL + JWT Auth + File Storage)
  \`);
});

// Setup graceful shutdown
setupGracefulShutdown(server);
`;

  await fs.writeFile(path.join(backendDir, 'src', 'index.ts'), index, 'utf8');
}

function generateSelfHostedHealthCheck(): string {
  return `import { Router } from 'express';
import { checkDatabaseHealth } from '../lib/db-utils.js';

export const healthRouter = Router();

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: { status: 'up' | 'down'; latency?: number };
    memory: { used: number; total: number; percentage: number };
  };
}

healthRouter.get('/health', async (req, res) => {
  const startTime = Date.now();
  
  // Check database
  const dbHealthy = await checkDatabaseHealth();
  const dbLatency = Date.now() - startTime;
  
  // Check memory
  const memUsage = process.memoryUsage();
  const memTotal = require('os').totalmem();
  const memUsed = memTotal - require('os').freemem();
  const memPercentage = Math.round((memUsed / memTotal) * 100);
  
  const status: HealthStatus = {
    status: dbHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      database: {
        status: dbHealthy ? 'up' : 'down',
        latency: dbLatency,
      },
      memory: {
        used: Math.round(memUsed / 1024 / 1024),
        total: Math.round(memTotal / 1024 / 1024),
        percentage: memPercentage,
      },
    },
  };
  
  const httpStatus = status.status === 'healthy' ? 200 : 
                     status.status === 'degraded' ? 200 : 503;
  
  res.status(httpStatus).json(status);
});

// Liveness probe (simple check)
healthRouter.get('/health/live', (req, res) => {
  res.json({ status: 'ok' });
});

// Readiness probe (with dependency checks)
healthRouter.get('/health/ready', async (req, res) => {
  const dbHealthy = await checkDatabaseHealth();
  
  if (dbHealthy) {
    res.json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready', reason: 'database unavailable' });
  }
});
`;
}

function generateSelfHostedSwaggerConfig(functionNames: string[]): string {
  const paths: Record<string, any> = {};
  
  // Auth endpoints
  paths['/auth/signup'] = {
    post: {
      tags: ['Authentication'],
      summary: 'Register a new user',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string', minLength: 8 },
                fullName: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: 'User created successfully' },
        '400': { description: 'Validation error' },
        '409': { description: 'User already exists' },
      },
    },
  };
  
  paths['/auth/signin'] = {
    post: {
      tags: ['Authentication'],
      summary: 'Sign in with email and password',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Authentication successful' },
        '401': { description: 'Invalid credentials' },
      },
    },
  };
  
  paths['/auth/refresh'] = {
    post: {
      tags: ['Authentication'],
      summary: 'Refresh access token',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['refresh_token'],
              properties: {
                refresh_token: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': { description: 'Token refreshed' },
        '401': { description: 'Invalid refresh token' },
      },
    },
  };
  
  paths['/auth/user'] = {
    get: {
      tags: ['Authentication'],
      summary: 'Get current user',
      security: [{ bearerAuth: [] }],
      responses: {
        '200': { description: 'User information' },
        '401': { description: 'Unauthorized' },
      },
    },
  };
  
  // Storage endpoints
  paths['/storage/upload'] = {
    post: {
      tags: ['Storage'],
      summary: 'Upload a file',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                file: { type: 'string', format: 'binary' },
                bucket: { type: 'string' },
                path: { type: 'string' },
                isPublic: { type: 'string', enum: ['true', 'false'] },
              },
            },
          },
        },
      },
      responses: {
        '201': { description: 'File uploaded' },
        '401': { description: 'Unauthorized' },
      },
    },
  };
  
  paths['/storage/download/{id}'] = {
    get: {
      tags: ['Storage'],
      summary: 'Download a file',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': { description: 'File content' },
        '404': { description: 'File not found' },
      },
    },
  };
  
  // Function endpoints
  for (const name of functionNames) {
    paths[`/functions/v1/${name}`] = {
      post: {
        tags: ['Edge Functions'],
        summary: `Invoke ${name} function`,
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
        responses: {
          '200': { description: 'Success' },
          '400': { description: 'Bad request' },
          '401': { description: 'Unauthorized' },
          '500': { description: 'Internal error' },
        },
      },
    };
  }
  
  return JSON.stringify({
    openapi: '3.0.0',
    info: {
      title: 'Self-Hosted Backend API',
      version: '1.0.0',
      description: 'Express backend with PostgreSQL, JWT auth, and file storage',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Development' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    paths,
  }, null, 2);
}

function generateSelfHostedReadme(functionNames: string[], config: SelfHostedConfig): string {
  const storageProvider = config.storage?.provider || 'local';
  const includeMinIO = storageProvider === 'minio' || storageProvider === 'both';
  
  return `# Self-Hosted Express Backend

This backend was generated by the Deno-Express Converter in **self-hosted mode**.

It replaces Supabase with:
- **PostgreSQL** - Database via Prisma ORM
- **JWT Authentication** - Custom auth with bcrypt + jsonwebtoken
- **File Storage** - ${includeMinIO ? 'Local filesystem + MinIO (S3-compatible)' : 'Local filesystem'}

## Quick Start

### 1. Start the database

\`\`\`bash
# Using Docker Compose
npm run docker:up

# Or use an existing PostgreSQL instance
\`\`\`

### 2. Install dependencies

\`\`\`bash
npm install
\`\`\`

### 3. Setup the database

\`\`\`bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# (Optional) Seed the database
npm run db:seed
\`\`\`

### 4. Start the server

\`\`\`bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start
\`\`\`

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | \`/auth/signup\` | Register a new user |
| POST | \`/auth/signin\` | Sign in with email/password |
| POST | \`/auth/signout\` | Sign out |
| POST | \`/auth/refresh\` | Refresh access token |
| GET | \`/auth/user\` | Get current user |
| PUT | \`/auth/user\` | Update user profile |
| POST | \`/auth/change-password\` | Change password |
| POST | \`/auth/recover\` | Request password reset |
| POST | \`/auth/reset-password\` | Reset password with token |

### Storage

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | \`/storage/upload\` | Upload a file |
| POST | \`/storage/upload-multiple\` | Upload multiple files |
| GET | \`/storage/download/:id\` | Download a file |
| GET | \`/storage/public/:id\` | Access public files |
| GET | \`/storage/signed-url/:id\` | Get a signed URL |
| GET | \`/storage/list\` | List user's files |
| DELETE | \`/storage/:id\` | Delete a file |

### Converted Functions

${functionNames.map(fn => `- \`POST /functions/v1/${fn}\``).join('\n')}

## Environment Variables

\`\`\`bash
# Server
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db?schema=public

# JWT
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# Storage
STORAGE_PROVIDER=${storageProvider}
LOCAL_STORAGE_PATH=./uploads
${includeMinIO ? `
# MinIO (optional)
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
STORAGE_BUCKET=app-storage
` : ''}
\`\`\`

## Docker

### Start all services

\`\`\`bash
docker-compose up -d
\`\`\`

### View logs

\`\`\`bash
docker-compose logs -f
\`\`\`

### Stop services

\`\`\`bash
docker-compose down
\`\`\`
${includeMinIO ? `
### MinIO Console

Access MinIO at http://localhost:9001
- Username: minioadmin
- Password: minioadmin
` : ''}

## Database Management

\`\`\`bash
# Open Prisma Studio (GUI)
npm run db:studio

# Create a migration
npm run db:migrate

# Push schema changes (dev only)
npm run db:push

# Deploy migrations (production)
npm run db:migrate:deploy
\`\`\`
`;
}
