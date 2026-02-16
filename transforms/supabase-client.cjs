/**
 * Transform for handling Supabase client patterns
 * Converts Supabase client initialization to work with Express
 */
module.exports = function supabaseTransform(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // Find createClient calls and ensure proper import
  const hasCreateClient = root.find(j.CallExpression, {
    callee: { type: 'Identifier', name: 'createClient' }
  }).length > 0;

  if (hasCreateClient) {
    // Check if import exists
    const hasImport = root.find(j.ImportDeclaration).filter((path) => {
      const source = path.node.source.value;
      return typeof source === 'string' && source.includes('@supabase/supabase-js');
    }).length > 0;

    if (!hasImport) {
      // Add import at top
      const importDecl = j.importDeclaration(
        [j.importSpecifier(j.identifier('createClient'))],
        j.stringLiteral('@supabase/supabase-js')
      );
      
      const body = root.find(j.Program).get('body');
      body.unshift(importDecl);
    }
  }

  return root.toSource({ quote: 'single' });
};
