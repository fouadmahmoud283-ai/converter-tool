/**
 * Extract npm dependencies from Deno-style source code
 */

// Common Deno to npm package mappings
const packageMappings: Record<string, string> = {
  // Supabase
  '@supabase/supabase-js': '@supabase/supabase-js',
  
  // HTTP and Web
  'oak': 'koa',
  'hono': 'hono',
  
  // Utilities
  'lodash': 'lodash',
  'date-fns': 'date-fns',
  'uuid': 'uuid',
  'nanoid': 'nanoid',
  
  // Validation
  'zod': 'zod',
  'yup': 'yup',
  'joi': 'joi',
  
  // HTTP clients
  'axios': 'axios',
  'node-fetch': 'node-fetch',
  
  // Database
  'postgres': 'pg',
  'mysql': 'mysql2',
  'redis': 'redis',
  'mongodb': 'mongodb',
  
  // AI/ML
  'openai': 'openai',
  '@anthropic-ai/sdk': '@anthropic-ai/sdk',
  'langchain': 'langchain',
  
  // Email
  'nodemailer': 'nodemailer',
  'resend': 'resend',
  '@sendgrid/mail': '@sendgrid/mail',
  
  // Payments
  'stripe': 'stripe',
  
  // Authentication
  'jsonwebtoken': 'jsonwebtoken',
  'jose': 'jose',
  'bcrypt': 'bcrypt',
  
  // Crypto
  'crypto-js': 'crypto-js',
  
  // PDF
  'pdfkit': 'pdfkit',
  'pdf-lib': 'pdf-lib',
  
  // Images
  'sharp': 'sharp',
  'jimp': 'jimp',
  
  // AWS
  '@aws-sdk/client-s3': '@aws-sdk/client-s3',
  '@aws-sdk/client-ses': '@aws-sdk/client-ses',
  
  // Google
  'googleapis': 'googleapis',
  '@google-cloud/storage': '@google-cloud/storage',
};

export function extractDependencies(source: string): Set<string> {
  const dependencies = new Set<string>();
  
  // Match npm: imports
  const npmPattern = /from\s+['"]npm:([^'"@]+)(?:@[^'"]+)?['"]/g;
  let match;
  while ((match = npmPattern.exec(source)) !== null) {
    const pkg = match[1].trim();
    dependencies.add(mapPackage(pkg));
  }
  
  // Match npm: scoped imports
  const npmScopedPattern = /from\s+['"]npm:(@[^/]+\/[^'"@]+)(?:@[^'"]+)?['"]/g;
  while ((match = npmScopedPattern.exec(source)) !== null) {
    const pkg = match[1].trim();
    dependencies.add(mapPackage(pkg));
  }
  
  // Match jsr: imports
  const jsrPattern = /from\s+['"]jsr:([^'"@]+)(?:@[^'"]+)?['"]/g;
  while ((match = jsrPattern.exec(source)) !== null) {
    const pkg = match[1].trim();
    dependencies.add(mapPackage(pkg));
  }
  
  // Match esm.sh imports
  const esmPattern = /from\s+['"]https:\/\/esm\.sh\/([^@'"?]+)(?:@[^'"?]+)?[^'"]*['"]/g;
  while ((match = esmPattern.exec(source)) !== null) {
    const pkg = match[1].trim();
    dependencies.add(mapPackage(pkg));
  }
  
  // Match deno.land imports (extract common package names)
  const denoPattern = /from\s+['"](?:https:\/\/)?deno\.land\/x\/([^@/'"]+)/g;
  while ((match = denoPattern.exec(source)) !== null) {
    const pkg = match[1].trim();
    const mapped = mapPackage(pkg);
    if (mapped) {
      dependencies.add(mapped);
    }
  }
  
  // Detect common patterns in code that imply dependencies
  if (source.includes('createClient') && source.includes('supabase')) {
    dependencies.add('@supabase/supabase-js');
  }
  
  if (source.includes('OpenAI') || source.includes('openai')) {
    dependencies.add('openai');
  }
  
  if (source.includes('Stripe') || source.includes('stripe')) {
    dependencies.add('stripe');
  }
  
  if (source.includes('Resend') || source.includes('resend')) {
    dependencies.add('resend');
  }
  
  // Detect bcrypt usage
  if (source.includes('bcrypt') || source.includes('hash(') || source.includes('compare(')) {
    dependencies.add('bcrypt');
  }
  
  return dependencies;
}

function mapPackage(pkg: string): string {
  // Direct mapping
  if (packageMappings[pkg]) {
    return packageMappings[pkg];
  }
  
  // Handle scoped packages
  if (pkg.startsWith('@')) {
    return pkg;
  }
  
  // Handle common Deno std library replacements
  if (pkg.includes('std/')) {
    // Most std library functionality is built into Node.js
    return '';
  }
  
  return pkg;
}

/**
 * Generate package.json dependencies object from a set of package names
 */
export function generateDependenciesObject(packages: Set<string>): Record<string, string> {
  const result: Record<string, string> = {};
  
  const versions: Record<string, string> = {
    '@supabase/supabase-js': '^2.39.0',
    'openai': '^4.28.0',
    'stripe': '^14.14.0',
    'resend': '^3.2.0',
    'zod': '^3.22.4',
    'uuid': '^9.0.1',
    'nanoid': '^5.0.5',
    'date-fns': '^3.3.1',
    'lodash': '^4.17.21',
    'axios': '^1.6.7',
    'jsonwebtoken': '^9.0.2',
    'jose': '^5.2.2',
    'bcrypt': '^5.1.1',
    'pg': '^8.11.3',
    'redis': '^4.6.12',
    'mongodb': '^6.3.0',
    '@anthropic-ai/sdk': '^0.17.1',
    'langchain': '^0.1.17',
    'nodemailer': '^6.9.9',
    '@sendgrid/mail': '^8.1.1',
    'sharp': '^0.33.2',
    'pdfkit': '^0.15.0',
    'pdf-lib': '^1.17.1',
    '@aws-sdk/client-s3': '^3.515.0',
    '@aws-sdk/client-ses': '^3.515.0',
    'googleapis': '^132.0.0',
    '@google-cloud/storage': '^7.7.0',
    'hono': '^4.0.1',
    'crypto-js': '^4.2.0',
  };
  
  for (const pkg of packages) {
    if (!pkg) continue;
    result[pkg] = versions[pkg] ?? '*';
  }
  
  return result;
}
