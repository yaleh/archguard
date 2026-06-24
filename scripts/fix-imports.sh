#!/bin/bash
# Fix ES module imports by adding .js extensions

echo "Adding .js extensions to relative imports..."

find dist -name "*.js" -type f -exec perl -0pi -e '
  sub with_js_extension {
    my ($path) = @_;
    return $path if $path =~ /\.[A-Za-z0-9]+$/;
    return "$path.js";
  }
  s/\b(from\s+["'"'"'])(\.{1,2}\/[^"'"'"']+)(["'"'"'])/$1 . with_js_extension($2) . $3/ge;
  s/\b(import\s+["'"'"'])(\.{1,2}\/[^"'"'"']+)(["'"'"'])/$1 . with_js_extension($2) . $3/ge;
  s/\b(import\(\s*["'"'"'])(\.{1,2}\/[^"'"'"']+)(["'"'"']\s*\))/$1 . with_js_extension($2) . $3/ge;
' {} \;

echo "✓ Import fixing complete"
