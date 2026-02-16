/**
 * Frontend templates for self-hosted mode
 * Replaces Supabase client with custom API client
 */

import path from 'node:path';
import fs from 'fs-extra';
import fg from 'fast-glob';
import type { Logger } from '../utils/logger.js';

/**
 * Update frontend to use self-hosted backend instead of Supabase
 */
export async function updateFrontendForSelfHosted(
  repoDir: string,
  frontendDir: string,
  logger: Logger
): Promise<void> {
  logger.info('🔄 Updating frontend for self-hosted backend...');
  
  // Create/update .env.local for Vite
  await createFrontendEnv(frontendDir);
  
  // Create the API client
  await createApiClient(frontendDir, logger);
  
  // Create auth context that replaces Supabase auth
  await createAuthContext(frontendDir, logger);
  
  // Create auth hooks
  await createAuthHooks(frontendDir, logger);
  
  // Create storage hooks
  await createStorageHooks(frontendDir, logger);
  
  // Replace Supabase client file
  await replaceSupabaseClient(frontendDir, logger);
  
  // Update all files that use Supabase
  await replaceSupabaseUsage(frontendDir, logger);
  
  logger.success('✓ Frontend updated for self-hosted backend');
}

async function createFrontendEnv(frontendDir: string): Promise<void> {
  const envLocalPath = path.join(frontendDir, '.env.local');
  
  // Read existing .env.local if present
  let existingEnv = '';
  if (await fs.pathExists(envLocalPath)) {
    existingEnv = await fs.readFile(envLocalPath, 'utf8');
  }
  
  // Build the .env.local content
  let newEnv = existingEnv.trim();
  
  // Add backend URL
  const backendUrl = 'VITE_API_URL=http://localhost:3001';
  
  if (!newEnv.includes('VITE_API_URL')) {
    newEnv += '\n\n# Self-Hosted Backend URL\n' + backendUrl;
  }
  
  await fs.writeFile(envLocalPath, newEnv.trim() + '\n', 'utf8');
}

/**
 * Create the main API client for self-hosted backend
 */
