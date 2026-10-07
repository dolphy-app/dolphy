import { defineClient } from '@dolphy-app/extension-sdk';
import { ChoiceAnswerView } from './choice-view.ts';

export const client = defineClient((c) => {
  c.addAnswerView('dolphy.choice', ChoiceAnswerView);
});
