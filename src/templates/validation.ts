/**
 * Request validation with Zod schemas
 */

export function generateValidationMiddleware(): string {
  return `import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Middleware to validate request body against a Zod schema
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * Middleware to validate query parameters against a Zod schema
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(error);
    }
  };
}

/**
 * Middleware to validate route parameters against a Zod schema
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params) as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Invalid route parameters',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(error);
    }
  };
}
`;
}

export function generateSchemasIndex(functionNames: string[]): string {
  const imports = functionNames.map(fn => {
    const varName = fn.replace(/-/g, '_');
    return `export * from './${fn}.schema';`;
  }).join('\n');

  return `/**
 * Request validation schemas
 * 
 * Each endpoint can have its own schema file.
 * Import and use with the validation middleware.
 * 
 * Example:
 *   import { validateBody } from '../middleware/validation';
 *   import { myEndpointSchema } from '../schemas/my-endpoint.schema';
 *   
 *   router.post('/endpoint', validateBody(myEndpointSchema), handler);
 */

import { z } from 'zod';

// Common schemas
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(100).optional(),
  ...paginationSchema.shape,
});

// Auto-generated schema placeholders
// TODO: Define specific schemas for each endpoint
${functionNames.map(fn => {
  const schemaName = fn.replace(/-/g, '_') + 'Schema';
  return `
// Schema for ${fn}
export const ${schemaName} = z.object({
  // Define your request body schema here
}).passthrough();`;
}).join('\n')}
`;
}
