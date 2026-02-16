/**
 * Self-hosted JWT Authentication templates
 * Replaces Supabase Auth with custom JWT-based authentication using bcrypt + jsonwebtoken
 */

import type { SelfHostedConfig } from '../config.js';

export interface AuthOptions {
  config: SelfHostedConfig;
}

/**
 * Generate JWT auth service
 */
export function generateAuthService(options: AuthOptions): string {
  const { config } = options;
  const authConfig = config.auth || {};
  const accessExpiry = authConfig.accessTokenExpiry || '15m';
  const refreshExpiry = authConfig.refreshTokenExpiry || '7d';
  const bcryptRounds = authConfig.bcryptRounds || 12;

  return `import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';

// Auth configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');
const ACCESS_TOKEN_EXPIRY = '${accessExpiry}';
const REFRESH_TOKEN_EXPIRY = '${refreshExpiry}';
const BCRYPT_ROUNDS = ${bcryptRounds};

// Warn if using auto-generated secrets (development only)
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set - using auto-generated secret. Set JWT_SECRET in production!');
}

export interface TokenPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface UserPublic {
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string | null;
  avatarUrl: string | null;
  metadata: any;
  createdAt: Date;
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate access and refresh tokens
 */
export function generateTokens(userId: string, email: string): AuthTokens {
  const accessToken = jwt.sign(
    { userId, email, type: 'access' } as TokenPayload,
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
  
  const refreshToken = jwt.sign(
    { userId, email, type: 'refresh' } as TokenPayload,
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
  
  // Calculate expiry in seconds
  const decoded = jwt.decode(accessToken) as jwt.JwtPayload;
  const expiresIn = decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 900;
  
  return {
    accessToken,
    refreshToken,
    expiresIn,
    tokenType: 'Bearer',
  };
}

/**
 * Verify an access token
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    if (payload.type !== 'access') return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify a refresh token
 */
export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
    if (payload.type !== 'refresh') return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Strip sensitive fields from user object
 */
export function toPublicUser(user: any): UserPublic {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    metadata: user.metadata,
    createdAt: user.createdAt,
  };
}

/**
 * Sign up a new user
 */
export async function signUp(
  email: string,
  password: string,
  metadata?: { fullName?: string; [key: string]: any }
): Promise<{ user: UserPublic; tokens: AuthTokens }> {
  // Check if user exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AuthError('User already exists', 'USER_EXISTS', 409);
  }
  
  // Validate password strength
  if (password.length < 8) {
    throw new AuthError('Password must be at least 8 characters', 'WEAK_PASSWORD', 400);
  }
  
  // Create user
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      passwordHash,
      fullName: metadata?.fullName,
      metadata: metadata || {},
    },
  });
  
  // Auto-create profile if the profiles table exists (for Supabase-migrated schemas)
  // This ensures FK constraints on tables referencing profiles.id work correctly
  try {
    if ((prisma as any).profiles) {
      // Try to create profile with common field patterns
      // Different Supabase schemas may have different profile structures
      await (prisma as any).profiles.create({
        data: {
          id: user.id,                              // Primary key (same as user id for simple FK)
          user_id: user.id,                         // Foreign key to users table
          name: metadata?.fullName || user.email,   // Display name
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      console.log('Created profile for user:', user.id);
    }
  } catch (profileError: any) {
    // If profile creation fails due to schema mismatch, try alternative field names
    try {
      if ((prisma as any).profiles) {
        await (prisma as any).profiles.create({
          data: {
            user_id: user.id,
            email: user.email,
            full_name: metadata?.fullName || null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        console.log('Created profile (alt schema) for user:', user.id);
      }
    } catch (altError) {
      // Profile creation is optional - log but don't fail signup
      console.warn('Could not create profile:', profileError.message || profileError);
    }
  }
  
  // Generate tokens
  const tokens = generateTokens(user.id, user.email);
  
  // Store refresh token
  await storeRefreshToken(user.id, tokens.refreshToken);
  
  return {
    user: toPublicUser(user),
    tokens,
  };
}

/**
 * Sign in with email and password
 */
export async function signIn(
  email: string,
  password: string,
  deviceInfo?: { userAgent?: string; ipAddress?: string }
): Promise<{ user: UserPublic; tokens: AuthTokens }> {
  // Find user
  const user = await prisma.user.findUnique({ 
    where: { email: email.toLowerCase().trim() } 
  });
  
  if (!user) {
    throw new AuthError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }
  
  // Verify password
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new AuthError('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }
  
  // Update last sign in
  await prisma.user.update({
    where: { id: user.id },
    data: { lastSignInAt: new Date() },
  });
  
  // Generate tokens
  const tokens = generateTokens(user.id, user.email);
  
  // Store refresh token with device info
  await storeRefreshToken(user.id, tokens.refreshToken, deviceInfo);
  
  return {
    user: toPublicUser(user),
    tokens,
  };
}

/**
 * Sign out (invalidate refresh token)
 */
export async function signOut(refreshToken: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { token: refreshToken },
  });
}

/**
 * Sign out from all devices
 */
export async function signOutAll(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { userId },
  });
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<AuthTokens> {
  // Verify refresh token
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    throw new AuthError('Invalid refresh token', 'INVALID_TOKEN', 401);
  }
  
  // Check if refresh token exists in database (not revoked)
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });
  
  if (!storedToken || storedToken.expiresAt < new Date()) {
    throw new AuthError('Refresh token expired or revoked', 'TOKEN_EXPIRED', 401);
  }
  
  // Generate new tokens
  const tokens = generateTokens(storedToken.userId, storedToken.user.email);
  
  // Replace old refresh token with new one (rotation)
  await prisma.refreshToken.delete({ where: { id: storedToken.id } });
  await storeRefreshToken(storedToken.userId, tokens.refreshToken, {
    userAgent: storedToken.userAgent || undefined,
    ipAddress: storedToken.ipAddress || undefined,
  });
  
  return tokens;
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<UserPublic | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user ? toPublicUser(user) : null;
}

/**
 * Update user profile
 */
export async function updateUser(
  userId: string,
  data: { fullName?: string; avatarUrl?: string; metadata?: any }
): Promise<UserPublic> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      fullName: data.fullName,
      avatarUrl: data.avatarUrl,
      metadata: data.metadata,
    },
  });
  
  return toPublicUser(user);
}

/**
 * Change password
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
  }
  
  // Verify current password
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AuthError('Current password is incorrect', 'INVALID_PASSWORD', 400);
  }
  
  // Validate new password
  if (newPassword.length < 8) {
    throw new AuthError('Password must be at least 8 characters', 'WEAK_PASSWORD', 400);
  }
  
  // Update password
  const newHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });
  
  // Invalidate all refresh tokens (force re-login)
  await signOutAll(userId);
}

/**
 * Request password reset (generate reset token)
 */
export async function requestPasswordReset(email: string): Promise<string> {
  const user = await prisma.user.findUnique({ 
    where: { email: email.toLowerCase().trim() } 
  });
  
  if (!user) {
    // Don't reveal if user exists
    return crypto.randomBytes(32).toString('hex');
  }
  
  // Generate reset token (valid for 1 hour)
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = await hashPassword(resetToken);
  
  // Store in user metadata (or you could use a separate table)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      metadata: {
        ...user.metadata as object,
        passwordResetToken: resetTokenHash,
        passwordResetExpires: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      },
    },
  });
  
  return resetToken;
}

/**
 * Reset password with token
 */
export async function resetPassword(
  email: string,
  token: string,
  newPassword: string
): Promise<void> {
  const user = await prisma.user.findUnique({ 
    where: { email: email.toLowerCase().trim() } 
  });
  
  if (!user) {
    throw new AuthError('Invalid or expired reset token', 'INVALID_TOKEN', 400);
  }
  
  const metadata = user.metadata as any;
  
  // Check if reset token exists and is valid
  if (!metadata?.passwordResetToken || !metadata?.passwordResetExpires) {
    throw new AuthError('Invalid or expired reset token', 'INVALID_TOKEN', 400);
  }
  
  // Check expiry
  if (new Date(metadata.passwordResetExpires) < new Date()) {
    throw new AuthError('Reset token has expired', 'TOKEN_EXPIRED', 400);
  }
  
  // Verify token
  const valid = await verifyPassword(token, metadata.passwordResetToken);
  if (!valid) {
    throw new AuthError('Invalid or expired reset token', 'INVALID_TOKEN', 400);
  }
  
  // Validate new password
  if (newPassword.length < 8) {
    throw new AuthError('Password must be at least 8 characters', 'WEAK_PASSWORD', 400);
  }
  
  // Update password and clear reset token
  const newHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newHash,
      metadata: {
        ...metadata,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    },
  });
  
  // Invalidate all sessions
  await signOutAll(user.id);
}

/**
 * Store refresh token in database
 */
async function storeRefreshToken(
  userId: string,
  token: string,
  deviceInfo?: { userAgent?: string; ipAddress?: string }
): Promise<void> {
  // Calculate expiry from token
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  const expiresAt = new Date((decoded.exp || 0) * 1000);
  
  await prisma.refreshToken.create({
    data: {
      token,
      userId,
      expiresAt,
      userAgent: deviceInfo?.userAgent,
      ipAddress: deviceInfo?.ipAddress,
    },
  });
  
  // Clean up expired tokens for this user
  await prisma.refreshToken.deleteMany({
    where: {
      userId,
      expiresAt: { lt: new Date() },
    },
  });
}

/**
 * Custom Auth Error class
 */
export class AuthError extends Error {
  code: string;
  statusCode: number;
  
  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
`;
}

