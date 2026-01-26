import mermaid from 'isomorphic-mermaid';

console.log('Testing mermaid...');
console.log('mermaid object:', Object.keys(mermaid));
console.log('render function:', typeof mermaid.render);

try {
  await mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
  });

  const diagram = 'graph TD; A-->B;';
  console.log('Calling render...');
  const result = await mermaid.render('test-id', diagram);
  console.log('Result type:', typeof result);
  console.log('Result keys:', result ? Object.keys(result) : 'result is null/undefined');
  console.log('Result:', result);

  if (result && typeof result === 'object') {
    if ('svg' in result) {
      console.log('Has svg property');
    }
    if ('then' in result) {
      console.log('Is a promise');
    }
  }
} catch (error) {
  console.error('Error:', error);
}
