# Deno → Express Converter

A CLI tool that automatically converts Supabase Edge Functions (Deno) from Lovable-generated projects into a fully functional Express.js backend.

## Features

- 🔄 **Automatic AST Transformation** - Uses jscodeshift to convert Deno syntax to Node.js
- 📦 **Dependency Detection** - Extracts and converts `npm:` imports to standard npm packages
- 🔐 **Environment Variable Mapping** - Detects `Deno.env.get()` calls and maps to `process.env`
- 🌐 **Frontend Integration** - Updates frontend code to use the new Express backend
- 📁 **Shared Code Support** - Handles `_shared/` directory from Supabase functions
- 🛡️ **Production Ready** - Includes security middleware, rate limiting, and error handling
- 🏠 **Self-Hosted Mode** - Optionally replace Supabase entirely with PostgreSQL + custom auth

## Self-Hosted Mode (NEW!)

The `--self-hosted` flag generates a **completely self-contained backend** that doesn't depend on Supabase at all:

### What it replaces:

| Supabase Feature | Self-Hosted Replacement |
|-----------------|-------------------------|
| Supabase Auth | JWT-based auth with bcrypt + jsonwebtoken |
| Supabase Database | PostgreSQL via Prisma ORM |
| Supabase Storage | Local filesystem or MinIO (S3-compatible) |
| Edge Functions | Express.js handlers (same as standard mode) |

### Quick Start

```bash
# Convert with self-hosted mode
npm run dev -- https://github.com/user/project --self-hosted

# Or with MinIO storage
npm run dev -- https://github.com/user/project --self-hosted --storage-provider both
```

### CLI Options for Self-Hosted Mode

| Option | Description | Default |
|--------|-------------|---------|
| `--self-hosted` | Enable self-hosted mode | `false` |
| `--storage-provider <type>` | `local`, `minio`, or `both` | `local` |
| `--minio-bucket <name>` | MinIO bucket name | `files` |
| `--db-name <name>` | PostgreSQL database name | `app` |

### Self-Hosted Generated Structure

```
backend/
├── prisma/
│   └── schema.prisma      # Database schema
├── src/
│   ├── handlers/          # Converted edge functions
│   ├── routes/
│   │   ├── auth.ts        # JWT auth endpoints
│   │   ├── storage.ts     # File storage endpoints
│   │   └── functions.ts   # Function endpoints
│   ├── lib/
│   │   ├── prisma.ts      # Prisma client
│   │   └── auth.ts        # JWT utilities
│   ├── services/
│   │   ├── auth.service.ts
│   │   └── storage.service.ts
│   └── index.ts
├── docker-compose.yml     # PostgreSQL + optional MinIO
├── Dockerfile
└── package.json
```

### API Endpoints (Self-Hosted)

**Authentication:**
- `POST /auth/signup` - Register
- `POST /auth/signin` - Login
- `POST /auth/signout` - Logout
- `POST /auth/refresh` - Refresh tokens
- `GET /auth/user` - Get current user
- `PUT /auth/user` - Update profile
- `POST /auth/change-password` - Change password

**Storage:**
- `POST /storage/upload` - Upload file
- `GET /storage/download/:id` - Download file
- `GET /storage/public/:id` - Public file access
- `DELETE /storage/:id` - Delete file

### Setup Steps (Self-Hosted)

```bash
cd <project>/backend

# Start PostgreSQL (and MinIO if configured)
docker-compose up -d

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate deploy

# Install dependencies
npm install

# Start server
npm run dev
```

### Frontend Changes (Self-Hosted)

The converter creates an API client that replaces Supabase SDK:

```typescript
// Before (Supabase)
import { supabase } from './supabase';
const { data: { user } } = await supabase.auth.getUser();

// After (Self-Hosted)
import { auth } from './lib/api';
const { data: user } = await auth.getUser();
```

## Installation

```bash
cd converter
npm install
```

## Usage

### Basic Usage

```bash
npm run dev -- https://github.com/user/lovable-project
```

### With Options

```bash
npm run dev -- https://github.com/user/lovable-project \
  --out my-project \
  --verbose
```

