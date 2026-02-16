/**
 * Self-hosted storage templates
 * Supports local filesystem and MinIO (S3-compatible) storage
 */

import type { SelfHostedConfig } from '../config.js';

export interface StorageOptions {
  config: SelfHostedConfig;
}

/**
 * Generate storage service that supports both local and MinIO
 */
export function generateStorageService(options: StorageOptions): string {
  const { config } = options;
  const storageConfig = config.storage || { provider: 'local' };
  const provider = storageConfig.provider || 'local';
  
  return `import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Client as MinioClient } from 'minio';
import prisma from '../lib/prisma.js';
import mime from 'mime-types';

// Storage configuration
const STORAGE_PROVIDER = process.env.STORAGE_PROVIDER || '${provider}';
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || '${storageConfig.localPath || './uploads'}';

// MinIO configuration
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '${storageConfig.minio?.endpoint || 'localhost'}';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '${storageConfig.minio?.port || 9000}');
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || '${storageConfig.minio?.accessKey || 'minioadmin'}';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || '${storageConfig.minio?.secretKey || 'minioadmin'}';
const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
const DEFAULT_BUCKET = process.env.STORAGE_BUCKET || '${storageConfig.minio?.bucket || 'app-storage'}';

// Lazy-loaded MinIO client
let minioClient: MinioClient | null = null;

function getMinioClient(): MinioClient {
  if (!minioClient) {
    minioClient = new MinioClient({
      endPoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSSL: MINIO_USE_SSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
  }
  return minioClient;
}

export interface UploadOptions {
  bucket?: string;
  path?: string;
  filename?: string;
  contentType?: string;
  isPublic?: boolean;
  userId?: string;
  metadata?: Record<string, string>;
}

export interface FileInfo {
  id: string;
  bucket: string;
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  provider: string;
  isPublic: boolean;
  url: string;
  createdAt: Date;
}

export interface StorageProvider {
  upload(buffer: Buffer, options: UploadOptions): Promise<FileInfo>;
  download(fileId: string): Promise<{ buffer: Buffer; info: FileInfo }>;
  delete(fileId: string): Promise<void>;
  getSignedUrl(fileId: string, expiresIn?: number): Promise<string>;
  list(bucket?: string, prefix?: string): Promise<FileInfo[]>;
}

/**
 * Generate a unique storage key
 */
function generateStorageKey(filename: string): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(filename);
  const base = path.basename(filename, ext).slice(0, 32).replace(/[^a-zA-Z0-9-_]/g, '_');
  return \`\${timestamp}-\${random}-\${base}\${ext}\`;
}

/**
 * Local filesystem storage provider
 */
class LocalStorageProvider implements StorageProvider {
  private basePath: string;
  
  constructor(basePath: string = LOCAL_STORAGE_PATH) {
    this.basePath = path.resolve(basePath);
  }
  
  async ensureBucket(bucket: string): Promise<void> {
    const bucketPath = path.join(this.basePath, bucket);
    await fs.mkdir(bucketPath, { recursive: true });
  }
  
  async upload(buffer: Buffer, options: UploadOptions): Promise<FileInfo> {
    const bucket = options.bucket || DEFAULT_BUCKET;
    const subPath = options.path || '';
    const filename = options.filename || 'unnamed';
    const storageKey = generateStorageKey(filename);
    
    // Ensure directory exists
    const fullDir = path.join(this.basePath, bucket, subPath);
    await fs.mkdir(fullDir, { recursive: true });
    
    // Write file
    const fullPath = path.join(fullDir, storageKey);
    await fs.writeFile(fullPath, buffer);
    
    // Detect mime type
    const mimeType = options.contentType || mime.lookup(filename) || 'application/octet-stream';
    
    // Store metadata in database
    const fileRecord = await prisma.fileStorage.create({
      data: {
        bucket,
        path: subPath,
        filename,
        mimeType,
        size: buffer.length,
        provider: 'local',
        storageKey: path.join(subPath, storageKey),
        userId: options.userId,
        isPublic: options.isPublic || false,
      },
    });
    
    return {
      id: fileRecord.id,
      bucket: fileRecord.bucket,
      path: fileRecord.path,
      filename: fileRecord.filename,
      mimeType: fileRecord.mimeType,
      size: fileRecord.size,
      provider: 'local',
      isPublic: fileRecord.isPublic,
      url: this.getPublicUrl(fileRecord.id),
      createdAt: fileRecord.createdAt,
    };
  }
  
  async download(fileId: string): Promise<{ buffer: Buffer; info: FileInfo }> {
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id: fileId } });
    
    if (!fileRecord) {
      throw new StorageError('File not found', 'FILE_NOT_FOUND', 404);
    }
    
    const fullPath = path.join(this.basePath, fileRecord.bucket, fileRecord.storageKey);
    
    try {
      const buffer = await fs.readFile(fullPath);
      
      return {
        buffer,
        info: {
          id: fileRecord.id,
          bucket: fileRecord.bucket,
          path: fileRecord.path,
          filename: fileRecord.filename,
          mimeType: fileRecord.mimeType,
          size: fileRecord.size,
          provider: 'local',
          isPublic: fileRecord.isPublic,
          url: this.getPublicUrl(fileRecord.id),
          createdAt: fileRecord.createdAt,
        },
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new StorageError('File not found on disk', 'FILE_MISSING', 404);
      }
      throw error;
    }
  }
  
  async delete(fileId: string): Promise<void> {
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id: fileId } });
    
    if (!fileRecord) {
      throw new StorageError('File not found', 'FILE_NOT_FOUND', 404);
    }
    
    const fullPath = path.join(this.basePath, fileRecord.bucket, fileRecord.storageKey);
    
    try {
      await fs.unlink(fullPath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    await prisma.fileStorage.delete({ where: { id: fileId } });
  }
  
  async getSignedUrl(fileId: string, expiresIn: number = 3600): Promise<string> {
    // For local storage, we generate a temporary token
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id: fileId } });
    
    if (!fileRecord) {
      throw new StorageError('File not found', 'FILE_NOT_FOUND', 404);
    }
    
    // Create a signed token (simple approach - you may want to use JWT for more security)
    const expires = Date.now() + (expiresIn * 1000);
    const signature = crypto
      .createHmac('sha256', process.env.JWT_SECRET || 'storage-secret')
      .update(\`\${fileId}:\${expires}\`)
      .digest('hex');
    
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    return \`\${baseUrl}/storage/download/\${fileId}?expires=\${expires}&signature=\${signature}\`;
  }
  
  async list(bucket?: string, prefix?: string): Promise<FileInfo[]> {
    const where: any = {};
    if (bucket) where.bucket = bucket;
    if (prefix) where.path = { startsWith: prefix };
    where.provider = 'local';
    
    const files = await prisma.fileStorage.findMany({ where });
    
    return files.map(f => ({
      id: f.id,
      bucket: f.bucket,
      path: f.path,
      filename: f.filename,
      mimeType: f.mimeType,
      size: f.size,
      provider: 'local',
      isPublic: f.isPublic,
      url: this.getPublicUrl(f.id),
      createdAt: f.createdAt,
    }));
  }
  
  getPublicUrl(fileId: string): string {
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    return \`\${baseUrl}/storage/public/\${fileId}\`;
  }
  
  getBasePath(): string {
    return this.basePath;
  }
}

/**
 * MinIO (S3-compatible) storage provider
 */
class MinioStorageProvider implements StorageProvider {
  private client: MinioClient;
  
  constructor() {
    this.client = getMinioClient();
  }
  
  async ensureBucket(bucket: string): Promise<void> {
    const exists = await this.client.bucketExists(bucket);
    if (!exists) {
      await this.client.makeBucket(bucket);
      console.log(\`Created MinIO bucket: \${bucket}\`);
    }
  }
  
  async upload(buffer: Buffer, options: UploadOptions): Promise<FileInfo> {
    const bucket = options.bucket || DEFAULT_BUCKET;
    const subPath = options.path || '';
    const filename = options.filename || 'unnamed';
    const storageKey = path.join(subPath, generateStorageKey(filename));
    
    // Ensure bucket exists
    await this.ensureBucket(bucket);
    
    // Detect mime type
    const mimeType = options.contentType || mime.lookup(filename) || 'application/octet-stream';
    
    // Upload to MinIO
    await this.client.putObject(bucket, storageKey, buffer, buffer.length, {
      'Content-Type': mimeType,
      ...options.metadata,
    });
    
    // Store metadata in database
    const fileRecord = await prisma.fileStorage.create({
      data: {
        bucket,
        path: subPath,
        filename,
        mimeType,
        size: buffer.length,
        provider: 'minio',
        storageKey,
        userId: options.userId,
        isPublic: options.isPublic || false,
      },
    });
    
    return {
      id: fileRecord.id,
      bucket: fileRecord.bucket,
      path: fileRecord.path,
      filename: fileRecord.filename,
      mimeType: fileRecord.mimeType,
      size: fileRecord.size,
      provider: 'minio',
      isPublic: fileRecord.isPublic,
      url: await this.getPublicUrl(fileRecord.id),
      createdAt: fileRecord.createdAt,
    };
  }
  
  async download(fileId: string): Promise<{ buffer: Buffer; info: FileInfo }> {
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id: fileId } });
    
    if (!fileRecord) {
      throw new StorageError('File not found', 'FILE_NOT_FOUND', 404);
    }
    
    try {
      const stream = await this.client.getObject(fileRecord.bucket, fileRecord.storageKey);
      const chunks: Buffer[] = [];
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      
      return {
        buffer: Buffer.concat(chunks),
        info: {
          id: fileRecord.id,
          bucket: fileRecord.bucket,
          path: fileRecord.path,
          filename: fileRecord.filename,
          mimeType: fileRecord.mimeType,
          size: fileRecord.size,
          provider: 'minio',
          isPublic: fileRecord.isPublic,
          url: await this.getPublicUrl(fileRecord.id),
          createdAt: fileRecord.createdAt,
        },
      };
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        throw new StorageError('File not found in storage', 'FILE_MISSING', 404);
      }
      throw error;
    }
  }
  
  async delete(fileId: string): Promise<void> {
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id: fileId } });
    
    if (!fileRecord) {
      throw new StorageError('File not found', 'FILE_NOT_FOUND', 404);
    }
    
    await this.client.removeObject(fileRecord.bucket, fileRecord.storageKey);
    await prisma.fileStorage.delete({ where: { id: fileId } });
  }
  
  async getSignedUrl(fileId: string, expiresIn: number = 3600): Promise<string> {
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id: fileId } });
    
    if (!fileRecord) {
      throw new StorageError('File not found', 'FILE_NOT_FOUND', 404);
    }
    
    return this.client.presignedGetObject(fileRecord.bucket, fileRecord.storageKey, expiresIn);
  }
  
  async list(bucket?: string, prefix?: string): Promise<FileInfo[]> {
    const where: any = {};
    if (bucket) where.bucket = bucket;
    if (prefix) where.path = { startsWith: prefix };
    where.provider = 'minio';
    
    const files = await prisma.fileStorage.findMany({ where });
    
    return Promise.all(files.map(async f => ({
      id: f.id,
      bucket: f.bucket,
      path: f.path,
      filename: f.filename,
      mimeType: f.mimeType,
      size: f.size,
      provider: 'minio',
      isPublic: f.isPublic,
      url: await this.getPublicUrl(f.id),
      createdAt: f.createdAt,
    })));
  }
  
  async getPublicUrl(fileId: string): Promise<string> {
    // For MinIO, public URLs go through our backend or use presigned URLs
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    return \`\${baseUrl}/storage/public/\${fileId}\`;
  }
}

/**
 * Get the appropriate storage provider based on configuration
 */
export function getStorageProvider(provider?: string): StorageProvider {
  const p = provider || STORAGE_PROVIDER;
  
  if (p === 'minio') {
    return new MinioStorageProvider();
  }
  
  return new LocalStorageProvider();
}

// Default export - uses configured provider
export const storage = {
  local: new LocalStorageProvider(),
  minio: STORAGE_PROVIDER === 'minio' || STORAGE_PROVIDER === 'both' 
    ? new MinioStorageProvider() 
    : null,
  
  /**
   * Upload a file using the default provider
   */
  async upload(buffer: Buffer, options: UploadOptions): Promise<FileInfo> {
    const provider = getStorageProvider();
    return provider.upload(buffer, options);
  },
  
  /**
   * Download a file
   */
  async download(fileId: string): Promise<{ buffer: Buffer; info: FileInfo }> {
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id: fileId } });
    if (!fileRecord) {
      throw new StorageError('File not found', 'FILE_NOT_FOUND', 404);
    }
    
    const provider = getStorageProvider(fileRecord.provider);
    return provider.download(fileId);
  },
  
  /**
   * Delete a file
   */
  async delete(fileId: string): Promise<void> {
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id: fileId } });
    if (!fileRecord) {
      throw new StorageError('File not found', 'FILE_NOT_FOUND', 404);
    }
    
    const provider = getStorageProvider(fileRecord.provider);
    return provider.delete(fileId);
  },
  
  /**
   * Get a signed/temporary URL for a file
   */
  async getSignedUrl(fileId: string, expiresIn?: number): Promise<string> {
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id: fileId } });
    if (!fileRecord) {
      throw new StorageError('File not found', 'FILE_NOT_FOUND', 404);
    }
    
    const provider = getStorageProvider(fileRecord.provider);
    return provider.getSignedUrl(fileId, expiresIn);
  },
  
  /**
   * List files in a bucket
   */
  async list(bucket?: string, prefix?: string): Promise<FileInfo[]> {
    const provider = getStorageProvider();
    return provider.list(bucket, prefix);
  },
};

/**
 * Custom Storage Error class
 */
export class StorageError extends Error {
  code: string;
  statusCode: number;
  
  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
`;
}

