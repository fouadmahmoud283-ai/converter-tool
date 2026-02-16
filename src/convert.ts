import path from 'node:path';
import fs from 'fs-extra';
import fg from 'fast-glob';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { simpleGit } from 'simple-git';
import kleur from 'kleur';

import { repoNameFromUrl } from './utils/repo.js';
import { writeBackendScaffold, writeSelfHostedBackendScaffold } from './templates/backend.js';
import { updateFrontendIntegration } from './templates/frontend.js';
import { updateFrontendForSelfHosted } from './templates/frontend-selfhosted.js';
import { extractDependencies } from './utils/dependencies.js';
import { extractEnvVariables } from './utils/env.js';
import { Logger } from './utils/logger.js';
import { ConverterConfig, defaultConfig } from './config.js';
import { autoSetupAndRun, autoSetupSelfHosted } from './utils/autorun.js';
import {
  extractSupabaseCredentials,
  buildSupabaseDatabaseUrl,
  introspectSupabaseSchema,
  extractModelsFromSchema,
  filterSupabaseInternalTables,
  mergeWithBaseModels,
  getIntrospectionInstructions
} from './utils/schema-introspection.js';

const require = createRequire(import.meta.url);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const transformPath = path.resolve(currentDir, '..', 'transforms', 'deno-to-handler.cjs');
const transform = require(transformPath);

export type ConvertOptions = {
  repoUrl: string;
  outDir?: string;
  skipFrontend?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  config?: Partial<ConverterConfig>;
  autoRun?: boolean; // Auto install deps and start servers
  dbPassword?: string; // Supabase database password for schema introspection
  skipIntrospection?: boolean; // Skip Supabase schema introspection
};

export type FunctionInfo = {
  name: string;
  entryFile: string;
  files: string[];
  dependencies: Set<string>;
  envVars: Set<string>;
  hasSharedImports: boolean;
};

