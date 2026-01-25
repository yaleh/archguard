#!/bin/bash
# Fix ES module imports by adding .js extensions

echo "Adding .js extensions to relative imports..."

find dist -name "*.js" -type f -exec sed -i -E \
  "s|from '(\.\./[^']+)'|from '\1.js'|g; s|from '(\./[^']+)'|from '\1.js'|g; s|\.js\.js|.js|g" {} \;

echo "✓ Import fixing complete"
