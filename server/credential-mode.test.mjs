import assert from 'node:assert/strict';
import { test } from 'node:test';
import { credentialMode as aiMode } from '../sites/ai-learning-atlas/src/credential-mode.js';
import { credentialMode as gameMode } from '../sites/game-design-atlas/docs/credential-mode.js';

const cases = [
  ['http://127.0.0.1:8080', '/api/tutor', 'same-origin'],
  ['http://127.0.0.1:8092', '/learning-hub/api/tutor', 'same-origin'],
  ['http://127.0.0.1:8080', 'http://127.0.0.1:8080/api/status', 'same-origin'],
  ['http://127.0.0.1:4173', 'http://127.0.0.1:4173/api/assist', 'same-origin'],
  ['http://127.0.0.1:8080', 'http://127.0.0.1:4173/api/status', 'omit'],
  ['http://127.0.0.1:8080', 'https://evil.example/api/tutor', 'omit'],
  ['https://learn.example', 'https://learn.example/learning-hub/api/tutor', 'same-origin'],
  ['https://learn.example', 'https://other.example/api/tutor', 'omit'],
];

for (const mode of [aiMode, gameMode]) {
  test(`${mode.name} sends the hub session only to its own origin`, () => {
    for (const [origin, endpoint, expected] of cases) {
      assert.equal(mode(endpoint, origin), expected, `${endpoint} from ${origin}`);
    }
  });
}