export async function convertRepository(options: ConvertOptions): Promise<void> {
  const logger = new Logger(options.verbose ?? false);
  const config = { ...defaultConfig, ...options.config };
  const repoName = repoNameFromUrl(options.repoUrl);
  const targetDir = path.resolve(process.cwd(), options.outDir ?? repoName);

  if (await fs.pathExists(targetDir)) {
    throw new Error(`Target directory already exists: ${targetDir}`);
  }

  logger.info(`Cloning ${options.repoUrl}...`);
  await simpleGit().clone(options.repoUrl, targetDir);

  // Detect project structure
  const projectInfo = await detectProjectStructure(targetDir, logger);
  
  if (!projectInfo.functionsDir) {
    throw new Error(`No supabase/functions directory found. This doesn't appear to be a Lovable project with Edge Functions.`);
  }

  // Filter excluded functions
  const filteredFunctions = projectInfo.functions.filter(
    fn => !(config.exclude ?? []).includes(fn)
  );
  
  logger.info(`Detected ${filteredFunctions.length} edge function(s)${config.exclude?.length ? ` (${config.exclude.length} excluded)` : ''}`);
  if (projectInfo.frontendDir) {
    logger.info(`Frontend detected at: ${path.relative(targetDir, projectInfo.frontendDir)}`);
  }

  // Analyze all functions
  const functionsInfo = await analyzeFunctions(projectInfo.functionsDir, logger, filteredFunctions);
  
  // Collect all dependencies and env vars
  const allDependencies = new Set<string>();
  const allEnvVars = new Set<string>();
  
  for (const fn of functionsInfo) {
    fn.dependencies.forEach((d) => allDependencies.add(d));
    fn.envVars.forEach((e) => allEnvVars.add(e));
  }

  logger.info(`Found ${allDependencies.size} unique dependencies`);
  logger.info(`Found ${allEnvVars.size} environment variables`);

  if (options.dryRun) {
    logger.info('Dry run mode - no files will be written');
    printDryRunReport(functionsInfo, allDependencies, allEnvVars);
    return;
  }

  // Create backend directory
  const backendDir = path.join(targetDir, config.outputDir ?? 'backend');
  
  // Schema introspection
  let introspectedModels: string[] = [];
  
  if (!options.skipIntrospection) {
    const supabaseCreds = await extractSupabaseCredentials(targetDir);
    
    if (supabaseCreds && options.dbPassword) {
      logger.info('🔍 Attempting to introspect Supabase database schema...');
      const dbUrl = buildSupabaseDatabaseUrl(supabaseCreds, options.dbPassword);
      
      // Use a temp directory for introspection (will be cleaned up)
      const tempIntrospectDir = path.join(targetDir, '.introspection-temp');
      const introspectionResult = await introspectSupabaseSchema(tempIntrospectDir, dbUrl);
      
      // Clean up temp directory
      await fs.remove(tempIntrospectDir);
      
      if (introspectionResult.success && introspectionResult.schemaContent) {
        const allModels = extractModelsFromSchema(introspectionResult.schemaContent);
        introspectedModels = filterSupabaseInternalTables(allModels);
        
        // Extract model names for logging
        const modelNames = introspectedModels.map(m => {
          const match = m.match(/model\s+(\w+)/);
          return match ? match[1] : 'Unknown';
        });
        logger.success(`✅ Introspected ${introspectedModels.length} database model(s): ${modelNames.join(', ')}`);
      } else if (introspectionResult.error) {
        logger.warn(`⚠️ Schema introspection failed: ${introspectionResult.error}`);
        logger.info('Proceeding with base models only. You can add models manually later.');
      }
    } else if (supabaseCreds && !options.dbPassword) {
      // Supabase credentials found but no password provided
      logger.info('');
      logger.info('💡 ' + getIntrospectionInstructions(supabaseCreds));
      logger.info('');
    }
  }
  
  // Always use self-hosted mode (full migration)
  logger.info('🏠 Creating self-hosted backend (PostgreSQL + Prisma)...');
  await writeSelfHostedBackendScaffold(backendDir, allDependencies, allEnvVars, {
    config: config as ConverterConfig,
    functionNames: functionsInfo.map(fn => fn.name),
    additionalModels: introspectedModels,
  });

  // Copy and transform shared code first
  if (projectInfo.sharedDir) {
    await copySharedCode(projectInfo.sharedDir, backendDir, logger);
  }

  // Process each function
  const routes: { name: string; methods: string[] }[] = [];

  for (const fnInfo of functionsInfo) {
    logger.info(`Processing function: ${fnInfo.name}`);
    await processFunction(fnInfo, projectInfo.functionsDir, backendDir, logger);
    routes.push({ name: fnInfo.name, methods: ['all'] });
  }

  // Generate routes index
  await writeRoutesIndex(backendDir, routes);

  // Update frontend if present
  if (!options.skipFrontend && config.updateFrontend !== false && projectInfo.frontendDir) {
    logger.info('Updating frontend integration...');
    // Always use self-hosted frontend client
    await updateFrontendForSelfHosted(targetDir, projectInfo.frontendDir, logger);
  }

  // Generate migration report
  await writeMigrationReport(targetDir, functionsInfo, allEnvVars);

  logger.success('Conversion complete!');
  logger.success(`Backend created at: ${backendDir}`);
  
  logger.info('\n🏠 Self-hosted backend created:');
  logger.info('   - PostgreSQL database via Docker');
  logger.info('   - JWT-based authentication');
  logger.info(`   - Storage: ${config.selfHosted?.storage?.provider || 'local'}`);
  if (config.selfHosted?.storage?.provider === 'minio' || config.selfHosted?.storage?.provider === 'both') {
    logger.info('   - MinIO S3-compatible storage');
  }
  
  if (config.swagger) {
    logger.info('\n📚 API documentation will be available at /api-docs');
  }
  if (config.docker) {
    logger.info('🐳 Docker files generated. Build with: docker-compose up --build');
  }

  // Run automatic setup
  await autoSetupSelfHosted({
    backendDir,
    frontendDir: projectInfo.frontendDir,
    projectDir: targetDir,
    logger,
    storageProvider: config.selfHosted?.storage?.provider
  });
}

