import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FeatureUnavailableError,
  InsufficientCreditsError,
  SubscriptionInactiveError,
} from '@content-automation/platform/commercial';
import { commercialErrorResponse } from '../commercial';

test('commercial errors retain their HTTP contract across server bundle boundaries', async () => {
  const cases = [
    {
      local: new InsufficientCreditsError(10, 0, '2026-09-04T00:00:00.000Z'),
      bundled: Object.assign(new Error('This action needs 10 credits; 0 are available.'), {
        code: 'INSUFFICIENT_CREDITS', required: 10, available: 0, refreshAt: '2026-09-04T00:00:00.000Z',
      }),
      status: 402,
    },
    {
      local: new FeatureUnavailableError('ai.basic', 'free'),
      bundled: Object.assign(new Error('ai.basic is not available on the free plan.'), {
        code: 'FEATURE_UNAVAILABLE', capability: 'ai.basic', planId: 'free',
      }),
      status: 403,
    },
    {
      local: new SubscriptionInactiveError('expired', '2026-08-01T00:00:00.000Z'),
      bundled: Object.assign(new Error('This user subscription has expired.'), {
        code: 'SUBSCRIPTION_INACTIVE', status: 'expired', periodEnd: '2026-08-01T00:00:00.000Z',
      }),
      status: 403,
    },
  ];

  for (const fixture of cases) {
    for (const error of [fixture.local, fixture.bundled]) {
      const response = commercialErrorResponse(error);
      assert.ok(response);
      assert.equal(response.status, fixture.status);
      assert.equal((await response.json()).code, error.code);
    }
  }
});
