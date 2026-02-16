/**
 * Extract environment variable names from source code
 */

export function extractEnvVariables(source: string): Set<string> {
  const envVars = new Set<string>();
  
  // Match Deno.env.get("VAR_NAME")
  const denoEnvPattern = /Deno\.env\.get\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = denoEnvPattern.exec(source)) !== null) {
    envVars.add(match[1]);
  }
  
  // Match Deno.env.get('VAR_NAME')
  const denoEnvPattern2 = /Deno\.env\.get\s*\(\s*`([^`]+)`\s*\)/g;
  while ((match = denoEnvPattern2.exec(source)) !== null) {
    // Template literals might have interpolation, skip those
    if (!match[1].includes('$')) {
      envVars.add(match[1]);
    }
  }
  
  // Match process.env.VAR_NAME or process.env["VAR_NAME"]
  const processEnvPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
  while ((match = processEnvPattern.exec(source)) !== null) {
    envVars.add(match[1]);
  }
  
  const processEnvBracketPattern = /process\.env\[['"]([^'"]+)['"]\]/g;
  while ((match = processEnvBracketPattern.exec(source)) !== null) {
    envVars.add(match[1]);
  }
  
  // Match import.meta.env.VITE_* (Vite env vars)
  const viteEnvPattern = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;
  while ((match = viteEnvPattern.exec(source)) !== null) {
    envVars.add(match[1]);
  }
  
  // Common Supabase env vars that might be used without explicit calls
  const commonEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
    'DATABASE_URL',
    'OPENAI_API_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'SENDGRID_API_KEY',
    'JWT_SECRET',
    'API_KEY',
    'SECRET_KEY'
  ];
  
  for (const envVar of commonEnvVars) {
    // Check if the variable name appears in the code
    if (source.includes(envVar)) {
      envVars.add(envVar);
    }
  }
  
  return envVars;
}

/**
 * Generate .env.example content from a set of env var names
 */
export function generateEnvExample(envVars: Set<string>): string {
  const lines: string[] = [
    '# Server Configuration',
    'PORT=3001',
    'BASE_URL=http://localhost:3001',
    'BASE_PATH=/functions/v1',
    '',
    '# Environment',
    'NODE_ENV=development',
    ''
  ];
  
  // Group common env vars
  const supabaseVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET', 'DATABASE_URL'];
  const openaiVars = ['OPENAI_API_KEY', 'OPENAI_ORG_ID'];
  const stripeVars = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY'];
  const emailVars = ['RESEND_API_KEY', 'SENDGRID_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  
  const hasSupabase = supabaseVars.some((v) => envVars.has(v));
  const hasOpenai = openaiVars.some((v) => envVars.has(v));
  const hasStripe = stripeVars.some((v) => envVars.has(v));
  const hasEmail = emailVars.some((v) => envVars.has(v));
  
  if (hasSupabase) {
    lines.push('# Supabase');
    for (const v of supabaseVars) {
      if (envVars.has(v)) {
        lines.push(`${v}=`);
        envVars.delete(v);
      }
    }
    lines.push('');
  }
  
  if (hasOpenai) {
    lines.push('# OpenAI');
    for (const v of openaiVars) {
      if (envVars.has(v)) {
        lines.push(`${v}=`);
        envVars.delete(v);
      }
    }
    lines.push('');
  }
  
  if (hasStripe) {
    lines.push('# Stripe');
    for (const v of stripeVars) {
      if (envVars.has(v)) {
        lines.push(`${v}=`);
        envVars.delete(v);
      }
    }
    lines.push('');
  }
  
  if (hasEmail) {
    lines.push('# Email');
    for (const v of emailVars) {
      if (envVars.has(v)) {
        lines.push(`${v}=`);
        envVars.delete(v);
      }
    }
    lines.push('');
  }
  
  // Add remaining env vars
  if (envVars.size > 0) {
    lines.push('# Application');
    for (const v of Array.from(envVars).sort()) {
      lines.push(`${v}=`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}
