import { expect, test } from 'vitest';
import { fitWithin } from './resizeImage';

// The canvas part runs in a real browser (client/e2e/bot.spec.ts, TC-F10-03); jsdom has no canvas.
test('TC-F10-03 fitWithin: longest side at most 1600 px, same shape, small photos are not enlarged', () => {
  expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 }); // landscape phone photo
  expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 }); // portrait
  expect(fitWithin(941, 1146)).toEqual({ width: 941, height: 1146 }); // already small
  expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
});
