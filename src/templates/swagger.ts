/**
 * OpenAPI/Swagger documentation generation
 */

export function generateSwaggerConfig(functionNames: string[]): string {
  const paths = functionNames.map(fn => {
    const pathName = `/${fn.replace(/-/g, '-')}`;
    return `    "${pathName}": {
      "post": {
        "summary": "${fn.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}",
        "tags": ["Functions"],
        "security": [{ "bearerAuth": [] }],
        "requestBody": {
          "required": false,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Successful response",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "400": {
            "description": "Bad request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized"
          },
          "500": {
            "description": "Internal server error"
          }
        }
      }
    }`;
  }).join(',\n');

  return `{
  "openapi": "3.0.3",
  "info": {
    "title": "Converted API",
    "description": "API documentation for converted Supabase Edge Functions",
    "version": "1.0.0",
    "contact": {
      "name": "API Support"
    }
  },
  "servers": [
    {
      "url": "http://localhost:3000",
      "description": "Development server"
    }
  ],
  "paths": {
    "/health": {
      "get": {
        "summary": "Health check",
        "tags": ["System"],
        "responses": {
          "200": {
            "description": "Service is healthy",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": { "type": "string", "example": "ok" },
                    "timestamp": { "type": "string", "format": "date-time" },
                    "uptime": { "type": "number" },
                    "version": { "type": "string" }
                  }
                }
              }
            }
          }
        }
      }
    },
${paths}
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "JWT Authorization header"
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string",
            "description": "Error message"
          },
          "details": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "field": { "type": "string" },
                "message": { "type": "string" }
              }
            }
          }
        }
      }
    }
  },
  "tags": [
    {
      "name": "System",
      "description": "System endpoints"
    },
    {
      "name": "Functions",
      "description": "Converted edge functions"
    }
  ]
}
`;
}

export function generateSwaggerSetup(): string {
  return `import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Setup Swagger UI documentation
 */
export function setupSwagger(app: Express): void {
  // Try multiple paths to find openapi.json
  const possiblePaths = [
    path.join(__dirname, '../openapi.json'),
    path.join(__dirname, '../../openapi.json'),
    path.join(process.cwd(), 'src/openapi.json'),
    path.join(process.cwd(), 'openapi.json'),
  ];
  
  const swaggerPath = possiblePaths.find(p => fs.existsSync(p));
  
  if (swaggerPath) {
    const swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
    
    // Update server URL based on environment
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || 'localhost';
    swaggerDocument.servers = [
      {
        url: \`http://\${host}:\${port}\`,
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
      }
    ];
    
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
      }
    }));
    
    // Serve raw OpenAPI spec
    app.get('/api-docs/openapi.json', (req, res) => {
      res.json(swaggerDocument);
    });
    
    console.log(\`📚 API docs available at http://\${host}:\${port}/api-docs\`);
  } else {
    console.warn('⚠️ OpenAPI spec not found. API docs disabled.');
    console.warn('   Searched paths:', possiblePaths.join(', '));
  }
}
`;
}