type ProjectInfo = {
  functionsDir: string | null;
  sharedDir: string | null;
  frontendDir: string | null;
  functions: string[];
};

async function detectProjectStructure(targetDir: string, logger: Logger): Promise<ProjectInfo> {
  const result: ProjectInfo = {
    functionsDir: null,
    sharedDir: null,
    frontendDir: null,
    functions: []
  };

  // Check for supabase/functions
  const functionsDir = path.join(targetDir, 'supabase', 'functions');
  if (await fs.pathExists(functionsDir)) {
    result.functionsDir = functionsDir;
    
    // List function folders
    const entries = await fg(['*'], { cwd: functionsDir, onlyDirectories: true, deep: 1 });
    result.functions = entries.filter((e) => !e.startsWith('_'));
    
    // Check for _shared folder
    const sharedDir = path.join(functionsDir, '_shared');
    if (await fs.pathExists(sharedDir)) {
      result.sharedDir = sharedDir;
      logger.debug('Found _shared directory');
    }
  }

  // Detect frontend - Lovable typically uses root as frontend or has src/
  const frontendIndicators = [
    'src/App.tsx',
    'src/main.tsx',
    'index.html',
    'vite.config.ts',
    'vite.config.js',
    'package.json'
  ];

  for (const indicator of frontendIndicators) {
    if (await fs.pathExists(path.join(targetDir, indicator))) {
      result.frontendDir = targetDir;
      break;
    }
  }

  // Also check for separate frontend folder
  const frontendFolder = path.join(targetDir, 'frontend');
  if (await fs.pathExists(frontendFolder)) {
    result.frontendDir = frontendFolder;
  }

  return result;
}

