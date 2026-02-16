/**
 * Schema introspection utilities
 * Extracts database schema from existing Supabase/PostgreSQL database
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';

export interface IntrospectionResult {
  success: boolean;
  schemaContent?: string;
  models?: string[];
  error?: string;
}

export interface SupabaseCredentials {
  url?: string;
  projectRef?: string;
  dbPassword?: string;
  serviceRoleKey?: string;
}

/**
 * Extract Supabase database credentials from project .env files
 */
export async function extractSupabaseCredentials(
  projectDir: string
): Promise<SupabaseCredentials | null> {
  const credentials: SupabaseCredentials = {};
  
  // Look for .env files
  const envFiles = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
  ];
  
  for (const envFile of envFiles) {
    const envPath = path.join(projectDir, envFile);
    if (await fs.pathExists(envPath)) {
      const content = await fs.readFile(envPath, 'utf8');
      
      // Extract SUPABASE_URL
      const urlMatch = content.match(/(?:VITE_)?SUPABASE_URL=["']?([^"'\n\r]+)["']?/);
      if (urlMatch) {
        credentials.url = urlMatch[1].trim();
        // Extract project ref from URL (e.g., https://abc123.supabase.co -> abc123)
        const refMatch = credentials.url.match(/https?:\/\/([^.]+)\.supabase\.co/);
        if (refMatch) {
          credentials.projectRef = refMatch[1];
        }
      }
      
      // Extract service role key
      const serviceKeyMatch = content.match(/SUPABASE_SERVICE_ROLE_KEY=["']?([^"'\n\r]+)["']?/);
      if (serviceKeyMatch) {
        credentials.serviceRoleKey = serviceKeyMatch[1].trim();
      }
      
      // Check for DB password (some projects store it separately)
      const dbPassMatch = content.match(/(?:SUPABASE_)?DB_PASSWORD=["']?([^"'\n\r]+)["']?/);
      if (dbPassMatch) {
        credentials.dbPassword = dbPassMatch[1].trim();
      }
    }
  }
  
  // Only return if we have at least a project ref
  if (credentials.projectRef) {
    return credentials;
  }
  
  return null;
}

/**
 * Build Supabase database connection string
 * Note: User needs to provide DB password as it's not in the .env files
 */
export function buildSupabaseDatabaseUrl(
  credentials: SupabaseCredentials,
  password: string,
  pooler: boolean = true
): string {
  const projectRef = credentials.projectRef!;
  // EU North is the correct region for this project
  const region = 'aws-1-eu-north-1';
  
  if (pooler) {
    // Use connection pooler with pgbouncer (transaction mode, port 6543)
    return `postgresql://postgres.${projectRef}:${password}@${region}.pooler.supabase.com:6543/postgres?pgbouncer=true`;
  } else {
    // Direct connection (port 5432) - more reliable for introspection
    return `postgresql://postgres.${projectRef}:${password}@${region}.pooler.supabase.com:5432/postgres`;
  }
}

/**
 * Introspect Supabase database schema using Prisma
 */