async function createApiClient(frontendDir: string, logger: Logger): Promise<void> {
  const libDir = path.join(frontendDir, 'src', 'lib');
  await fs.ensureDir(libDir);
  
  const apiClient = `/**
 * API Client for Self-Hosted Backend
 * Replaces Supabase client with direct API calls to Express backend
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Token storage
let accessToken: string | null = localStorage.getItem('access_token');
let refreshToken: string | null = localStorage.getItem('refresh_token');

// Token refresh promise to prevent concurrent refreshes
let refreshPromise: Promise<boolean> | null = null;

/**
 * Set auth tokens
 */
export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
}

/**
 * Clear auth tokens
 */
export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

/**
 * Get current access token
 */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!accessToken;
}

/**
 * Refresh the access token
 */
async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;
  
  // Return existing promise if already refreshing
  if (refreshPromise) return refreshPromise;
  
  refreshPromise = (async () => {
    try {
      const response = await fetch(\`\${API_URL}/auth/refresh\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      
      if (!response.ok) {
        clearTokens();
        return false;
      }
      
      const data = await response.json();
      setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      clearTokens();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  
  return refreshPromise;
}

/**
 * Make an authenticated API request
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: { message: string; code: string } | null }> {
  const url = endpoint.startsWith('http') ? endpoint : \`\${API_URL}\${endpoint}\`;
  
  const headers = new Headers(options.headers);
  
  if (accessToken) {
    headers.set('Authorization', \`Bearer \${accessToken}\`);
  }
  
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  
  try {
    let response = await fetch(url, { ...options, headers });
    
    // Try to refresh token if unauthorized
    if (response.status === 401 && refreshToken) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        headers.set('Authorization', \`Bearer \${accessToken}\`);
        response = await fetch(url, { ...options, headers });
      }
    }
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        data: null,
        error: {
          message: errorData.error || response.statusText,
          code: errorData.code || \`HTTP_\${response.status}\`,
        },
      };
    }
    
    // Handle empty responses
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : 'Network error',
        code: 'NETWORK_ERROR',
      },
    };
  }
}

/**
 * Auth API
 */
export const auth = {
  async signUp(email: string, password: string, metadata?: Record<string, any>) {
    const result = await apiRequest<{
      user: any;
      access_token: string;
      refresh_token: string;
    }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...metadata }),
    });
    
    if (result.data) {
      setTokens(result.data.access_token, result.data.refresh_token);
    }
    
    return result;
  },
  
  async signIn(email: string, password: string) {
    const result = await apiRequest<{
      user: any;
      access_token: string;
      refresh_token: string;
    }>('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    
    if (result.data) {
      setTokens(result.data.access_token, result.data.refresh_token);
    }
    
    return result;
  },
  
  async signOut() {
    if (refreshToken) {
      await apiRequest('/auth/signout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    }
    clearTokens();
    return { error: null };
  },
  
  async getUser() {
    return apiRequest<any>('/auth/user');
  },
  
  async updateUser(data: { fullName?: string; avatarUrl?: string; metadata?: any }) {
    return apiRequest('/auth/user', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  
  async changePassword(currentPassword: string, newPassword: string) {
    return apiRequest('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
  
  async resetPasswordRequest(email: string) {
    return apiRequest('/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },
  
  async resetPassword(email: string, token: string, newPassword: string) {
    return apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, token, newPassword }),
    });
  },
  
  onAuthStateChange(callback: (event: string, session: any) => void) {
    // Simple implementation - check token on load
    const checkAuth = async () => {
      if (accessToken) {
        const { data: user } = await this.getUser();
        if (user) {
          callback('SIGNED_IN', { user, access_token: accessToken });
        } else {
          clearTokens();
          callback('SIGNED_OUT', null);
        }
      } else {
        callback('SIGNED_OUT', null);
      }
    };
    
    checkAuth();
    
    // Return unsubscribe function
    return { data: { subscription: { unsubscribe: () => {} } } };
  },
};

/**
 * Storage API
 */
export const storage = {
  async upload(file: File, options?: { bucket?: string; path?: string; isPublic?: boolean }) {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.bucket) formData.append('bucket', options.bucket);
    if (options?.path) formData.append('path', options.path);
    if (options?.isPublic !== undefined) formData.append('isPublic', String(options.isPublic));
    
    return apiRequest('/storage/upload', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    });
  },
  
  async uploadMultiple(files: File[], options?: { bucket?: string; path?: string; isPublic?: boolean }) {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    if (options?.bucket) formData.append('bucket', options.bucket);
    if (options?.path) formData.append('path', options.path);
    if (options?.isPublic !== undefined) formData.append('isPublic', String(options.isPublic));
    
    return apiRequest('/storage/upload-multiple', {
      method: 'POST',
      body: formData,
      headers: {},
    });
  },
  
  async download(fileId: string) {
    const url = \`\${API_URL}/storage/download/\${fileId}\`;
    const headers: Record<string, string> = {};
    if (accessToken) headers['Authorization'] = \`Bearer \${accessToken}\`;
    
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('Download failed');
    
    return response.blob();
  },
  
  getPublicUrl(fileId: string) {
    return \`\${API_URL}/storage/public/\${fileId}\`;
  },
  
  async getSignedUrl(fileId: string, expiresIn?: number) {
    return apiRequest<{ url: string }>(\`/storage/signed-url/\${fileId}\${expiresIn ? \`?expiresIn=\${expiresIn}\` : ''}\`);
  },
  
  async list(options?: { bucket?: string; prefix?: string }) {
    const params = new URLSearchParams();
    if (options?.bucket) params.set('bucket', options.bucket);
    if (options?.prefix) params.set('prefix', options.prefix);
    
    return apiRequest<any[]>(\`/storage/list?\${params}\`);
  },
  
  async delete(fileId: string) {
    return apiRequest(\`/storage/\${fileId}\`, { method: 'DELETE' });
  },
};

/**
 * Database API (for calling REST endpoints)
 */
export function createDbClient<T = any>(tableName: string) {
  const baseUrl = \`\${API_URL}/api/\${tableName}\`;
  
  return {
    async findMany(options?: { page?: number; limit?: number; filter?: Record<string, any> }) {
      const params = new URLSearchParams();
      if (options?.page) params.set('_page', String(options.page));
      if (options?.limit) params.set('_limit', String(options.limit));
      if (options?.filter) {
        Object.entries(options.filter).forEach(([key, value]) => {
          params.set(key, String(value));
        });
      }
      
      return apiRequest<{ data: T[]; pagination: any }>(\`\${baseUrl}?\${params}\`);
    },
    
    async findById(id: string) {
      return apiRequest<T>(\`\${baseUrl}/\${id}\`);
    },
    
    async create(data: Partial<T>) {
      return apiRequest<T>(baseUrl, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    
    async update(id: string, data: Partial<T>) {
      return apiRequest<T>(\`\${baseUrl}/\${id}\`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },
    
    async delete(id: string) {
      return apiRequest(\`\${baseUrl}/\${id}\`, { method: 'DELETE' });
    },
  };
}

/**
 * Function invocation (for converted edge functions)
 */
export async function invokeFn<T = any>(
  functionName: string,
  options?: { body?: any; method?: string }
) {
  return apiRequest<T>(\`/functions/v1/\${functionName}\`, {
    method: options?.method || 'POST',
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
}

// Default export for compatibility
export default {
  auth,
  storage,
  invokeFn,
  apiRequest,
};
`;

  await fs.writeFile(path.join(libDir, 'api.ts'), apiClient, 'utf8');
  logger.debug('Created API client at src/lib/api.ts');
}

