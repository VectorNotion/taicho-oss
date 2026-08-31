import assert from 'node:assert/strict';
import test from 'node:test';

import { draftVisionGroundingText } from '../agent/actions/draft';

test('draft grounding preserves every selected image description and generation prompt', () => {
  const grounding = draftVisionGroundingText([
    {
      bytes: Buffer.from('<svg/>'),
      mimeType: 'image/svg+xml',
      description: 'A Base-owned diagram',
      generationContext: 'Original Visual Brief: {"visualType":"diagram"}\nOriginal image-generation prompt:\nA navy system diagram with three connected nodes.',
    },
    {
      bytes: Buffer.from('pixels'),
      mimeType: 'image/png',
      description: 'A supporting quote card',
      generationContext: 'Original image-generation prompt:\nA restrained amber quote card.',
    },
  ]);

  assert.match(grounding, /Selected image 1/);
  assert.match(grounding, /navy system diagram with three connected nodes/);
  assert.match(grounding, /Selected image 2/);
  assert.match(grounding, /restrained amber quote card/);
});