async function analyzeFunctions(
  functionsDir: string, 
  logger: Logger,
  functionNames?: string[]
): Promise<FunctionInfo[]> {
  const results: FunctionInfo[] = [];
  const allFolders = await fg(['*'], { cwd: functionsDir, onlyDirectories: true, deep: 1 });
  
  // Filter to only specified functions, or all non-internal folders
  const functionFolders = functionNames 
    ? allFolders.filter(f => functionNames.includes(f))
    : allFolders.filter(f => !f.startsWith('_'));

  for (const folderName of functionFolders) {
    if (folderName.startsWith('_')) continue;

    const fnDir = path.join(functionsDir, folderName);
    const entryFile = await findEntryFile(fnDir);
    
    if (!entryFile) {
      logger.warn(`Skipping ${folderName}: no entry file found`);
      continue;
    }

    // Get all files in the function directory
    const files = await fg(['**/*.{ts,tsx,js,jsx}'], { cwd: fnDir, onlyFiles: true });
    
    // Analyze dependencies and env vars
    const dependencies = new Set<string>();
    const envVars = new Set<string>();
    let hasSharedImports = false;

    for (const file of files) {
      const filePath = path.join(fnDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      
      extractDependencies(content).forEach((d) => dependencies.add(d));
      extractEnvVariables(content).forEach((e) => envVars.add(e));
      
      if (content.includes('../_shared') || content.includes('/_shared/')) {
        hasSharedImports = true;
      }
    }

    results.push({
      name: folderName,
      entryFile,
      files,
      dependencies,
      envVars,
      hasSharedImports
    });
  }

  return results;
}

async function processFunction(
  fnInfo: FunctionInfo,
  functionsDir: string,
  backendDir: string,
  logger: Logger
): Promise<void> {
  const sourceDir = path.join(functionsDir, fnInfo.name);
  const targetHandlerDir = path.join(backendDir, 'src', 'handlers', fnInfo.name);

  await fs.ensureDir(targetHandlerDir);

  // Copy all files except env files
  await fs.copy(sourceDir, targetHandlerDir, {
    filter: (filePath) => {
      const base = path.basename(filePath);
      return !['.env', '.env.local', '.env.example', 'deno.json', 'deno.jsonc'].includes(base);
    }
  });

  // Transform all TypeScript/JavaScript files
  const tsFiles = await fg(['**/*.{ts,tsx,js,jsx}'], { cwd: targetHandlerDir, onlyFiles: true });
  
  for (const file of tsFiles) {
    const filePath = path.join(targetHandlerDir, file);
    const content = await fs.readFile(filePath, 'utf8');
    
    try {
      const transformed = applyTransform(filePath, content);
      
      // Fix shared imports to point to new location
      // Handlers are at src/handlers/<name>/index.ts
      // Shared is at src/shared/
      // So ../_shared becomes ../../shared
      const fixedContent = transformed
        .replace(/from\s+['"]\.\.\/\_shared\/([^'"]+)['"]/g, "from '../../shared/$1'")
        .replace(/from\s+["']\.\.\/\_shared\/([^"']+)["']/g, 'from "../../shared/$1"');
      
      await fs.writeFile(filePath, fixedContent, 'utf8');
      logger.debug(`Transformed: ${file}`);
    } catch (err) {
      logger.warn(`Failed to transform ${file}: ${err}`);
    }
  }

  // Write route file
  await writeRouteFile(backendDir, fnInfo.name, `../handlers/${fnInfo.name}/${removeExt(fnInfo.entryFile)}`);
}

async function copySharedCode(sharedDir: string, backendDir: string, logger: Logger): Promise<void> {
  const targetSharedDir = path.join(backendDir, 'src', 'shared');
  
  await fs.ensureDir(targetSharedDir);
  await fs.copy(sharedDir, targetSharedDir, {
    filter: (filePath) => {
      const base = path.basename(filePath);
      return !['.env', '.env.local', '.env.example'].includes(base);
    }
  });

  // Transform shared files
  const tsFiles = await fg(['**/*.{ts,tsx,js,jsx}'], { cwd: targetSharedDir, onlyFiles: true });
  
  for (const file of tsFiles) {
    const filePath = path.join(targetSharedDir, file);
    const content = await fs.readFile(filePath, 'utf8');
    
    try {
      const transformed = applyTransform(filePath, content);
      await fs.writeFile(filePath, transformed, 'utf8');
      logger.debug(`Transformed shared: ${file}`);
    } catch (err) {
      logger.warn(`Failed to transform shared ${file}: ${err}`);
    }
  }
}

function applyTransform(filePath: string, source: string): string {
  const jscodeshift = require('jscodeshift');
  
  // Use TypeScript parser for .ts/.tsx files
  const parser = filePath.match(/\.tsx?$/) ? 'tsx' : 'babel';
  const j = jscodeshift.withParser(parser);
  
  const api = {
    jscodeshift: j,
    stats: () => undefined,
    report: () => undefined
  };

  try {
    const output = transform({ path: filePath, source }, api, {});
    return typeof output === 'string' ? output : source;
  } catch (err) {
    // Return original if transform fails
    return source;
  }
}

async function findEntryFile(folder: string): Promise<string | null> {
  const candidates = [
    'index.ts',
    'index.tsx',
    'index.js',
    'main.ts',
    'main.tsx',
    'mod.ts',
    'handler.ts'
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(folder, candidate);
    if (await fs.pathExists(fullPath)) return candidate;
  }

  const fallback = await fg(['*.{ts,js,tsx}'], { cwd: folder, onlyFiles: true, deep: 1 });
  return fallback[0] ?? null;
}

async function writeRouteFile(backendDir: string, routeName: string, importPath: string): Promise<void> {
  const routePath = path.join(backendDir, 'src', 'routes', `${routeName}.ts`);
  const content = `import { Router } from 'express';
import handler from '${importPath}.js';
import { createRequest, sendResponse } from '../lib/adapter.js';

const router = Router();

// Handle all HTTP methods for /${routeName}
router.all('/${routeName}', async (req, res, next) => {
  try {
    const request = createRequest(req);
    const response = await handler(request);
    await sendResponse(res, response);
  } catch (error) {
    console.error('Handler error for /${routeName}:', error);
    next(error);
  }
});

// Also handle sub-paths if needed
router.all('/${routeName}/*', async (req, res, next) => {
  try {
    const request = createRequest(req);
    const response = await handler(request);
    await sendResponse(res, response);
  } catch (error) {
    console.error('Handler error for /${routeName}:', error);
    next(error);
  }
});

export default router;
`;

  await fs.ensureDir(path.dirname(routePath));
  await fs.writeFile(routePath, content, 'utf8');
}

async function writeRoutesIndex(backendDir: string, routes: { name: string; methods: string[] }[]): Promise<void> {
  const indexPath = path.join(backendDir, 'src', 'routes', 'index.ts');
  const imports = routes
    .map((r) => `import ${sanitizeName(r.name)}Router from './${r.name}.js';`)
    .join('\n');
  const uses = routes
    .map((r) => `router.use(${sanitizeName(r.name)}Router);`)
    .join('\n');

  const content = `import { Router } from 'express';
${imports}

const router = Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount all function routes
${uses}

export default router;
`;

  await fs.ensureDir(path.dirname(indexPath));
  await fs.writeFile(indexPath, content, 'utf8');
}

async function writeMigrationReport(
  targetDir: string,
  functions: FunctionInfo[],
  envVars: Set<string>
): Promise<void> {
  const reportPath = path.join(targetDir, 'MIGRATION_REPORT.md');
  
  const content = `# Migration Report

Generated: ${new Date().toISOString()}

## Converted Functions

${functions.map((fn) => `### ${fn.name}
- Entry: \`${fn.entryFile}\`
- Files: ${fn.files.length}
- Dependencies: ${Array.from(fn.dependencies).join(', ') || 'none'}
- Environment Variables: ${Array.from(fn.envVars).join(', ') || 'none'}
- Uses Shared Code: ${fn.hasSharedImports ? 'Yes' : 'No'}
`).join('\n')}

