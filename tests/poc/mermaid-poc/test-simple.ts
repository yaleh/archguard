import mermaid from 'isomorphic-mermaid';

console.log('Testing mermaid...');

try {
  await mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
  });

  const diagram = 'graph TD; A-->B;';
  const result = await mermaid.render('test-id', diagram);

  console.log('Success! SVG:', result.svg ? 'found' : 'missing');
  console.log('SVG length:', result.svg?.length || 0);
  console.log('First 200 chars:', result.svg?.substring(0, 200) || 'empty');
} catch (error) {
  console.error('Error:', error);
  console.error('Error message:', error instanceof Error ? error.message : String(error));
  console.error('Stack:', error instanceof Error ? error.stack : 'no stack');
}