/**
 * Create React hooks for auth
 */
async function createAuthHooks(frontendDir: string, logger: Logger): Promise<void> {
  const hooksDir = path.join(frontendDir, 'src', 'hooks');
  await fs.ensureDir(hooksDir);
  
  const useAuth = `import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { auth, isAuthenticated, clearTokens, getAccessToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, metadata?: any) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const refreshUser = async () => {
    if (!isAuthenticated()) {
      setUser(null);
      setLoading(false);
      return;
    }
    
    const { data, error } = await auth.getUser();
    if (error) {
      clearTokens();
      setUser(null);
    } else {
      setUser(data);
    }
    setLoading(false);
  };
  
  useEffect(() => {
    refreshUser();
  }, []);
  
  const signIn = async (email: string, password: string) => {
    const { data, error } = await auth.signIn(email, password);
    if (!error && data) {
      setUser(data.user);
    }
    return { error };
  };
  
  const signUp = async (email: string, password: string, metadata?: any) => {
    const { data, error } = await auth.signUp(email, password, metadata);
    if (!error && data) {
      setUser(data.user);
    }
    return { error };
  };
  
  const signOut = async () => {
    await auth.signOut();
    setUser(null);
  };
  
  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default useAuth;
`;

  await fs.writeFile(path.join(hooksDir, 'useAuth.tsx'), useAuth, 'utf8');
  logger.debug('Created useAuth hook');
}

/**
 * Create React hooks for storage
 */
