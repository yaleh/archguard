import type { C } from '../lib/schema.js';

export const SMALL_FIXTURE: C = {
  entities: [
    {
      id: 'renderer',
      name: 'Renderer',
      type: 'class',
      sourceFile: 'src/mermaid/renderer.ts',
      methods: [
        { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
        { name: 'renderSVG', params: [], returnType: 'string' },
      ],
    },
    {
      id: 'irenderer',
      name: 'IRenderer',
      type: 'interface',
      sourceFile: 'src/types/renderer.ts',
      methods: [
        { name: 'render', params: [{ name: 'config', type: 'Config' }], returnType: 'string' },
      ],
    },
    {
      id: 'pipeline',
      name: 'Pipeline',
      type: 'class',
      sourceFile: 'src/core/pipeline.ts',
      methods: [],
    },
  ],
  relations: [
    { from: 'renderer', to: 'irenderer', type: 'implementation' },
    { from: 'renderer', to: 'pipeline', type: 'call' },
    { from: 'renderer', to: 'pipeline', type: 'dependency' },
  ],
};

export const EMPTY_FIXTURE: C = { entities: [], relations: [] };
