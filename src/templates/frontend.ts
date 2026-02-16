import path from 'node:path';
import fs from 'fs-extra';
import fg from 'fast-glob';
import type { Logger } from '../utils/logger.js';

/**
 * Update frontend to use the new Express backend instead of Supabase Edge Functions
 * This includes:
 * 1. Replacing supabase.functions.invoke() calls
 * 2. Creating a custom Supabase client that proxies through Express
 * 3. Updating environment variables
 */
export async function updateFrontendIntegration(
  repoDir: string,
  frontendDir: string,
  logger: Logger
): Promise<void> {
  // Create/update .env.local for Vite
  await createFrontendEnv(frontendDir);
  
  // Create the proxy-based Supabase client
  await createProxySupabaseClient(frontendDir, logger);
  
  // Find and update source files that call Supabase functions
  await updateSupabaseFunctionCalls(frontendDir, logger);
  
  // Update Supabase client imports to use our proxy client
  await updateSupabaseClientImports(frontendDir, logger);
  
  // Update any hardcoded Supabase function URLs
  await updateHardcodedUrls(frontendDir, logger);
}

async function createFrontendEnv(frontendDir: string): Promise<void> {
  const envLocalPath = path.join(frontendDir, '.env.local');
  const envPath = path.join(frontendDir, '.env');
  
  // Read existing .env.local if present
  let existingEnv = '';
  if (await fs.pathExists(envLocalPath)) {
    existingEnv = await fs.readFile(envLocalPath, 'utf8');
  }
  
  // Also read the main .env file to get Supabase credentials
  let mainEnv = '';
  if (await fs.pathExists(envPath)) {
    mainEnv = await fs.readFile(envPath, 'utf8');
  }
  
  // Extract Supabase credentials from main .env
  // Handle both ANON_KEY and PUBLISHABLE_KEY naming conventions
  const supabaseUrlMatch = mainEnv.match(/VITE_SUPABASE_URL=(.*)/);
  const supabaseKeyMatch = mainEnv.match(/VITE_SUPABASE_ANON_KEY=(.*)/) || mainEnv.match(/VITE_SUPABASE_PUBLISHABLE_KEY=(.*)/);
  
  // Build the .env.local content
  let newEnv = existingEnv.trim();
  
  // Add Supabase credentials if not already present
  if (supabaseUrlMatch && !newEnv.includes('VITE_SUPABASE_URL')) {
    newEnv += `\n\n# Supabase Configuration\nVITE_SUPABASE_URL=${supabaseUrlMatch[1]}`;
  }
  if (supabaseKeyMatch && !newEnv.includes('VITE_SUPABASE_ANON_KEY')) {
    newEnv += `\nVITE_SUPABASE_ANON_KEY=${supabaseKeyMatch[1]}`;
  }
  
  // Add backend URL
  const backendUrl = 'VITE_BACKEND_URL=http://localhost:3001';
  const functionUrlLine = 'VITE_FUNCTIONS_BASE_URL=http://localhost:3001/functions/v1';
  
  if (!newEnv.includes('VITE_BACKEND_URL')) {
    newEnv += '\n\n# Express Backend URL\n' + backendUrl;
  }
  
  if (newEnv.includes('VITE_FUNCTIONS_BASE_URL')) {
    newEnv = newEnv.replace(/VITE_FUNCTIONS_BASE_URL=.*/, functionUrlLine);
  } else {
    newEnv += '\n' + functionUrlLine;
  }
  
  await fs.writeFile(envLocalPath, newEnv.trim() + '\n', 'utf8');
}

/**
 * Create a proxy-based Supabase client that routes all requests through Express
 */
