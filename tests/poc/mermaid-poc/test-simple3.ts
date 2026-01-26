import mermaid from 'isomorphic-mermaid';

async function test() {
  console.log('Testing mermaid...');

  // Initialize mermaid
  await mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
  });

  const diagram = 'graph TD; A-->B;';
  console.log('Diagram:', diagram);

  // Try different render approaches
  try {
    console.log('\nApproach 1: render(id, definition)');
    const result1 = await mermaid.render('test-id', diagram);
    console.log('Result 1:', result1);
  } catch (e) {
    console.log('Approach 1 failed:', e);
  }

  try {
    console.log('\nApproach 2: render(id, definition, {})');
    const result2 = await mermaid.render('test-id2', diagram, {});
    console.log('Result 2:', result2);
  } catch (e) {
    console.log('Approach 2 failed:', e);
  }

  // Check what's available
  console.log('\nAvailable mermaid methods:');
  console.log('- render:', typeof mermaid.render);
  console.log('- run:', typeof mermaid.run);
  console.log('- execute:', typeof mermaid.execute);
}

test().catch(console.error);
