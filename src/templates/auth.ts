/**
 * Authentication middleware templates
 */

export function generateAuthMiddleware(): string {
  return `import { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        [key: string]: any;
      };
      supabase?: SupabaseClient;
    }
  }
}

/**
 * Extract JWT token from Authorization header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  
  const [type, token] = authHeader.split(' ');
  if (type.toLowerCase() !== 'bearer' || !token) return null;
  
  return token;
}

/**
 * Middleware to verify JWT token with Supabase
 * Adds user info to request if valid
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    
    if (!token) {
      res.status(401).json({ error: 'Authorization token required' });
      return;
    }
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: \`Bearer \${token}\` }
      }
    });
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    
    // Attach user and supabase client to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      ...user.user_metadata
    };
    req.supabase = supabase;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Optional auth - doesn't require token but attaches user if present
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    
    if (!token) {
      next();
      return;
    }
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      next();
      return;
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: \`Bearer \${token}\` }
      }
    });
    
    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (user) {
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        ...user.user_metadata
      };
      req.supabase = supabase;
    }
    
    next();
  } catch {
    // Silently continue without auth
    next();
  }
}

/**
 * Role-based access control middleware
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    
    if (!roles.includes(req.user.role || '')) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    
    next();
  };
}

/**
 * API key authentication middleware
 */
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = req.headers['x-api-key'] as string;
  const validApiKey = process.env.API_KEY;
  
  if (!validApiKey) {
    // API key not configured, skip check
    next();
    return;
  }
  
  if (!apiKey || apiKey !== validApiKey) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  
  next();
}
`;
}

export function generateAuthTypes(): string {
  return `import { SupabaseClient } from '@supabase/supabase-js';

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
  [key: string]: any;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      supabase?: SupabaseClient;
    }
  }
}
`;
}