/**
 * Generate auth routes for self-hosted mode
 */
export function generateSelfHostedAuthRoutes(): string {
  return `import { Router, Request, Response, NextFunction } from 'express';
import {
  signUp,
  signIn,
  signOut,
  signOutAll,
  refreshAccessToken,
  getUserById,
  updateUser,
  changePassword,
  requestPasswordReset,
  resetPassword,
  AuthError,
} from '../services/auth.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

/**
 * POST /auth/signup
 * Register a new user
 */
router.post('/signup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, ...metadata } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
        code: 'MISSING_FIELDS',
      });
    }
    
    const result = await signUp(email, password, metadata);
    
    res.status(201).json({
      user: result.user,
      access_token: result.tokens.accessToken,
      refresh_token: result.tokens.refreshToken,
      expires_in: result.tokens.expiresIn,
      token_type: result.tokens.tokenType,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * POST /auth/signin
 * Sign in with email and password
 */
router.post('/signin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
        code: 'MISSING_FIELDS',
      });
    }
    
    const result = await signIn(email, password, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    
    res.json({
      user: result.user,
      access_token: result.tokens.accessToken,
      refresh_token: result.tokens.refreshToken,
      expires_in: result.tokens.expiresIn,
      token_type: result.tokens.tokenType,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * POST /auth/signout
 * Sign out (invalidate refresh token)
 */
router.post('/signout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refresh_token } = req.body;
    
    if (refresh_token) {
      await signOut(refresh_token);
    }
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/signout-all
 * Sign out from all devices
 */
router.post('/signout-all', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await signOutAll(req.user!.userId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refresh_token } = req.body;
    
    if (!refresh_token) {
      return res.status(400).json({
        error: 'Refresh token is required',
        code: 'MISSING_TOKEN',
      });
    }
    
    const tokens = await refreshAccessToken(refresh_token);
    
    res.json({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      token_type: tokens.tokenType,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * GET /auth/user
 * Get current user
 */
router.get('/user', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await getUserById(req.user!.userId);
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }
    
    res.json(user);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /auth/user
 * Update current user profile
 */
router.put('/user', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName, avatarUrl, metadata } = req.body;
    
    const user = await updateUser(req.user!.userId, {
      fullName,
      avatarUrl,
      metadata,
    });
    
    res.json(user);
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * POST /auth/change-password
 * Change password
 */
router.post('/change-password', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and new password are required',
        code: 'MISSING_FIELDS',
      });
    }
    
    await changePassword(req.user!.userId, currentPassword, newPassword);
    
    res.json({ success: true, message: 'Password changed. Please sign in again.' });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * POST /auth/recover
 * Request password reset
 */
router.post('/recover', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        error: 'Email is required',
        code: 'MISSING_EMAIL',
      });
    }
    
    const resetToken = await requestPasswordReset(email);
    
    // In production, send this token via email
    // For development, we return it (don't do this in production!)
    if (process.env.NODE_ENV === 'development') {
      res.json({ 
        success: true, 
        message: 'Password reset requested',
        // DEV ONLY - remove in production!
        _devResetToken: resetToken,
      });
    } else {
      res.json({ 
        success: true, 
        message: 'If an account exists, a reset email has been sent',
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, token, newPassword } = req.body;
    
    if (!email || !token || !newPassword) {
      return res.status(400).json({
        error: 'Email, token, and new password are required',
        code: 'MISSING_FIELDS',
      });
    }
    
    await resetPassword(email, token, newPassword);
    
    res.json({ success: true, message: 'Password reset successful. Please sign in.' });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

export { router as authRouter };
`;
}

/**
 * Generate self-hosted auth middleware
 */
export function generateSelfHostedAuthMiddleware(): string {
  return `import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../services/auth.js';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Middleware to require authentication
 * Extracts and validates JWT from Authorization header
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authorization header required',
      code: 'UNAUTHORIZED',
    });
    return;
  }
  
  const token = authHeader.substring(7);
  const payload = verifyAccessToken(token);
  
  if (!payload) {
    res.status(401).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN',
    });
    return;
  }
  
  req.user = payload;
  next();
}

/**
 * Middleware for optional authentication
 * Validates token if present, but doesn't require it
 */
export function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);
    
    if (payload) {
      req.user = payload;
    }
  }
  
  next();
}

/**
 * Middleware to require specific user (self only)
 * Use after authMiddleware
 */
export function requireSelf(userIdParam: string = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const paramUserId = req.params[userIdParam];
    
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
      });
      return;
    }
    
    if (paramUserId && paramUserId !== req.user.userId) {
      res.status(403).json({
        error: 'Access denied',
        code: 'FORBIDDEN',
      });
      return;
    }
    
    next();
  };
}
`;
}
