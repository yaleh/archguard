import mermaid from 'isomorphic-mermaid';

console.log('Testing isomorphic-mermaid');

try {
  await mermaid.initialize({
    startOnLoad: false,
  });

  console.log('Mermaid initialized');

  const result = await mermaid.render('graph-div', 'graph TD; A-->B;');
  console.log('Render result type:', typeof result);
  console.log('Render result:', result);

  if (result) {
    console.log('Keys:', Object.keys(result));
    if (result.svg) {
      console.log('SVG length:', result.svg.length);
    }
  }
} catch (error) {
  console.error('Error:', error);
}