async function createStorageHooks(frontendDir: string, logger: Logger): Promise<void> {
  const hooksDir = path.join(frontendDir, 'src', 'hooks');
  await fs.ensureDir(hooksDir);
  
  const useStorage = `import { useState } from 'react';
import { storage } from '../../lib/api';

interface FileInfo {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  isPublic: boolean;
}

interface UploadOptions {
  bucket?: string;
  path?: string;
  isPublic?: boolean;
}

export function useFileUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const upload = async (file: File, options?: UploadOptions): Promise<FileInfo | null> => {
    setUploading(true);
    setProgress(0);
    setError(null);
    
    try {
      const { data, error } = await storage.upload(file, options);
      
      if (error) {
        setError(error.message);
        return null;
      }
      
      setProgress(100);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      return null;
    } finally {
      setUploading(false);
    }
  };
  
  const uploadMultiple = async (files: File[], options?: UploadOptions): Promise<FileInfo[]> => {
    setUploading(true);
    setProgress(0);
    setError(null);
    
    try {
      const { data, error } = await storage.uploadMultiple(files, options);
      
      if (error) {
        setError(error.message);
        return [];
      }
      
      setProgress(100);
      return data || [];
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      return [];
    } finally {
      setUploading(false);
    }
  };
  
  return {
    upload,
    uploadMultiple,
    uploading,
    progress,
    error,
  };
}

export function useFileList(bucket?: string, prefix?: string) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const refresh = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data, error } = await storage.list({ bucket, prefix });
      
      if (error) {
        setError(error.message);
      } else {
        setFiles(data || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };
  
  const deleteFile = async (fileId: string) => {
    const { error } = await storage.delete(fileId);
    if (!error) {
      setFiles(files.filter(f => f.id !== fileId));
    }
    return { error };
  };
  
  return {
    files,
    loading,
    error,
    refresh,
    deleteFile,
  };
}

export default { useFileUpload, useFileList };
`;

  await fs.writeFile(path.join(hooksDir, 'useStorage.ts'), useStorage, 'utf8');
  logger.debug('Created useStorage hook');
}

/**
 * Create AuthContext that wraps the app
 */
async function createAuthContext(frontendDir: string, logger: Logger): Promise<void> {
  const contextsDir = path.join(frontendDir, 'src', 'contexts');
  await fs.ensureDir(contextsDir);
  
  // Check if AuthContext exists and needs to be updated
  const authContextPath = path.join(contextsDir, 'AuthContext.tsx');
  
  const newAuthContext = `/**
 * AuthContext for self-hosted backend
 * Replaces Supabase auth with JWT-based authentication
 */
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth, isAuthenticated, clearTokens, getAccessToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

interface Session {
  access_token: string;
  user: User;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ data: any; error: any }>;
  signUp: (email: string, password: string, options?: { data?: any }) => Promise<{ data: any; error: any }>;
  signOut: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      if (!isAuthenticated()) {
        setUser(null);
        setSession(null);
        setLoading(false);
        return;
      }

      const { data, error } = await auth.getUser();
      if (error) {
        clearTokens();
        setUser(null);
        setSession(null);
      } else if (data) {
        setUser(data);
        setSession({ access_token: getAccessToken() || '', user: data });
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      clearTokens();
      setUser(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await auth.signIn(email, password);
    if (!error && data) {
      setUser(data.user);
      setSession({ access_token: data.access_token, user: data.user });
    }
    return { data, error };
  };

  const signUp = async (email: string, password: string, options?: { data?: any }) => {
    const { data, error } = await auth.signUp(email, password, options?.data);
    if (!error && data) {
      setUser(data.user);
      setSession({ access_token: data.access_token, user: data.user });
    }
    return { data, error };
  };

  const signOut = async () => {
    await auth.signOut();
    setUser(null);
    setSession(null);
  };

  const updateProfile = async (profileData: Partial<User>) => {
    const { data, error } = await auth.updateUser(profileData);
    if (!error && data) {
      setUser(prev => prev ? { ...prev, ...data } : data);
    }
    return { error };
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      signIn,
      signUp,
      signOut,
      updateProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// For compatibility with existing code
export const useSession = useAuth;

export default AuthContext;
`;

  await fs.writeFile(authContextPath, newAuthContext, 'utf8');
  logger.debug('Created/updated AuthContext');
}

/**
 * Replace the Supabase client file with a compatibility layer
 */
