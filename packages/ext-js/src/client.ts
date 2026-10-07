import { defineClient } from '@dolphy-app/extension-sdk';
import { JsAnswerView } from './js-view.ts';

export const client = defineClient((c) => {
  c.addAnswerView('dolphy.js', JsAnswerView);
});
