import { lessons01to09 } from './lessons-01-09.js?v=guided-2';
import { lessons10to18 } from './lessons-10-18.js';
import { lessons19to28 } from './lessons-19-28.js?v=guided-2';
import { checkpoints } from './checkpoints.js';
import { reasoningCases } from './reasoning-cases.js';

const content = { ...lessons01to09, ...lessons10to18, ...lessons19to28 };
const genreLabs = ['genre-platform', 'genre-shooter', 'genre-puzzle', 'genre-rpg', 'genre-management', 'genre-sandbox', 'genre-rogue', 'genre-coop'];
export const lessons = Object.fromEntries(Object.entries(content).map(([week, { quiz: _oldChoices, ...lesson }]) => [week, {
  ...lesson,
  reasoning: reasoningCases[week],
  ...(genreLabs[week - 16] ? { lab: genreLabs[week - 16] } : {}),
  ...(checkpoints[week] ? { checkpoint: checkpoints[week] } : {})
}]));