async function replaceSupabaseClient(frontendDir: string, logger: Logger): Promise<void> {
  // Find the Supabase client file
  const possiblePaths = [
    path.join(frontendDir, 'src', 'integrations', 'supabase', 'client.ts'),
    path.join(frontendDir, 'src', 'lib', 'supabase.ts'),
    path.join(frontendDir, 'src', 'supabase', 'client.ts'),
    path.join(frontendDir, 'src', 'utils', 'supabase.ts'),
  ];
  
  let supabaseClientPath: string | null = null;
  for (const p of possiblePaths) {
    if (await fs.pathExists(p)) {
      supabaseClientPath = p;
      break;
    }
  }
  
  // Create a compatibility layer that mimics Supabase client interface
  const compatLayer = `/**
 * Supabase-compatible client for self-hosted backend
 * This file provides the same interface as @supabase/supabase-js
 * but routes all calls through the self-hosted Express backend.
 * 
 * AUTO-GENERATED - DO NOT EDIT
 */
import { auth, storage, invokeFn, apiRequest, getAccessToken, clearTokens } from '../../lib/api';

// Re-export the API client as 'supabase' for compatibility
export const supabase = {
  auth: {
    getSession: async () => {
      const token = getAccessToken();
      if (!token) return { data: { session: null }, error: null };
      
      const { data: user, error } = await auth.getUser();
      if (error) return { data: { session: null }, error };
      
      return {
        data: {
          session: {
            access_token: token,
            user,
          }
        },
        error: null
      };
    },
    
    getUser: async () => {
      const { data, error } = await auth.getUser();
      return { data: { user: data }, error };
    },
    
    signInWithPassword: async (credentials: { email: string; password: string }) => {
      const { data, error } = await auth.signIn(credentials.email, credentials.password);
      if (error) return { data: { user: null, session: null }, error };
      
      return {
        data: {
          user: data.user,
          session: {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            user: data.user,
          }
        },
        error: null
      };
    },
    
    signUp: async (credentials: { email: string; password: string; options?: { data?: any } }) => {
      const { data, error } = await auth.signUp(credentials.email, credentials.password, credentials.options?.data);
      if (error) return { data: { user: null, session: null }, error };
      
      return {
        data: {
          user: data.user,
          session: {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            user: data.user,
          }
        },
        error: null
      };
    },
    
    signOut: async () => {
      await auth.signOut();
      return { error: null };
    },
    
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      // Check current auth state
      const token = getAccessToken();
      if (token) {
        auth.getUser().then(({ data }) => {
          if (data) {
            callback('SIGNED_IN', { access_token: token, user: data });
          } else {
            callback('SIGNED_OUT', null);
          }
        });
      } else {
        setTimeout(() => callback('SIGNED_OUT', null), 0);
      }
      
      return {
        data: {
          subscription: {
            unsubscribe: () => {}
          }
        }
      };
    },
    
    updateUser: async (attributes: { data?: any }) => {
      const { data, error } = await auth.updateUser(attributes.data || attributes);
      return { data: { user: data }, error };
    },
  },
  
  storage: {
    from: (bucket: string) => ({
      upload: async (path: string, file: File) => {
        const { data, error } = await storage.upload(file, { bucket, path });
        return { data, error };
      },
      download: async (path: string) => {
        const blob = await storage.download(path);
        return { data: blob, error: null };
      },
      getPublicUrl: (path: string) => {
        return { data: { publicUrl: storage.getPublicUrl(path) } };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) {
          await storage.delete(p);
        }
        return { data: null, error: null };
      },
      list: async (prefix?: string) => {
        const { data, error } = await storage.list({ bucket, prefix });
        return { data, error };
      },
    }),
  },
  
  functions: {
    invoke: async <T = any>(functionName: string, options?: { body?: any }) => {
      return invokeFn<T>(functionName, options);
    },
  },
  
  from: (table: string) => createQueryBuilder(table),
  
  rpc: async (functionName: string, params?: any) => {
    return apiRequest(\`/api/rpc/\${functionName}\`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },
};

// Query builder that mimics Supabase's interface
function createQueryBuilder(table: string) {
  let query: any = {
    _table: table,
    _select: '*',
    _filters: [] as string[],
    _order: null as string | null,
    _limit: null as number | null,
    _single: false,
  };
  
  const builder = {
    select: (columns = '*') => {
      query._select = columns;
      return builder;
    },
    
    insert: async (data: any) => {
      const { data: result, error } = await apiRequest(\`/api/\${query._table}\`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return { data: result, error };
    },
    
    update: (data: any) => {
      query._updateData = data;
      return builder;
    },
    
    delete: () => {
      query._delete = true;
      return builder;
    },
    
    eq: (column: string, value: any) => {
      query._filters.push(\`\${column}=\${encodeURIComponent(value)}\`);
      return builder;
    },
    
    neq: (column: string, value: any) => {
      query._filters.push(\`\${column}_ne=\${encodeURIComponent(value)}\`);
      return builder;
    },
    
    gt: (column: string, value: any) => {
      query._filters.push(\`\${column}_gt=\${encodeURIComponent(value)}\`);
      return builder;
    },
    
    gte: (column: string, value: any) => {
      query._filters.push(\`\${column}_gte=\${encodeURIComponent(value)}\`);
      return builder;
    },
    
    lt: (column: string, value: any) => {
      query._filters.push(\`\${column}_lt=\${encodeURIComponent(value)}\`);
      return builder;
    },
    
    lte: (column: string, value: any) => {
      query._filters.push(\`\${column}_lte=\${encodeURIComponent(value)}\`);
      return builder;
    },
    
    like: (column: string, pattern: string) => {
      query._filters.push(\`\${column}_like=\${encodeURIComponent(pattern)}\`);
      return builder;
    },
    
    ilike: (column: string, pattern: string) => {
      query._filters.push(\`\${column}_ilike=\${encodeURIComponent(pattern)}\`);
      return builder;
    },
    
    in: (column: string, values: any[]) => {
      query._filters.push(\`\${column}_in=\${encodeURIComponent(values.join(','))}\`);
      return builder;
    },
    
    order: (column: string, options?: { ascending?: boolean }) => {
      const dir = options?.ascending === false ? 'desc' : 'asc';
      query._order = \`\${column}:\${dir}\`;
      return builder;
    },
    
    limit: (count: number) => {
      query._limit = count;
      return builder;
    },
    
    single: () => {
      query._single = true;
      query._limit = 1;
      return builder;
    },
    
    maybeSingle: () => {
      query._single = true;
      query._limit = 1;
      return builder;
    },
    
    then: async (resolve: Function) => {
      const result = await executeQuery(query);
      resolve(result);
    },
  };
  
  return builder;
}

async function executeQuery(query: any) {
  const params = new URLSearchParams();
  
  if (query._select && query._select !== '*') {
    params.set('_select', query._select);
  }
  
  query._filters.forEach((f: string) => {
    const [key, value] = f.split('=');
    params.set(key, value);
  });
  
  if (query._order) {
    params.set('_sort', query._order);
  }
  
  if (query._limit) {
    params.set('_limit', String(query._limit));
  }
  
  const url = \`/api/\${query._table}\${params.toString() ? '?' + params.toString() : ''}\`;
  
  if (query._delete) {
    const { data, error } = await apiRequest(url, { method: 'DELETE' });
    return { data, error };
  }
  
  if (query._updateData) {
    const { data, error } = await apiRequest(url, {
      method: 'PATCH',
      body: JSON.stringify(query._updateData),
    });
    return { data, error };
  }
  
  const { data, error } = await apiRequest(url);
  
  if (query._single && Array.isArray(data)) {
    return { data: data[0] || null, error };
  }
  
  return { data, error };
}

export default supabase;
`;

  // Write to integrations/supabase/client.ts (most common location)
  const integrationsDir = path.join(frontendDir, 'src', 'integrations', 'supabase');
  await fs.ensureDir(integrationsDir);
  
  const clientPath = path.join(integrationsDir, 'client.ts');
  
  // Backup original if it exists
  if (await fs.pathExists(clientPath)) {
    await fs.copy(clientPath, clientPath + '.backup');
    logger.debug('Backed up original Supabase client');
  }
  
  await fs.writeFile(clientPath, compatLayer, 'utf8');
  logger.debug('Created Supabase compatibility layer');
  
  // Also create in src/lib if not exists
  const libSupabasePath = path.join(frontendDir, 'src', 'lib', 'supabase.ts');
  if (!(await fs.pathExists(libSupabasePath))) {
    await fs.writeFile(libSupabasePath, `// Re-export from integrations for compatibility
export { supabase, supabase as default } from '../integrations/supabase/client';
`, 'utf8');
  }
}