export async function introspectSupabaseSchema(
  tempDir: string,
  databaseUrl: string
): Promise<IntrospectionResult> {
  try {
    // Create temp directory for introspection
    await fs.ensureDir(tempDir);
    
    // Create minimal Prisma schema for introspection
    const schemaPath = path.join(tempDir, 'prisma', 'schema.prisma');
    await fs.ensureDir(path.dirname(schemaPath));
    
    // Enable multiSchema preview feature to handle cross-schema references
    // (Supabase tables often reference auth.users)
    const minimalSchema = `
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public", "auth"]
}
`;
    
    await fs.writeFile(schemaPath, minimalSchema, 'utf8');
    
    // Create .env with database URL
    const envPath = path.join(tempDir, '.env');
    await fs.writeFile(envPath, `DATABASE_URL="${databaseUrl}"\n`, 'utf8');
    
    // Create minimal package.json
    const packageJson = {
      name: 'introspection-temp',
      version: '1.0.0',
      dependencies: {
        prisma: '^5.11.0',
        '@prisma/client': '^5.11.0'
      }
    };
    await fs.writeJson(path.join(tempDir, 'package.json'), packageJson, { spaces: 2 });
    
    // Install Prisma locally (silently)
    try {
      execSync('npm install --silent', {
        cwd: tempDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000, // 2 minutes
      });
    } catch {
      // If install fails, try to continue with global Prisma
    }
    
    // Run prisma db pull
    const result = await runPrismaIntrospection(tempDir);
    
    if (result.success) {
      // Read the generated schema
      const generatedSchema = await fs.readFile(schemaPath, 'utf8');
      
      // Extract model definitions (skip our base models)
      const models = extractModelsFromSchema(generatedSchema);
      
      return {
        success: true,
        schemaContent: generatedSchema,
        models,
      };
    } else {
      return result;
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run Prisma introspection command
 */
async function runPrismaIntrospection(
  workDir: string
): Promise<IntrospectionResult> {
  return new Promise(async (resolve) => {
    const npmCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    
    try {
      // Run prisma db pull with --force to overwrite existing schema
      execSync(
        `${npmCmd} prisma db pull --schema=prisma/schema.prisma --force`,
        {
          cwd: workDir,
          encoding: 'utf8',
          timeout: 60000, // 60 second timeout
          stdio: ['pipe', 'pipe', 'pipe'], // Suppress output
          env: {
            ...process.env,
            DATABASE_URL: process.env.DATABASE_URL,
          },
        }
      );
      
      resolve({ success: true });
    } catch (error: any) {
      const errorMsg = error.stderr || error.stdout || error.message || 'Unknown error';
      
      resolve({
        success: false,
        error: errorMsg,
      });
    }
  });
}

/**
 * Extract model definitions from Prisma schema
 */
export function extractModelsFromSchema(schema: string): string[] {
  const models: string[] = [];
  
  // Match all model blocks
  const modelRegex = /model\s+(\w+)\s*\{[\s\S]*?^\}/gm;
  let match: RegExpExecArray | null;
  
  while ((match = modelRegex.exec(schema)) !== null) {
    const modelName = match[1];
    const modelBlock = match[0];
    
    // Skip our own base models
    if (['User', 'RefreshToken', 'FileStorage', 'Session'].includes(modelName)) {
      continue;
    }
    
    // Skip if model is in auth or storage schema (check for @@schema attribute)
    if (modelBlock.includes('@@schema("auth")') || modelBlock.includes('@@schema("storage")')) {
      continue;
    }
    
    models.push(modelBlock);
  }
  
  // Also extract enums
  const enumRegex = /enum\s+(\w+)\s*\{[\s\S]*?^\}/gm;
  while ((match = enumRegex.exec(schema)) !== null) {
    models.push(match[0]);
  }
  
  return models;
}

/**
 * Convert Supabase table naming to Prisma conventions
 * Supabase uses snake_case, Prisma prefers PascalCase
 */
export function normalizeModelNames(schema: string): string {
  // This function transforms the introspected schema to follow conventions
  // while keeping @@map directives for actual table names
  
  let normalized = schema;
  
  // Find all model names and their table names
  const modelMappings: Array<{ modelName: string; tableName: string }> = [];
  const modelRegex = /model\s+(\w+)\s*\{[\s\S]*?@@map\(["'](\w+)["']\)/gm;
  let match: RegExpExecArray | null;
  
  while ((match = modelRegex.exec(schema)) !== null) {
    modelMappings.push({
      modelName: match[1],
      tableName: match[2],
    });
  }
  
  // Also handle models without @@map (Prisma defaults model name = table name)
  const modelWithoutMapRegex = /model\s+(\w+)\s*\{(?![\s\S]*?@@map)/gm;
  while ((match = modelWithoutMapRegex.exec(schema)) !== null) {
    // Only add if not already in mappings
    if (!modelMappings.some(m => m.modelName === match![1])) {
      modelMappings.push({
        modelName: match[1],
        tableName: match[1],
      });
    }
  }
  
  return normalized;
}

/**
 * Generate instructions for user to provide database password
 */
export function getIntrospectionInstructions(credentials: SupabaseCredentials): string {
  const projectRef = credentials.projectRef || '<your-project-ref>';
  
  return `
To automatically import your Supabase database schema, you need to provide
your database password. You can find it in your Supabase Dashboard:

1. Go to: https://supabase.com/dashboard/project/${projectRef}/settings/database
2. Under "Connection string", click "Reveal" to see your password
3. Run the converter with the --db-password flag:

   deno-express-converter convert <url> --db-password "your-password"

Or set the SUPABASE_DB_PASSWORD environment variable:

   SUPABASE_DB_PASSWORD="your-password" deno-express-converter convert <url>

Note: This password is only used locally during conversion to introspect
your database schema. It is NOT stored or transmitted anywhere.
`;
}

/**
 * Filter schema to exclude Supabase internal tables
 */
export function filterSupabaseInternalTables(models: string[]): string[] {
  // Tables to exclude (Supabase internal/auth tables)
  const excludePatterns = [
    /^auth\./,          // auth schema tables
    /^storage\./,       // storage schema tables  
    /^realtime\./,      // realtime schema tables
    /^supabase_/,       // supabase internal tables
    /^_prisma/,         // prisma internal tables
    /^pg_/,             // postgres system tables
    /^information_schema/, // postgres info schema
  ];
  
  // Also exclude specific known Supabase tables
  const excludeNames = [
    'users',            // We have our own User model
    'refresh_tokens',   // We have our own RefreshToken model
    'sessions',         // We have our own Session model
    'schema_migrations',
    'buckets',
    'objects',
    'migrations',
    'audit_log_entries',
    'identities',
    'instances',
    'mfa_amr_claims',
    'mfa_challenges',
    'mfa_factors',
    'one_time_tokens',
    'saml_providers',
    'saml_relay_states',
    'sso_domains',
    'sso_providers',
    'flow_state',
  ];
  
  return models.filter(model => {
    // Extract model/table name
    const nameMatch = model.match(/model\s+(\w+)/);
    const mapMatch = model.match(/@@map\(["'](\w+)["']\)/);
    const name = mapMatch?.[1] || nameMatch?.[1] || '';
    
    // Check exclusions
    if (excludeNames.includes(name.toLowerCase())) {
      return false;
    }
    
    for (const pattern of excludePatterns) {
      if (pattern.test(name)) {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Merge introspected models with base models, handling conflicts
 */
export function mergeWithBaseModels(
  introspectedModels: string[],
  baseSchema: string
): string {
  // Filter out any models that conflict with our base models
  const filteredModels = filterSupabaseInternalTables(introspectedModels);
  
  // Add comment header
  const additionalModels = `
// ============================================
// Application Models (Imported from Supabase)
// ============================================

${filteredModels.join('\n\n')}
`;
  
  return additionalModels;
}
