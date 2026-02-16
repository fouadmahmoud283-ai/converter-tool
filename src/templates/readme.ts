/**
 * README generator for converted backend
 */

export function generateReadme(
  functionNames: string[],
  envVars: string[],
  options: {
    hasDocker: boolean;
    hasSwagger: boolean;
    hasClustering: boolean;
  }
): string {
  const functionsTable = functionNames
    .map(fn => `| \`POST /${fn}\` | ${fn.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} |`)
    .join('\n');

  const envTable = envVars
    .map(v => `| \`${v}\` | Required | - |`)
    .join('\n');

  return `# Converted Express Backend

This Express.js backend was automatically converted from Supabase Edge Functions using the [Deno to Express Converter](https://github.com/your-org/deno-express-converter).

## 🚀 Quick Start

\`\`\`bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your values

# Start development server
npm run dev
\`\`\`

The server will start at \`http://localhost:3000\`

## 📚 API Endpoints

| Endpoint | Description |
|----------|-------------|
| \`GET /\` | Server info |
| \`GET /health\` | Health check |
| \`GET /health/detailed\` | Detailed health status |
${options.hasSwagger ? '| `GET /api-docs` | Swagger UI documentation |' : ''}
${functionsTable}

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
${envTable}
| \`PORT\` | No | Server port (default: 3000) |
| \`NODE_ENV\` | No | Environment (development/production) |
| \`CORS_ORIGIN\` | No | Comma-separated allowed origins |
| \`RATE_LIMIT\` | No | Max requests per 15 minutes |
| \`BASE_PATH\` | No | API base path (default: /functions/v1) |

## 📦 Available Scripts

| Script | Description |
|--------|-------------|
| \`npm run dev\` | Start development server with hot reload |
| \`npm run build\` | Build TypeScript to JavaScript |
| \`npm start\` | Start production server |
| \`npm run start:prod\` | Start in production mode |
${options.hasClustering ? '| `npm run start:cluster` | Start with multi-core clustering |' : ''}
| \`npm test\` | Run tests |
| \`npm run lint\` | Lint code |

${options.hasDocker ? `## 🐳 Docker

\`\`\`bash
# Build and run with Docker Compose
docker-compose up --build

# Or build image manually
docker build -t my-backend .
docker run -p 3000:3000 --env-file .env my-backend
\`\`\`
` : ''}

## 🔒 Authentication

The backend includes authentication middleware for Supabase JWT tokens:

\`\`\`typescript
import { requireAuth, optionalAuth, requireRole } from './middleware/auth';

// Require authentication
router.post('/protected', requireAuth, handler);

// Optional authentication
router.get('/public', optionalAuth, handler);

// Role-based access
router.post('/admin', requireAuth, requireRole('admin'), handler);
\`\`\`

## 📝 Request Validation

Use Zod schemas for request validation:

\`\`\`typescript
import { validateBody } from './middleware/validation';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

router.post('/users', validateBody(schema), handler);
\`\`\`

${options.hasSwagger ? `## 📖 API Documentation

Visit \`/api-docs\` for interactive Swagger documentation.

The OpenAPI spec is available at \`/api-docs/openapi.json\`.
` : ''}

## 🏗️ Project Structure

\`\`\`
backend/
├── src/
│   ├── handlers/        # Request handlers (converted edge functions)
│   ├── routes/          # Express route definitions
│   ├── middleware/      # Express middleware
│   │   ├── auth.ts      # Authentication middleware
│   │   ├── validation.ts # Request validation
│   │   └── errorHandler.ts
│   ├── lib/             # Utilities and adapters
│   │   ├── adapter.ts   # Deno Request/Response adapter
│   │   └── swagger.ts   # Swagger setup
│   ├── schemas/         # Zod validation schemas
│   ├── shared/          # Shared code (from _shared)
│   ├── utils/           # Server utilities
│   └── index.ts         # Entry point
├── openapi.json         # OpenAPI specification
├── Dockerfile           # Production Docker image
├── docker-compose.yml   # Docker Compose config
└── .env.example         # Environment variables template
\`\`\`

## 🔄 Migrating from Supabase Edge Functions

The conversion process:

1. **Handlers**: Each edge function is converted to an Express handler
2. **Request/Response**: Deno's web standard \`Request\`/\`Response\` is adapted
3. **Imports**: Deno imports are converted to npm packages
4. **Environment**: \`Deno.env.get()\` → \`process.env\`
5. **Shared code**: \`_shared\` folder is moved to \`src/shared\`

## 📄 License

MIT
`;
}