async function createProxySupabaseClient(frontendDir: string, logger: Logger): Promise<void> {
  const integrationDir = path.join(frontendDir, 'src', 'integrations', 'supabase');
  await fs.ensureDir(integrationDir);
  
  // Create the proxy client
  const proxyClientPath = path.join(integrationDir, 'client.ts');
  
  // Default to env vars
  let supabaseUrl = 'import.meta.env.VITE_SUPABASE_URL';
  let supabaseKey = 'import.meta.env.VITE_SUPABASE_ANON_KEY';
  let foundExistingConfig = false;
  
  // Check existing client file for hardcoded values
  if (await fs.pathExists(proxyClientPath)) {
    const existingContent = await fs.readFile(proxyClientPath, 'utf8');
    
    // Try multiple patterns to extract URL
    const urlPatterns = [
      /SUPABASE_URL\s*[=:]\s*["']([^"']+)["']/,
      /supabaseUrl\s*[=:]\s*["']([^"']+)["']/i,
      /createClient\s*\(\s*["']([^"']+)["']/,
      /https:\/\/[a-zA-Z0-9]+\.supabase\.co/,
    ];
    
    const keyPatterns = [
      /SUPABASE_ANON_KEY\s*[=:]\s*["']([^"']+)["']/,
      /supabaseKey\s*[=:]\s*["']([^"']+)["']/i,
      /supabaseAnonKey\s*[=:]\s*["']([^"']+)["']/i,
      /createClient\s*\([^,]+,\s*["']([^"']+)["']/,
    ];
    
    for (const pattern of urlPatterns) {
      const match = existingContent.match(pattern);
      if (match) {
        const url = match[1] || match[0];
        if (url.includes('.supabase.co')) {
          supabaseUrl = `"${url}"`;
          foundExistingConfig = true;
          logger.debug(`Found existing Supabase URL: ${url}`);
          break;
        }
      }
    }
    
    for (const pattern of keyPatterns) {
      const match = existingContent.match(pattern);
      if (match && match[1] && match[1].length > 20) { // Anon keys are long
        supabaseKey = `"${match[1]}"`;
        foundExistingConfig = true;
        logger.debug('Found existing Supabase anon key');
        break;
      }
    }
  }
  
  // Also check .env files for Supabase config
  const envFiles = ['.env', '.env.local', '.env.development'];
  for (const envFile of envFiles) {
    const envPath = path.join(frontendDir, envFile);
    if (await fs.pathExists(envPath)) {
      const envContent = await fs.readFile(envPath, 'utf8');
      
      const envUrlMatch = envContent.match(/VITE_SUPABASE_URL\s*=\s*["']?([^"'\n]+)["']?/);
      // Check for both ANON_KEY and PUBLISHABLE_KEY naming conventions
      const envKeyMatch = envContent.match(/VITE_SUPABASE_ANON_KEY\s*=\s*["']?([^"'\n]+)["']?/) 
        || envContent.match(/VITE_SUPABASE_PUBLISHABLE_KEY\s*=\s*["']?([^"'\n]+)["']?/);
      
      if (envUrlMatch && envUrlMatch[1].includes('.supabase.co')) {
        supabaseUrl = `"${envUrlMatch[1].trim()}"`;
        foundExistingConfig = true;
        logger.debug(`Found Supabase URL in ${envFile}`);
      }
      if (envKeyMatch && envKeyMatch[1].length > 20) {
        supabaseKey = `"${envKeyMatch[1].trim()}"`;
        foundExistingConfig = true;
        logger.debug(`Found Supabase key in ${envFile}`);
      }
      
      if (foundExistingConfig) break;
    }
  }
  
  // If we still don't have hardcoded values, keep using env vars but add fallback check
  if (!foundExistingConfig) {
    logger.debug('Using environment variables for Supabase config');
  }
  
  const proxyClient = `/**
 * Supabase Client with Express Backend Proxy
 * 
 * This client is configured to route requests through your Express backend
 * instead of directly to Supabase. This allows:
 * - All traffic to go through your server
 * - Custom middleware/logging on all requests  
 * - Full control over authentication flow
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Backend URL (your Express server)
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// Original Supabase credentials (still needed for client initialization)
// These can come from environment variables or be hardcoded from the original project
const SUPABASE_URL = ${supabaseUrl} || '';
// Support both ANON_KEY and PUBLISHABLE_KEY naming conventions
const SUPABASE_ANON_KEY = ${supabaseKey} || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

// Validate that we have the required credentials
if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL. Set VITE_SUPABASE_URL in your .env file');
}
if (!SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_ANON_KEY. Set VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY in your .env file');
}

/**
 * Custom fetch that routes requests through Express backend
 */
const proxyFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  
  // Check if this is a Supabase request that should be proxied
  if (url.includes('.supabase.co/')) {
    // Extract the path after the supabase domain
    const urlObj = new URL(url);
    const pathAndQuery = urlObj.pathname + urlObj.search;
    
    // Route through backend
    let proxyPath = '';
    
    if (pathAndQuery.startsWith('/auth/')) {
      // Auth requests -> /proxy/auth/*
      proxyPath = '/proxy' + pathAndQuery;
    } else if (pathAndQuery.startsWith('/rest/')) {
      // Database requests -> /proxy/rest/*
      proxyPath = '/proxy' + pathAndQuery;
    } else if (pathAndQuery.startsWith('/storage/')) {
      // Storage requests -> /proxy/storage/*
      proxyPath = '/proxy' + pathAndQuery;
    } else if (pathAndQuery.startsWith('/functions/')) {
      // Edge functions -> /functions/* (our converted handlers)
      proxyPath = pathAndQuery;
    } else {
      // Other requests go to backend proxy
      proxyPath = '/proxy' + pathAndQuery;
    }
    
    const proxyUrl = BACKEND_URL + proxyPath;
    
    // Forward the request with modified URL
    return fetch(proxyUrl, {
      ...init,
      headers: {
        ...init?.headers,
        'X-Original-URL': url,
      },
    });
  }
  
  // Non-Supabase requests pass through normally
  return fetch(input, init);
};

/**
 * Create Supabase client with proxy fetch
 */
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
    global: {
      fetch: proxyFetch,
    },
  }
);

// Export for backward compatibility
export default supabase;

/**
 * Helper to check if backend is available
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(BACKEND_URL + '/health');
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get the backend URL
 */
export function getBackendUrl(): string {
  return BACKEND_URL;
}
`;

  await fs.writeFile(proxyClientPath, proxyClient, 'utf8');
  logger.debug('Created proxy Supabase client');
  
  // Also create an index.ts that re-exports
  const indexPath = path.join(integrationDir, 'index.ts');
  if (!(await fs.pathExists(indexPath))) {
    const indexContent = "export { supabase, checkBackendHealth, getBackendUrl } from './client';\nexport type { Database } from './types';\n";
    await fs.writeFile(indexPath, indexContent, 'utf8');
  }
}

/**
 * Update imports that use @supabase/supabase-js directly to use our proxy client
 */
async function updateSupabaseClientImports(frontendDir: string, logger: Logger): Promise<void> {
  const srcDir = path.join(frontendDir, 'src');
  if (!(await fs.pathExists(srcDir))) return;
  
  const files = await fg(['**/*.{ts,tsx,js,jsx}'], { 
    cwd: srcDir, 
    onlyFiles: true,
    ignore: ['**/integrations/supabase/**'] // Don't modify our proxy client
  });
  
  for (const file of files) {
    const filePath = path.join(srcDir, file);
    let content = await fs.readFile(filePath, 'utf8');
    let modified = false;
    
    // Check if file creates its own Supabase client
    if (content.includes('createClient') && content.includes('@supabase/supabase-js')) {
      // Find and comment out local createClient usage, suggest using the shared client
      const hasLocalClient = /const\s+\w+\s*=\s*createClient\s*\(/g.test(content);
      
      if (hasLocalClient && !content.includes('@/integrations/supabase')) {
        // Add import for shared client
        const importStatement = "import { supabase } from '@/integrations/supabase';\n";
        
        // Add comment explaining the change
        const comment = "// Note: Using shared Supabase client that routes through Express backend\n";
        
        // Find the first import
        const firstImportMatch = content.match(/^import\s+/m);
        if (firstImportMatch) {
          content = content.replace(firstImportMatch[0], comment + importStatement + firstImportMatch[0]);
          modified = true;
          logger.debug('Added proxy client import to: ' + file);
        }
      }
    }
    
    if (modified) {
      await fs.writeFile(filePath, content, 'utf8');
    }
  }
}

async function updateSupabaseFunctionCalls(frontendDir: string, logger: Logger): Promise<void> {
  // Find all TypeScript/JavaScript files in src
  const srcDir = path.join(frontendDir, 'src');
  if (!(await fs.pathExists(srcDir))) return;
  
  const files = await fg(['**/*.{ts,tsx,js,jsx}'], { cwd: srcDir, onlyFiles: true });
  
  for (const file of files) {
    const filePath = path.join(srcDir, file);
    let content = await fs.readFile(filePath, 'utf8');
    let modified = false;
    
    // Check if file contains supabase.functions.invoke
    if (!content.includes('supabase.functions.invoke')) {
      continue;
    }
    
    // Add helper import if not present
    if (!content.includes("from '@/lib/functions'") && !content.includes('from "@/lib/functions"')) {
      const helperImport = "import { invokeFn } from '@/lib/functions';\n";
      // Find first import and add after
      const firstImportMatch = content.match(/^import\s+.+$/m);
      if (firstImportMatch) {
        content = content.replace(firstImportMatch[0], firstImportMatch[0] + '\n' + helperImport);
        modified = true;
      }
    }
    
    // Replace supabase.functions.invoke calls using a more robust approach
    // This handles nested braces in the options object
    const result = replaceSupabaseInvokeCalls(content);
    if (result.changed) {
      content = result.content;
      modified = true;
    }
    
    if (modified) {
      await fs.writeFile(filePath, content, 'utf8');
      logger.debug('Updated function calls in: ' + file);
    }
  }
  
  // Create the helper function file
  await createFunctionHelper(frontendDir);
}

/**
 * Replace supabase.functions.invoke() calls with invokeFn()
 * Handles nested braces in options objects
 */
function replaceSupabaseInvokeCalls(content: string): { content: string; changed: boolean } {
  let changed = false;
  let result = content;
  
  // Find all occurrences of supabase.functions.invoke
  const pattern = /supabase\.functions\.invoke\s*\(\s*['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = pattern.exec(content)) !== null) {
    const fnName = match[1];
    const startIdx = match.index;
    const afterFnName = match.index + match[0].length;
    
    // Find the matching closing parenthesis, handling nested braces
    let idx = afterFnName;
    let optionsStart = -1;
    let optionsEnd = -1;
    
    // Skip whitespace and look for comma or closing paren
    while (idx < content.length && /\s/.test(content[idx])) idx++;
    
    if (content[idx] === ',') {
      // There are options
      idx++; // skip comma
      while (idx < content.length && /\s/.test(content[idx])) idx++;
      optionsStart = idx;
      
      // Find the matching closing paren for invoke()
      let braceDepth = 0;
      while (idx < content.length) {
        const char = content[idx];
        if (char === '{' || char === '[' || char === '(') {
          braceDepth++;
        } else if (char === '}' || char === ']') {
          braceDepth--;
        } else if (char === ')') {
          if (braceDepth === 0) {
            optionsEnd = idx;
            break;
          }
          braceDepth--;
        }
        idx++;
      }
    } else if (content[idx] === ')') {
      // No options
      optionsEnd = idx;
    }
    
    if (optionsEnd > 0) {
      const fullMatch = content.substring(startIdx, optionsEnd + 1);
      let replacement;
      
      if (optionsStart > 0 && optionsStart < optionsEnd) {
        const options = content.substring(optionsStart, optionsEnd).trim();
        replacement = "invokeFn('" + fnName + "', " + options + ")";
      } else {
        replacement = "invokeFn('" + fnName + "')";
      }
      
      result = result.replace(fullMatch, replacement);
      changed = true;
    }
  }
  
  return { content: result, changed };
}

async function createFunctionHelper(frontendDir: string): Promise<void> {
  const libDir = path.join(frontendDir, 'src', 'lib');
  await fs.ensureDir(libDir);
  
  const helperPath = path.join(libDir, 'functions.ts');
  
  // Don't overwrite if exists
  if (await fs.pathExists(helperPath)) return;
  
  const helper = `/**
 * Helper to call converted Express backend functions
 * Replaces supabase.functions.invoke() calls
 */

const FUNCTIONS_BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL || 'http://localhost:3001/functions/v1';

export type InvokeFnOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
};

export type InvokeFnResult<T = unknown> = {
  data: T | null;
  error: Error | null;
};

/**
 * Invoke a backend function
 * @param functionName - Name of the function (route)
 * @param options - Request options
 */
export async function invokeFn<T = unknown>(
  functionName: string,
  options: InvokeFnOptions = {}
): Promise<InvokeFnResult<T>> {
  const { body, headers = {}, method = body ? 'POST' : 'GET' } = options;
  
  const url = FUNCTIONS_BASE_URL + '/' + functionName;
  
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(errorData.message || errorData.error || 'Request failed');
    }
    
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return { 
      data: null, 
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

/**
 * Create a typed function invoker for a specific endpoint
 */
export function createFnInvoker<TInput, TOutput>(functionName: string) {
  return async (input?: TInput): Promise<InvokeFnResult<TOutput>> => {
    return invokeFn<TOutput>(functionName, { body: input });
  };
}
`;
  
  await fs.writeFile(helperPath, helper, 'utf8');
}

async function updateHardcodedUrls(frontendDir: string, logger: Logger): Promise<void> {
  const srcDir = path.join(frontendDir, 'src');
  if (!(await fs.pathExists(srcDir))) return;
  
  const files = await fg(['**/*.{ts,tsx,js,jsx}'], { cwd: srcDir, onlyFiles: true });
  
  // Patterns for Supabase function URLs
  const urlPatterns = [
    // https://<project>.supabase.co/functions/v1/
    /https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/([a-z0-9-]+)/gi,
    // ${SUPABASE_URL}/functions/v1/
    /\$\{[^}]*SUPABASE[^}]*\}\/functions\/v1\/([a-z0-9-]+)/gi,
  ];
  
  for (const file of files) {
    const filePath = path.join(srcDir, file);
    let content = await fs.readFile(filePath, 'utf8');
    let modified = false;
    
    for (const pattern of urlPatterns) {
      if (pattern.test(content)) {
        pattern.lastIndex = 0;
        content = content.replace(pattern, (_match, fnName) => {
          modified = true;
          return '${import.meta.env.VITE_FUNCTIONS_BASE_URL}/' + fnName;
        });
      }
    }
    
    if (modified) {
      await fs.writeFile(filePath, content, 'utf8');
      logger.debug('Updated hardcoded URLs in: ' + file);
    }
  }
}
