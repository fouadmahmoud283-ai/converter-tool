/**
 * jscodeshift transform: Convert Deno Edge Functions to Express-compatible handlers
 * Handles all common patterns from Lovable-generated Supabase Edge Functions
 */
module.exports = function transform(fileInfo, api, options) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // ============================================
  // 1. Convert npm: imports to standard npm imports
  // ============================================
  root.find(j.ImportDeclaration).forEach((path) => {
    const source = path.node.source.value;
    if (typeof source === 'string') {
      // Handle npm: prefix
      if (source.startsWith('npm:')) {
        // npm:package@version -> package
        let cleaned = source.replace(/^npm:/, '');
        // Remove version specifier if present (e.g., @1.0.0)
        // Handle scoped packages like npm:@supabase/supabase-js@2
        if (cleaned.startsWith('@')) {
          // Scoped package: @scope/package@version
          const match = cleaned.match(/^(@[^/]+\/[^@]+)(?:@.*)?$/);
          if (match) {
            cleaned = match[1];
          }
        } else {
          // Regular package: package@version
          cleaned = cleaned.replace(/@[\d.^~>=<].*$/, '');
        }
        path.node.source.value = cleaned;
      }
      // Handle jsr: imports (Deno's JSR registry)
      else if (source.startsWith('jsr:')) {
        let cleaned = source.replace(/^jsr:/, '');
        if (cleaned.startsWith('@')) {
          const match = cleaned.match(/^(@[^/]+\/[^@]+)(?:@.*)?$/);
          if (match) {
            cleaned = match[1];
          }
        } else {
          cleaned = cleaned.replace(/@[\d.^~>=<].*$/, '');
        }
        path.node.source.value = cleaned;
      }
      // Handle https://deno.land imports (or deno.land without https://)
      else if (source.includes('deno.land')) {
        // Pattern: deno.land/x/packagename@version/path or https://deno.land/...
        const denoLandMatch = source.match(/deno\.land\/x\/([^@/]+)(?:@[^/]+)?(?:\/(.*))?$/);
        if (denoLandMatch) {
          const pkgName = denoLandMatch[1];
          let subPath = '';
          if (denoLandMatch[2]) {
            // Clean the subpath: remove .ts extension and /mod or mod (Deno convention)
            let cleaned = denoLandMatch[2]
              .replace(/\.ts$/, '')
              .replace(/^mod$/, '')      // Just "mod"
              .replace(/\/mod$/, '');    // Ends with /mod
            if (cleaned) {
              subPath = '/' + cleaned;
            }
          }
          const mapping = {
            'std': null,
            'oak': 'koa',
            'cors': 'cors',
            'dotenv': 'dotenv',
            'postgres': 'pg',
            'mysql': 'mysql2',
            'redis': 'redis',
            'bcrypt': 'bcrypt'
          };
          if (mapping[pkgName] !== undefined) {
            if (mapping[pkgName]) {
              path.node.source.value = mapping[pkgName] + subPath;
            }
          } else {
            path.node.source.value = pkgName + subPath;
          }
        } else {
          // Fallback: try old pattern for std library
          const match = source.match(/\/([^/@]+)(?:@[^/]+)?(?:\/(.*))?$/);
          if (match) {
            const pkgName = match[1];
            const subPath = match[2] ? `/${match[2].replace(/\.ts$/, '')}` : '';
            const mapping = {
              'std': null,
              'oak': 'koa',
              'cors': 'cors',
              'dotenv': 'dotenv',
              'postgres': 'pg',
              'mysql': 'mysql2',
              'redis': 'redis'
            };
            if (mapping[pkgName] !== undefined) {
              if (mapping[pkgName]) {
                path.node.source.value = mapping[pkgName] + subPath;
              }
            } else {
              path.node.source.value = pkgName + subPath;
            }
          }
        }
      }
      // Handle https://esm.sh imports
      else if (source.includes('esm.sh')) {
        // Handle scoped packages: esm.sh/@scope/package@version
        const scopedMatch = source.match(/esm\.sh\/(@[^/]+\/[^@?]+)(?:@[^/?]*)?/);
        if (scopedMatch) {
          path.node.source.value = scopedMatch[1];
        } else {
          // Handle regular packages: esm.sh/package@version
          const match = source.match(/esm\.sh\/([^@?/]+)(?:@[^/?]*)?/);
          if (match) {
            path.node.source.value = match[1];
          }
        }
      }
    }
  });

  // ============================================
  // 2. Replace Deno.env.get("X") -> process.env["X"] ?? ""
  // ============================================
  root.find(j.CallExpression).forEach((path) => {
    const callee = path.node.callee;
    if (
      callee &&
      callee.type === 'MemberExpression' &&
      callee.object &&
      callee.object.type === 'MemberExpression' &&
      callee.object.object &&
      callee.object.object.type === 'Identifier' &&
      callee.object.object.name === 'Deno' &&
      callee.object.property &&
      callee.object.property.type === 'Identifier' &&
      callee.object.property.name === 'env' &&
      callee.property &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'get'
    ) {
      const arg = path.node.arguments[0] || j.stringLiteral('');
      const processEnv = j.memberExpression(
        j.memberExpression(j.identifier('process'), j.identifier('env')),
        arg,
        true
      );
      const withDefault = j.logicalExpression('??', processEnv, j.stringLiteral(''));
      j(path).replaceWith(withDefault);
    }
  });

  // ============================================
  // 3. Replace Deno.env.toObject() -> process.env
  // ============================================
  root.find(j.CallExpression).forEach((path) => {
    const callee = path.node.callee;
    if (
      callee &&
      callee.type === 'MemberExpression' &&
      callee.object &&
      callee.object.type === 'MemberExpression' &&
      callee.object.object &&
      callee.object.object.type === 'Identifier' &&
      callee.object.object.name === 'Deno' &&
      callee.object.property &&
      callee.object.property.type === 'Identifier' &&
      callee.object.property.name === 'env' &&
      callee.property &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'toObject'
    ) {
      j(path).replaceWith(
        j.memberExpression(j.identifier('process'), j.identifier('env'))
      );
    }
  });

  // ============================================
  // 4. Handle serve() imports and calls
  // ============================================
  const serveImportSources = [
    'http/server',
    'https://deno.land/std/http/server.ts',
    'https://deno.land/std@',
    'std/http/server'
  ];

  // Remove serve from imports
  root.find(j.ImportDeclaration).forEach((path) => {
    const source = path.node.source.value;
    if (typeof source === 'string') {
      const isServeImport = serveImportSources.some((s) => source.includes(s));
      if (isServeImport) {
        path.node.specifiers = path.node.specifiers.filter((spec) => {
          if (spec.type === 'ImportSpecifier') {
            return spec.imported.name !== 'serve';
          }
          return true;
        });
        if (path.node.specifiers.length === 0) {
          j(path).remove();
        }
      }
    }
  });

  // Convert serve(...) calls to export default
  let handlerExported = false;
  root.find(j.ExpressionStatement).forEach((path) => {
    if (handlerExported) return;
    const expr = path.node.expression;
    if (
      expr &&
      expr.type === 'CallExpression' &&
      expr.callee &&
      expr.callee.type === 'Identifier' &&
      expr.callee.name === 'serve'
    ) {
      const arg = expr.arguments[0];
      if (!arg) return;

      if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
        const params = arg.params;
        let body = arg.body;
        if (body.type !== 'BlockStatement') {
          body = j.blockStatement([j.returnStatement(body)]);
        }
        const isAsync = arg.async === true || hasAwait(j, body);
        const func = j.functionDeclaration(
          j.identifier('handler'),
          params,
          body,
          false,
          isAsync
        );
        const exportDefault = j.exportDefaultDeclaration(j.identifier('handler'));

        j(path).replaceWith([func, exportDefault]);
        handlerExported = true;
      } else if (arg.type === 'Identifier') {
        const exportDefault = j.exportDefaultDeclaration(j.identifier(arg.name));
        j(path).replaceWith(exportDefault);
        handlerExported = true;
      }
    }
  });

  // ============================================
  // 5. Handle Deno.serve() pattern (newer Deno 1.25+)
  // ============================================
  root.find(j.ExpressionStatement).forEach((path) => {
    if (handlerExported) return;
    const expr = path.node.expression;
    if (
      expr &&
      expr.type === 'CallExpression' &&
      expr.callee &&
      expr.callee.type === 'MemberExpression' &&
      expr.callee.object &&
      expr.callee.object.type === 'Identifier' &&
      expr.callee.object.name === 'Deno' &&
      expr.callee.property &&
      expr.callee.property.type === 'Identifier' &&
      expr.callee.property.name === 'serve'
    ) {
      // Deno.serve can have options object as first arg
      let handlerArg = expr.arguments[0];
      if (expr.arguments.length > 1) {
        handlerArg = expr.arguments[1];
      }
      // Also handle Deno.serve({ handler: ... }) pattern
      if (handlerArg && handlerArg.type === 'ObjectExpression') {
        const handlerProp = handlerArg.properties.find(
          (p) => p.key && p.key.name === 'handler'
        );
        if (handlerProp) {
          handlerArg = handlerProp.value;
        }
      }

      if (!handlerArg) return;

      if (
        handlerArg.type === 'ArrowFunctionExpression' ||
        handlerArg.type === 'FunctionExpression'
      ) {
        const params = handlerArg.params;
        let body = handlerArg.body;
        if (body.type !== 'BlockStatement') {
          body = j.blockStatement([j.returnStatement(body)]);
        }
        const isAsync = handlerArg.async === true || hasAwait(j, body);
        const func = j.functionDeclaration(
          j.identifier('handler'),
          params,
          body,
          false,
          isAsync
        );
        const exportDefault = j.exportDefaultDeclaration(j.identifier('handler'));

        j(path).replaceWith([func, exportDefault]);
        handlerExported = true;
      } else if (handlerArg.type === 'Identifier') {
        const exportDefault = j.exportDefaultDeclaration(j.identifier(handlerArg.name));
        j(path).replaceWith(exportDefault);
        handlerExported = true;
      }
    }
  });

  // ============================================
  // 6. Remove Deno namespace type references
  // ============================================
  root.find(j.TSTypeReference).forEach((path) => {
    if (
      path.node.typeName &&
      path.node.typeName.type === 'TSQualifiedName' &&
      path.node.typeName.left &&
      path.node.typeName.left.type === 'Identifier' &&
      path.node.typeName.left.name === 'Deno'
    ) {
      j(path).replaceWith(j.tsTypeReference(j.identifier('any')));
    }
  });

  // ============================================
  // 7. Handle relative imports with .ts extension
  // ============================================
  root.find(j.ImportDeclaration).forEach((path) => {
    const source = path.node.source.value;
    if (typeof source === 'string' && source.startsWith('.')) {
      // Convert .ts to .js for ESM compatibility
      if (source.endsWith('.ts')) {
        path.node.source.value = source.replace(/\.ts$/, '.js');
      }
    }
  });

  // ============================================
  // 8. Handle dynamic imports
  // ============================================
  root.find(j.ImportExpression).forEach((path) => {
    const source = path.node.source;
    if (source && source.type === 'StringLiteral') {
      let val = source.value;
      if (val.startsWith('npm:')) {
        val = val.replace(/^npm:/, '');
        if (val.startsWith('@')) {
          const match = val.match(/^(@[^/]+\/[^@]+)(?:@.*)?$/);
          if (match) {
            val = match[1];
          }
        } else {
          val = val.replace(/@[\d.^~>=<].*$/, '');
        }
        path.node.source = j.stringLiteral(val);
      }
    }
  });

  // ============================================
  // 9. Handle crypto.randomUUID() (Web Crypto API available in Node 19+)
  // For older Node, we would need to add import, but Node 18+ has it
  // ============================================

  // ============================================
  // 10. Handle TextEncoder/TextDecoder (available globally in Node)
  // No changes needed, they exist in Node.js
  // ============================================

  // ============================================
  // 11. Ensure handler functions are async if they use await
  // ============================================
  root.find(j.FunctionDeclaration, { id: { type: 'Identifier', name: 'handler' } }).forEach((path) => {
    if (path.node.async) return;
    if (hasAwait(j, path.node.body)) {
      path.node.async = true;
    }
  });

  root.find(j.VariableDeclarator).forEach((path) => {
    if (!path.node.id || path.node.id.type !== 'Identifier') return;
    if (path.node.id.name !== 'handler') return;
    const init = path.node.init;
    if (!init) return;
    if ((init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') && !init.async) {
      if (hasAwait(j, init.body)) {
        init.async = true;
      }
    }
  });

  return root.toSource({ quote: 'single' });
};

function hasAwait(j, body) {
  try {
    return j(body).find(j.AwaitExpression).length > 0;
  } catch {
    return false;
  }
}