### Options

| Option | Description |
|--------|-------------|
| `-o, --out <dir>` | Output directory (defaults to repo name) |
| `--skip-frontend` | Skip frontend integration updates |
| `--skip-docker` | Skip Docker file generation |
| `--skip-swagger` | Skip OpenAPI/Swagger generation |
| `--enable-clustering` | Enable Node.js clustering support |
| `--self-hosted` | Enable self-hosted mode (PostgreSQL instead of Supabase) |
| `--storage-provider <p>` | Storage provider: `local`, `minio`, or `both` |
| `--minio-bucket <name>` | MinIO default bucket name |
| `--db-name <name>` | PostgreSQL database name |
| `-v, --verbose` | Enable verbose logging |
| `--dry-run` | Analyze without making changes |
| `--no-auto-run` | Skip auto npm install and server start |

## What It Converts

### Deno Patterns → Node.js Equivalents

| Deno | Node.js |
|------|---------|
| `Deno.env.get("VAR")` | `process.env["VAR"]` |
| `Deno.env.toObject()` | `process.env` |
| `serve((req) => ...)` | `export default handler` |
| `Deno.serve(...)` | `export default handler` |
| `npm:package@version` | `package` |
| `jsr:@scope/pkg` | `@scope/pkg` |
| `https://esm.sh/pkg` | `pkg` |
| `.ts` imports | `.js` imports |

### Generated Backend Structure

```
backend/
├── src/
│   ├── handlers/          # Converted edge functions
│   │   └── function-name/
│   │       └── index.ts
│   ├── routes/            # Express route files
│   │   ├── index.ts
│   │   └── function-name.ts
│   ├── lib/
│   │   └── adapter.ts     # Request/Response bridge
│   ├── middleware/
│   │   ├── errorHandler.ts
│   │   └── requestLogger.ts
│   ├── shared/            # Converted _shared code
│   └── index.ts           # Express app entry
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## How It Works

1. **Clone Repository** - Clones the source repo to a local directory
2. **Detect Structure** - Finds `supabase/functions/` and frontend directories
3. **Analyze Functions** - Extracts dependencies, env vars, and shared code usage
4. **Transform Code** - Applies AST transformations using jscodeshift
5. **Generate Backend** - Creates Express.js project with proper structure
6. **Update Frontend** - Modifies frontend to use new backend URLs

## Express Adapter

The converter creates an adapter that bridges Fetch API `Request`/`Response` (used by Deno) to Express:

```typescript
// Your Deno handler (unchanged logic)
export default async function handler(req: Request): Promise<Response> {
  const body = await req.json();
  return new Response(JSON.stringify({ data: body }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Express route (auto-generated)
router.all('/function-name', async (req, res, next) => {
  const request = createRequest(req);  // Express → Fetch Request
  const response = await handler(request);
  await sendResponse(res, response);    // Fetch Response → Express
});
```

## Frontend Integration

The tool creates a helper function for the frontend:

```typescript
// Before (Supabase)
const { data } = await supabase.functions.invoke('my-function', {
  body: { name: 'test' }
});

// After (converted)
const { data } = await invokeFn('my-function', {
  body: { name: 'test' }
});
```

## Post-Conversion Steps

1. Navigate to the backend directory:
   ```bash
   cd <project>/backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

4. Start development server:
   ```bash
   npm run dev
   ```

5. Test endpoints:
   ```bash
   curl http://localhost:3001/functions/v1/health
   curl http://localhost:3001/functions/v1/your-function
   ```

## Supported Edge Function Patterns

- ✅ `serve()` from `std/http/server`
- ✅ `Deno.serve()` (newer pattern)
- ✅ CORS preflight handling
- ✅ JSON request/response
- ✅ Streaming responses
- ✅ Error handling with try/catch
- ✅ Shared code in `_shared/` directory
- ✅ Environment variables
- ✅ npm/jsr/esm.sh imports

## Limitations

- WebSocket handlers require manual adjustment
- Deno-specific APIs (Deno.readFile, etc.) need manual conversion
- Some edge cases in TypeScript generics may need review

## License

MIT
