import mermaid from 'isomorphic-mermaid';

try {
  console.log('Testing mermaid...');

  // Initialize mermaid
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
  });

  const diagram = 'graph TD; A-->B;';
  console.log('Diagram defined');

  // Check render type
  console.log('typeof mermaid.render:', typeof mermaid.render);

  // The issue might be that render returns a promise that resolves to the svg directly
  console.log('Calling render...');
  const svg = await mermaid.render('test-id', diagram);
  console.log('Render completed');
  console.log('SVG type:', typeof svg);
  console.log('SVG:', svg);

} catch (error) {
  console.error('Caught error:', error);
  console.error('Error type:', error?.constructor?.name);
  console.error('Error message:', error?.message);
  console.error('Error stack:', error?.stack);
}
