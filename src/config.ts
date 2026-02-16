/**
 * Configuration file support for the converter
 */

export interface SelfHostedConfig {
  /** Enable self-hosted mode (replaces Supabase entirely) */
  enabled: boolean;
  
  /** PostgreSQL configuration */
  database?: {
    host?: string;
    port?: number;
    name?: string;
    user?: string;
    password?: string;
  };
  
  /** Storage configuration */
  storage?: {
    /** 'local' | 'minio' | 'both' (default: 'local') */
    provider?: 'local' | 'minio' | 'both';
    /** Local storage path (default: './uploads') */
    localPath?: string;
    /** MinIO configuration */
    minio?: {
      endpoint?: string;
      port?: number;
      accessKey?: string;
      secretKey?: string;
      bucket?: string;
    };
  };
  
  /** JWT Auth configuration */
  auth?: {
    /** JWT secret (will be auto-generated if not provided) */
    jwtSecret?: string;
    /** Access token expiry (default: '15m') */
    accessTokenExpiry?: string;
    /** Refresh token expiry (default: '7d') */
    refreshTokenExpiry?: string;
    /** Password hash rounds (default: 12) */
    bcryptRounds?: number;
  };
}

export interface ConverterConfig {
  /** Output directory name (default: 'backend') */
  outputDir?: string;
  
  /** Port for the Express server (default: 3000) */
  port?: number;
  
  /** Enable TypeScript (default: true) */
  typescript?: boolean;
  
  /** Generate Docker files (default: true) */
  docker?: boolean;
  
  /** Generate OpenAPI/Swagger docs (default: true) */
  swagger?: boolean;
  
  /** Enable clustering (default: false) */
  clustering?: boolean;
  
  /** Enable request validation scaffolding (default: true) */
  validation?: boolean;
  
  /** Update frontend to use new backend (default: true) */
  updateFrontend?: boolean;
  
  /** Self-hosted mode configuration (replaces Supabase with local PostgreSQL, JWT auth, and file storage) */
  selfHosted?: SelfHostedConfig;
  
  /** CORS configuration */
  cors?: {
    origins?: string[];
    methods?: string[];
    credentials?: boolean;
  };
  
  /** Rate limiting configuration */
  rateLimit?: {
    windowMs?: number;
    max?: number;
  };
  
  /** Functions to exclude from conversion */
  exclude?: string[];
  
  /** Custom middleware to add */
  middleware?: string[];
  
  /** Additional npm dependencies */
  dependencies?: Record<string, string>;
  
  /** Environment variables to require */
  requiredEnvVars?: string[];
}