/**
 * Update existing Supabase usage in the frontend
 */
async function replaceSupabaseUsage(frontendDir: string, logger: Logger): Promise<void> {
  const srcDir = path.join(frontendDir, 'src');
  if (!(await fs.pathExists(srcDir))) return;
  
  const files = await fg(['**/*.{ts,tsx,js,jsx}'], { 
    cwd: srcDir, 
    onlyFiles: true,
    ignore: [
      '**/lib/api.ts', 
      '**/hooks/useAuth.tsx', 
      '**/hooks/useStorage.ts',
      '**/integrations/supabase/client.ts',
      '**/integrations/supabase/client.ts.backup',
    ]
  });
  
  let updatedCount = 0;
  
  for (const file of files) {
    const filePath = path.join(srcDir, file);
    let content = await fs.readFile(filePath, 'utf8');
    let modified = false;
    const originalContent = content;
    
    // Replace supabase.functions.invoke with invokeFn
    if (content.includes('supabase.functions.invoke')) {
      // Add import for invokeFn if not present
      if (!content.includes("from '@/lib/api'") && 
          !content.includes('from "../lib/api"') &&
          !content.includes("from '../../lib/api'")) {
        
        // Find the first import statement and add our import after it
        const importMatch = content.match(/^(import\s+.+from\s+['"][^'"]+['"];?\s*\n)/m);
        if (importMatch) {
          const importLine = "import { invokeFn } from '@/lib/api';\n";
          content = content.replace(importMatch[0], importMatch[0] + importLine);
          modified = true;
        }
      }
      
      // Replace supabase.functions.invoke('name', { body: data }) with invokeFn('name', { body: data })
      content = content.replace(
        /supabase\.functions\.invoke\s*\(\s*['"]([^'"]+)['"]\s*,\s*\{([^}]*)\}\s*\)/g,
        "invokeFn('$1', {$2})"
      );
      
      // Replace supabase.functions.invoke('name') with invokeFn('name')
      content = content.replace(
        /supabase\.functions\.invoke\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        "invokeFn('$1')"
      );
      
      modified = true;
    }
    
    // Update App.tsx or main.tsx to wrap with AuthProvider if needed
    if ((file === 'App.tsx' || file === 'main.tsx') && !content.includes('AuthProvider')) {
      // Check if it uses Supabase auth context and replace it
      if (content.includes('AuthProvider') === false && 
          (content.includes('useAuth') || content.includes('useSession'))) {
        // Add AuthProvider import
        if (!content.includes("from './contexts/AuthContext'") && 
            !content.includes("from '@/contexts/AuthContext'")) {
          const importMatch = content.match(/^(import\s+.+from\s+['"][^'"]+['"];?\s*\n)/m);
          if (importMatch) {
            const importLine = "import { AuthProvider } from './contexts/AuthContext';\n";
            content = content.replace(importMatch[0], importMatch[0] + importLine);
            modified = true;
          }
        }
      }
    }
    
    // Replace direct Supabase auth calls with our auth module
    if (content.includes('supabase.auth.')) {
      // These are handled by the compatibility layer, but log a note
      logger.debug(`File ${file} uses supabase.auth.* - handled by compatibility layer`);
    }
    
    // Replace direct Supabase storage calls
    if (content.includes('supabase.storage.')) {
      logger.debug(`File ${file} uses supabase.storage.* - handled by compatibility layer`);
    }
    
    // If content changed, write it back
    if (content !== originalContent) {
      await fs.writeFile(filePath, content, 'utf8');
      logger.debug(`Updated: ${file}`);
      updatedCount++;
    }
  }
  
  if (updatedCount > 0) {
    logger.info(`Updated ${updatedCount} files for self-hosted backend`);
  }
}
