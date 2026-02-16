/**
 * Server utilities: graceful shutdown, clustering, etc.
 */

export function generateGracefulShutdown(): string {
  return `import { Server } from 'http';

type CleanupFn = () => Promise<void> | void;

const cleanupHandlers: CleanupFn[] = [];

/**
 * Register a cleanup handler to run on shutdown
 */
export function onShutdown(handler: CleanupFn): void {
  cleanupHandlers.push(handler);
}

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown(server: Server): void {
  let isShuttingDown = false;
  
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(\`\\n🛑 Received \${signal}, starting graceful shutdown...\`);
    
    // Stop accepting new connections
    server.close(async () => {
      console.log('✅ HTTP server closed');
      
      // Run cleanup handlers
      for (const handler of cleanupHandlers) {
        try {
          await handler();
        } catch (error) {
          console.error('Cleanup handler error:', error);
        }
      }
      
      console.log('👋 Graceful shutdown complete');
      process.exit(0);
    });
    
    // Force exit after timeout
    setTimeout(() => {
      console.error('⚠️ Forced shutdown after timeout');
      process.exit(1);
    }, 30000); // 30 second timeout
  };
  
  // Handle termination signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    shutdown('uncaughtException');
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
}
`;
}

export function generateClusterSetup(): string {
  return `import cluster from 'cluster';
import os from 'os';

const numCPUs = os.cpus().length;

/**
 * Setup cluster mode for multi-core scaling
 * 
 * Usage: 
 *   import { setupCluster } from './utils/cluster';
 *   if (setupCluster()) {
 *     // Worker code - start your server here
 *     startServer();
 *   }
 */
export function setupCluster(workers: number = numCPUs): boolean {
  if (cluster.isPrimary) {
    console.log(\`🚀 Primary \${process.pid} is running\`);
    console.log(\`🔧 Forking \${workers} workers...\`);
    
    // Fork workers
    for (let i = 0; i < workers; i++) {
      cluster.fork();
    }
    
    // Handle worker exit
    cluster.on('exit', (worker, code, signal) => {
      console.log(\`⚠️ Worker \${worker.process.pid} died (\${signal || code})\`);
      
      // Restart worker unless shutting down
      if (!signal) {
        console.log('🔄 Starting replacement worker...');
        cluster.fork();
      }
    });
    
    // Handle worker messages
    cluster.on('message', (worker, message) => {
      console.log(\`📨 Message from worker \${worker.process.pid}:\`, message);
    });
    
    return false; // Primary doesn't run server code
  }
  
  console.log(\`👷 Worker \${process.pid} started\`);
  return true; // Worker should run server code
}

/**
 * Check if running in cluster mode
 */
export function isClusterWorker(): boolean {
  return cluster.isWorker;
}

/**
 * Get worker ID (0 for primary/non-cluster)
 */
export function getWorkerId(): number {
  return cluster.worker?.id ?? 0;
}
`;
}

export function generateHealthCheck(): string {
  return `import { Request, Response, Router } from 'express';
import os from 'os';

const router = Router();
const startTime = Date.now();

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    load: number[];
    cores: number;
  };
  checks?: Record<string, {
    status: 'ok' | 'error';
    latency?: number;
    message?: string;
  }>;
}

type HealthCheck = () => Promise<{ status: 'ok' | 'error'; latency?: number; message?: string }>;

const healthChecks: Record<string, HealthCheck> = {};

/**
 * Register a health check
 */
export function registerHealthCheck(name: string, check: HealthCheck): void {
  healthChecks[name] = check;
}

/**
 * Basic health endpoint (for load balancers)
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Detailed health endpoint
 */
router.get('/health/detailed', async (req: Request, res: Response) => {
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  const health: HealthStatus = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024),
      total: Math.round(memUsage.heapTotal / 1024 / 1024),
      percentage: Math.round((usedMem / totalMem) * 100),
    },
    cpu: {
      load: os.loadavg(),
      cores: os.cpus().length,
    },
  };
  
  // Run registered health checks
  if (Object.keys(healthChecks).length > 0) {
    health.checks = {};
    
    for (const [name, check] of Object.entries(healthChecks)) {
      try {
        const start = Date.now();
        const result = await check();
        health.checks[name] = {
          ...result,
          latency: Date.now() - start,
        };
        
        if (result.status === 'error') {
          health.status = 'degraded';
        }
      } catch (error) {
        health.checks[name] = {
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        };
        health.status = 'degraded';
      }
    }
  }
  
  const statusCode = health.status === 'ok' ? 200 : health.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * Readiness probe (for Kubernetes)
 */
router.get('/ready', (req: Request, res: Response) => {
  // Add your readiness checks here (e.g., database connection)
  res.json({ ready: true });
});

/**
 * Liveness probe (for Kubernetes)
 */
router.get('/live', (req: Request, res: Response) => {
  res.json({ alive: true });
});

export { router as healthRouter };
`;
}