/**
 * Generate storage routes
 */
export function generateStorageRoutes(): string {
  return `import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { storage, StorageError } from '../services/storage.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';

const router = Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

/**
 * POST /storage/upload
 * Upload a file
 */
router.post('/upload', authMiddleware, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file provided',
        code: 'NO_FILE',
      });
    }
    
    const { bucket, path: filePath, isPublic } = req.body;
    
    const fileInfo = await storage.upload(req.file.buffer, {
      bucket,
      path: filePath,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      isPublic: isPublic === 'true',
      userId: req.user?.userId,
    });
    
    res.status(201).json(fileInfo);
  } catch (error) {
    if (error instanceof StorageError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * POST /storage/upload-multiple
 * Upload multiple files
 */
router.post('/upload-multiple', authMiddleware, upload.array('files', 10), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        error: 'No files provided',
        code: 'NO_FILES',
      });
    }
    
    const { bucket, path: filePath, isPublic } = req.body;
    
    const results = await Promise.all(
      files.map(file => storage.upload(file.buffer, {
        bucket,
        path: filePath,
        filename: file.originalname,
        contentType: file.mimetype,
        isPublic: isPublic === 'true',
        userId: req.user?.userId,
      }))
    );
    
    res.status(201).json(results);
  } catch (error) {
    if (error instanceof StorageError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * GET /storage/download/:id
 * Download a file (with optional signed URL verification)
 */
router.get('/download/:id', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { expires, signature } = req.query;
    
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id } });
    
    if (!fileRecord) {
      return res.status(404).json({
        error: 'File not found',
        code: 'FILE_NOT_FOUND',
      });
    }
    
    // Check access
    if (!fileRecord.isPublic) {
      // If not public, require either auth or valid signature
      if (!req.user && !(expires && signature)) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'UNAUTHORIZED',
        });
      }
      
      // Verify signed URL
      if (expires && signature) {
        const expectedSig = crypto
          .createHmac('sha256', process.env.JWT_SECRET || 'storage-secret')
          .update(\`\${id}:\${expires}\`)
          .digest('hex');
        
        if (signature !== expectedSig || parseInt(expires as string) < Date.now()) {
          return res.status(403).json({
            error: 'Invalid or expired signature',
            code: 'INVALID_SIGNATURE',
          });
        }
      }
      // Check ownership if using auth
      else if (req.user && fileRecord.userId !== req.user.userId) {
        return res.status(403).json({
          error: 'Access denied',
          code: 'FORBIDDEN',
        });
      }
    }
    
    const { buffer, info } = await storage.download(id);
    
    res.setHeader('Content-Type', info.mimeType);
    res.setHeader('Content-Length', info.size);
    res.setHeader('Content-Disposition', \`attachment; filename="\${info.filename}"\`);
    res.send(buffer);
  } catch (error) {
    if (error instanceof StorageError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * GET /storage/public/:id
 * Serve public files (or files through signed URL)
 */
router.get('/public/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { expires, signature } = req.query;
    
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id } });
    
    if (!fileRecord) {
      return res.status(404).json({
        error: 'File not found',
        code: 'FILE_NOT_FOUND',
      });
    }
    
    // Check if public or has valid signature
    if (!fileRecord.isPublic) {
      if (!(expires && signature)) {
        return res.status(403).json({
          error: 'File is not public',
          code: 'NOT_PUBLIC',
        });
      }
      
      const expectedSig = crypto
        .createHmac('sha256', process.env.JWT_SECRET || 'storage-secret')
        .update(\`\${id}:\${expires}\`)
        .digest('hex');
      
      if (signature !== expectedSig || parseInt(expires as string) < Date.now()) {
        return res.status(403).json({
          error: 'Invalid or expired signature',
          code: 'INVALID_SIGNATURE',
        });
      }
    }
    
    const { buffer, info } = await storage.download(id);
    
    res.setHeader('Content-Type', info.mimeType);
    res.setHeader('Content-Length', info.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(buffer);
  } catch (error) {
    if (error instanceof StorageError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * GET /storage/signed-url/:id
 * Get a signed URL for temporary access
 */
router.get('/signed-url/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const expiresIn = parseInt(req.query.expiresIn as string) || 3600;
    
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id } });
    
    if (!fileRecord) {
      return res.status(404).json({
        error: 'File not found',
        code: 'FILE_NOT_FOUND',
      });
    }
    
    // Check ownership
    if (fileRecord.userId !== req.user?.userId && !fileRecord.isPublic) {
      return res.status(403).json({
        error: 'Access denied',
        code: 'FORBIDDEN',
      });
    }
    
    const url = await storage.getSignedUrl(id, expiresIn);
    
    res.json({ url, expiresIn });
  } catch (error) {
    if (error instanceof StorageError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * GET /storage/list
 * List files in a bucket
 */
router.get('/list', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bucket, prefix } = req.query;
    
    // Only list user's files
    const files = await prisma.fileStorage.findMany({
      where: {
        userId: req.user?.userId,
        ...(bucket ? { bucket: bucket as string } : {}),
        ...(prefix ? { path: { startsWith: prefix as string } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(files);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /storage/:id
 * Delete a file
 */
router.delete('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id } });
    
    if (!fileRecord) {
      return res.status(404).json({
        error: 'File not found',
        code: 'FILE_NOT_FOUND',
      });
    }
    
    // Check ownership
    if (fileRecord.userId !== req.user?.userId) {
      return res.status(403).json({
        error: 'Access denied',
        code: 'FORBIDDEN',
      });
    }
    
    await storage.delete(id);
    
    res.status(204).send();
  } catch (error) {
    if (error instanceof StorageError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

/**
 * GET /storage/info/:id
 * Get file metadata
 */
router.get('/info/:id', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    const fileRecord = await prisma.fileStorage.findUnique({ where: { id } });
    
    if (!fileRecord) {
      return res.status(404).json({
        error: 'File not found',
        code: 'FILE_NOT_FOUND',
      });
    }
    
    // Check access
    if (!fileRecord.isPublic && fileRecord.userId !== req.user?.userId) {
      return res.status(403).json({
        error: 'Access denied',
        code: 'FORBIDDEN',
      });
    }
    
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    
    res.json({
      id: fileRecord.id,
      bucket: fileRecord.bucket,
      path: fileRecord.path,
      filename: fileRecord.filename,
      mimeType: fileRecord.mimeType,
      size: fileRecord.size,
      isPublic: fileRecord.isPublic,
      url: \`\${baseUrl}/storage/public/\${fileRecord.id}\`,
      createdAt: fileRecord.createdAt,
    });
  } catch (error) {
    next(error);
  }
});

export { router as storageRouter };
`;
}
