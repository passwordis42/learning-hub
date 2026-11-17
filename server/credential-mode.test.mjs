import assert from 'node:assert/strict';
import { test } from 'node:test';
import { credentialMode as aiMode } from '../sites/ai-learning-atlas/src/credential-mode.js';
import { assistantRoot, credentialMode as gameMode } from '../sites/game-design-atlas/docs/credential-mode.js';

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

test('hub embed uses the page origin on a public host and both path prefixes', () => {
  assert.equal(assistantRoot({
    origin: 'https://learn.hub.test:8443',
    hostname: 'learn.hub.test',
    pathname: '/game/',
    search: '?embed=1',
  }), 'https://learn.hub.test:8443');
  assert.equal(assistantRoot({
    origin: 'https://learn.hub.test:8443',
    hostname: 'learn.hub.test',
    pathname: '/learning-hub/game/',
    search: '?embed=1',
  }), 'https://learn.hub.test:8443/learning-hub');
  assert.equal(assistantRoot({
    origin: 'https://learn.example',
    hostname: 'learn.example',
    pathname: '/game/index.html',
    search: '',
  }), 'http://127.0.0.1:4173');
});