## Environment Variables

The following environment variables were detected and need to be configured:

\`\`\`
${Array.from(envVars).map((v) => `${v}=`).join('\n')}
\`\`\`

## Post-Migration Checklist

- [ ] Review all transformed handlers for correctness
- [ ] Set up environment variables in \`.env\`
- [ ] Install dependencies with \`npm install\`
- [ ] Test each endpoint
- [ ] Update frontend API calls if needed
- [ ] Set up CORS configuration for production
- [ ] Configure rate limiting and security middleware

## Notes

- The original Supabase Edge Functions used Deno runtime
- This conversion targets Node.js 18+ with Express.js
- Some Deno-specific APIs may need manual adjustment
- Review the \`backend/src/lib/adapter.ts\` for the Request/Response bridging logic
`;

  await fs.writeFile(reportPath, content, 'utf8');
}

function printDryRunReport(
  functions: FunctionInfo[],
  dependencies: Set<string>,
  envVars: Set<string>
): void {
  console.log('\n' + kleur.cyan('=== Dry Run Report ===\n'));
  
  console.log(kleur.bold('Functions to convert:'));
  for (const fn of functions) {
    console.log(`  - ${fn.name} (${fn.files.length} files)`);
  }
  
  console.log('\n' + kleur.bold('Dependencies detected:'));
  for (const dep of dependencies) {
    console.log(`  - ${dep}`);
  }
  
  console.log('\n' + kleur.bold('Environment variables:'));
  for (const env of envVars) {
    console.log(`  - ${env}`);
  }
}

function removeExt(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}