export const defaultConfig: ConverterConfig = {
  outputDir: 'backend',
  port: 3001,
  typescript: true,
  docker: true,
  swagger: true,
  clustering: false,
  validation: true,
  updateFrontend: true,
  selfHosted: {
    enabled: false,
    database: {
      host: 'localhost',
      port: 5432,
      name: 'app_db',
      user: 'postgres',
      password: 'postgres',
    },
    storage: {
      provider: 'local',
      localPath: './uploads',
      minio: {
        endpoint: 'localhost',
        port: 9000,
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        bucket: 'app-storage',
      },
    },
    auth: {
      accessTokenExpiry: '15m',
      refreshTokenExpiry: '7d',
      bcryptRounds: 12,
    },
  },
  cors: {
    origins: ['http://localhost:8080', 'http://localhost:5173', 'http://localhost:3001'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
  },
  exclude: [],
  middleware: [],
  dependencies: {},
  requiredEnvVars: [],
};

export function generateConfigTemplate(): string {
  return `{
  "$schema": "./converter.schema.json",
  
  // Output directory name (relative to project root)
  "outputDir": "backend",
  
  // Express server port
  "port": 3000,
  
  // Generate TypeScript code
  "typescript": true,
  
  // Generate Docker and docker-compose files
  "docker": true,
  
  // Generate OpenAPI/Swagger documentation
  "swagger": true,
  
  // Enable Node.js clustering for multi-core scaling
  "clustering": false,
  
  // Generate Zod validation schemas
  "validation": true,
  
  // Update frontend to use Express backend
  "updateFrontend": true,
  
  // CORS configuration
  "cors": {
    "origins": ["http://localhost:5173", "http://localhost:3000"],
    "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "credentials": true
  },
  
  // Rate limiting (requests per window)
  "rateLimit": {
    "windowMs": 900000,
    "max": 100
  },
  
  // Self-hosted mode (replaces Supabase with local PostgreSQL, JWT auth, and file storage)
  "selfHosted": {
    "enabled": false,
    "database": {
      "host": "localhost",
      "port": 5432,
      "name": "app_db",
      "user": "postgres",
      "password": "postgres"
    },
    "storage": {
      "provider": "local",
      "localPath": "./uploads",
      "minio": {
        "endpoint": "localhost",
        "port": 9000,
        "accessKey": "minioadmin",
        "secretKey": "minioadmin",
        "bucket": "app-storage"
      }
    },
    "auth": {
      "accessTokenExpiry": "15m",
      "refreshTokenExpiry": "7d",
      "bcryptRounds": 12
    }
  },
  
  // Functions to exclude from conversion
  "exclude": [],
  
  // Additional npm dependencies to install
  "dependencies": {},
  
  // Environment variables that must be set
  "requiredEnvVars": []
}
`;
}

export function generateConfigSchema(): string {
  return `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Deno to Express Converter Configuration",
  "type": "object",
  "properties": {
    "outputDir": {
      "type": "string",
      "description": "Output directory name",
      "default": "backend"
    },
    "port": {
      "type": "number",
      "description": "Express server port",
      "default": 3000
    },
    "typescript": {
      "type": "boolean",
      "description": "Generate TypeScript code",
      "default": true
    },
    "docker": {
      "type": "boolean",
      "description": "Generate Docker files",
      "default": true
    },
    "swagger": {
      "type": "boolean",
      "description": "Generate OpenAPI documentation",
      "default": true
    },
    "clustering": {
      "type": "boolean",
      "description": "Enable Node.js clustering",
      "default": false
    },
    "validation": {
      "type": "boolean",
      "description": "Generate validation schemas",
      "default": true
    },
    "updateFrontend": {
      "type": "boolean",
      "description": "Update frontend code",
      "default": true
    },
    "cors": {
      "type": "object",
      "properties": {
        "origins": {
          "type": "array",
          "items": { "type": "string" }
        },
        "methods": {
          "type": "array",
          "items": { "type": "string" }
        },
        "credentials": {
          "type": "boolean"
        }
      }
    },
    "rateLimit": {
      "type": "object",
      "properties": {
        "windowMs": {
          "type": "number",
          "description": "Time window in milliseconds"
        },
        "max": {
          "type": "number",
          "description": "Max requests per window"
        }
      }
    },
    "exclude": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Functions to exclude"
    },
    "middleware": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Custom middleware to add"
    },
    "dependencies": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "Additional npm dependencies"
    },
    "requiredEnvVars": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Required environment variables"
    },
    "selfHosted": {
      "type": "object",
      "description": "Self-hosted mode configuration",
      "properties": {
        "enabled": {
          "type": "boolean",
          "description": "Enable self-hosted mode",
          "default": false
        },
        "database": {
          "type": "object",
          "properties": {
            "host": { "type": "string", "default": "localhost" },
            "port": { "type": "number", "default": 5432 },
            "name": { "type": "string", "default": "app_db" },
            "user": { "type": "string", "default": "postgres" },
            "password": { "type": "string", "default": "postgres" }
          }
        },
        "storage": {
          "type": "object",
          "properties": {
            "provider": { 
              "type": "string", 
              "enum": ["local", "minio", "both"],
              "default": "local"
            },
            "localPath": { "type": "string", "default": "./uploads" },
            "minio": {
              "type": "object",
              "properties": {
                "endpoint": { "type": "string" },
                "port": { "type": "number" },
                "accessKey": { "type": "string" },
                "secretKey": { "type": "string" },
                "bucket": { "type": "string" }
              }
            }
          }
        },
        "auth": {
          "type": "object",
          "properties": {
            "jwtSecret": { "type": "string" },
            "accessTokenExpiry": { "type": "string", "default": "15m" },
            "refreshTokenExpiry": { "type": "string", "default": "7d" },
            "bcryptRounds": { "type": "number", "default": 12 }
          }
        }
      }
    }
  }
}
`;
}

export function mergeConfigs(base: ConverterConfig, override: Partial<ConverterConfig>): ConverterConfig {
  const mergedSelfHosted = (!base.selfHosted && !override.selfHosted) ? undefined : {
    enabled: override.selfHosted?.enabled ?? base.selfHosted?.enabled ?? false,
    database: { ...base.selfHosted?.database, ...override.selfHosted?.database },
    storage: { 
      ...base.selfHosted?.storage, 
      ...override.selfHosted?.storage,
      minio: { ...base.selfHosted?.storage?.minio, ...override.selfHosted?.storage?.minio },
    },
    auth: { ...base.selfHosted?.auth, ...override.selfHosted?.auth },
  };
  
  return {
    ...base,
    ...override,
    cors: { ...base.cors, ...override.cors },
    rateLimit: { ...base.rateLimit, ...override.rateLimit },
    selfHosted: mergedSelfHosted,
  };
}
