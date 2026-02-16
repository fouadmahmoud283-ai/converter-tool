/**
 * Transform to handle common Lovable CORS patterns
 * This is applied after the main deno-to-handler transform
 */
module.exports = function corsTransform(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // Find corsHeaders declarations and ensure they're exported
  root.find(j.VariableDeclaration).forEach((path) => {
    const declarations = path.node.declarations;
    for (const decl of declarations) {
      if (
        decl.id &&
        decl.id.type === 'Identifier' &&
        decl.id.name === 'corsHeaders'
      ) {
        // If not already exported, wrap in export
        if (path.parent.node.type !== 'ExportNamedDeclaration') {
          const exportDecl = j.exportNamedDeclaration(path.node);
          j(path).replaceWith(exportDecl);
        }
      }
    }
  });

  // Handle the common OPTIONS check pattern
  // if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  // Keep as-is since it works with fetch Request/Response

  return root.toSource({ quote: 'single' });
};
