/**
 * Auth proxy templates for Express backend
 * Allows the frontend to route all Supabase auth requests through the Express server
 */

export function generateAuthProxy(): string {
  return `import { Router, Request, Response } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const router = Router();

// Lazy-loaded Supabase client (created on first request when env vars are available)
let supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set');
    }
    
    supabaseAdmin = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseAdmin;
}

// Helper to get env vars (with runtime check)
function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is not set');
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('SUPABASE_ANON_KEY is not set');
  return key;
}

/**
 * Proxy all auth requests to Supabase
 * Handles paths like /auth/v1/signup, /auth/v1/token, etc.
 */
router.all('/auth/v1/:path(*)', async (req: Request, res: Response) => {
  const authPath = req.params.path; // Everything after /auth/v1/
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = \`\${getSupabaseUrl()}/auth/v1/\${authPath}\${queryString}\`;
  
  console.log('Auth proxy:', req.method, targetUrl);
  
  try {
    // Build headers for Supabase
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': getSupabaseAnonKey(),
    };
    
    // Forward authorization header if present
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization as string;
    }
    
    // Forward x-client-info if present
    if (req.headers['x-client-info']) {
      headers['x-client-info'] = req.headers['x-client-info'] as string;
    }
    
    // Forward the request to Supabase
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
    });
    
    // Get response data
    const data = await response.json().catch(() => null);
    
    // Forward response status and data
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Auth proxy error:', error);
    res.status(500).json({ 
      error: 'Auth proxy error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Sign up endpoint
 */
router.post('/signup', async (req: Request, res: Response) => {
  const { email, password, ...metadata } = req.body;
  
  try {
    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    res.json({ user: data.user, session: null });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ 
      error: 'Signup failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Sign in with password
 */
router.post('/signin', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  
  try {
    // Use the Supabase auth API directly
    const response = await fetch(\`\${getSupabaseUrl()}/auth/v1/token?grant_type=password\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': getSupabaseAnonKey(),
      },
      body: JSON.stringify({ email, password }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    
    res.json(data);
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ 
      error: 'Signin failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Sign out
 */
router.post('/signout', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }
  
  try {
    const response = await fetch(\`\${getSupabaseUrl()}/auth/v1/logout\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': getSupabaseAnonKey(),
        'Authorization': authHeader,
      },
    });
    
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json(data);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Signout error:', error);
    res.status(500).json({ 
      error: 'Signout failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Refresh token
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const { refresh_token } = req.body;
  
  try {
    const response = await fetch(\`\${getSupabaseUrl()}/auth/v1/token?grant_type=refresh_token\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': getSupabaseAnonKey(),
      },
      body: JSON.stringify({ refresh_token }),
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ 
      error: 'Token refresh failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get user
 */
router.get('/user', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }
  
  try {
    const response = await fetch(\`\${getSupabaseUrl()}/auth/v1/user\`, {
      method: 'GET',
      headers: {
        'apikey': getSupabaseAnonKey(),
        'Authorization': authHeader,
      },
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      error: 'Failed to get user',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Password reset request
 */
router.post('/recover', async (req: Request, res: Response) => {
  const { email } = req.body;
  const redirectTo = req.body.redirectTo || req.headers.origin;
  
  try {
    const response = await fetch(\`\${getSupabaseUrl()}/auth/v1/recover\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': getSupabaseAnonKey(),
      },
      body: JSON.stringify({ email, redirect_to: redirectTo }),
    });
    
    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Password recovery error:', error);
    res.status(500).json({ 
      error: 'Password recovery failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Update user
 */
router.put('/user', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }
  
  try {
    const response = await fetch(\`\${getSupabaseUrl()}/auth/v1/user\`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': getSupabaseAnonKey(),
        'Authorization': authHeader,
      },
      body: JSON.stringify(req.body),
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ 
      error: 'Failed to update user',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as authProxyRouter };
`;
}

export function generateDatabaseProxy(): string {
  return `import { Router, Request, Response } from 'express';

const router = Router();

// Helper to get env vars at runtime
function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is not set');
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('SUPABASE_ANON_KEY is not set');
  return key;
}

/**
 * Proxy all REST API requests to Supabase PostgREST
 * This allows database queries to go through the Express backend
 * Handles tables, views, and RPC functions
 */
router.all('/rest/v1/:path(*)', async (req: Request, res: Response) => {
  const restPath = req.params.path;
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = \`\${getSupabaseUrl()}/rest/v1/\${restPath}\${queryString}\`;
  
  console.log('Database proxy:', req.method, targetUrl);
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': getSupabaseAnonKey(),
    };
    
    // Forward Prefer header (important for RPC and upserts)
    if (req.headers.prefer) {
      headers['Prefer'] = req.headers.prefer as string;
    }
    
    // Forward authorization header
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization as string;
    }
    
    // Forward range header for pagination
    if (req.headers.range) {
      headers['Range'] = req.headers.range as string;
    }
    
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body 
        ? JSON.stringify(req.body) 
        : undefined,
    });
    
    // Forward content-range header
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }
    
    const data = await response.json().catch(() => null);
    res.status(response.status).json(data);
  } catch (error) {
    console.error('Database proxy error:', error);
    res.status(500).json({ 
      error: 'Database proxy error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as databaseProxyRouter };
`;
}

export function generateStorageProxy(): string {
  return `import { Router, Request, Response } from 'express';

const router = Router();

// Helper to get env vars at runtime
function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is not set');
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('SUPABASE_ANON_KEY is not set');
  return key;
}

/**
 * Proxy storage requests to Supabase Storage
 */
router.all('/storage/v1/:path(*)', async (req: Request, res: Response) => {
  const storagePath = req.params.path;
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const targetUrl = \`\${getSupabaseUrl()}/storage/v1/\${storagePath}\${queryString}\`;
  
  console.log('Storage proxy:', req.method, targetUrl);
  
  try {
    const headers: Record<string, string> = {
      'apikey': getSupabaseAnonKey(),
    };
    
    // Forward authorization
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization as string;
    }
    
    // Forward content-type for uploads
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'] as string;
    }
    
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ['POST', 'PUT'].includes(req.method) ? req.body : undefined,
    });
    
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      // For file downloads, stream the response
      const buffer = await response.arrayBuffer();
      res.status(response.status);
      if (contentType) res.setHeader('Content-Type', contentType);
      res.send(Buffer.from(buffer));
    }
  } catch (error) {
    console.error('Storage proxy error:', error);
    res.status(500).json({ 
      error: 'Storage proxy error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as storageProxyRouter };
`;
}
