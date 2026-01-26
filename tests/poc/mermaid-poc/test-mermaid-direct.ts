import mermaid from 'mermaid';

console.log('Mermaid imported successfully');
console.log('Mermaid version:', mermaid.version || 'unknown');

try {
  mermaid.initialize({
    startOnLoad: false,
  });

  console.log('Mermaid initialized');
  console.log('Calling render...');

  const { svg } = await mermaid.render('graph-div', 'graph TD; A-->B;');
  console.log('SUCCESS! SVG length:', svg.length);
  console.log('SVG preview:', svg.substring(0, 200));
} catch (error) {
  console.error('ERROR:', error);
  console.error('Message:', error instanceof Error ? error.message : String(error));
}
