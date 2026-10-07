import { defineClient } from '@dolphy-app/extension-sdk';
import { MathBlock } from './math-block.ts';

export const client = defineClient((c) => {
  c.addMarkdownRenderer('math', MathBlock);
});
