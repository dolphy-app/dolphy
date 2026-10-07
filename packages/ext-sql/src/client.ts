import { defineClient } from '@dolphy-app/extension-sdk';
import { SqlAnswerView } from './sql-view.ts';

export const client = defineClient((c) => {
  c.addAnswerView('dolphy.sql', SqlAnswerView);
});
