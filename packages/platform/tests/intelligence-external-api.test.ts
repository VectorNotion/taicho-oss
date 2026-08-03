import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalIntelligenceApiPayload,
  signIntelligenceApiRequest,
  verifyIntelligenceApiRequest,
} from '../intelligence/external-api';

test('n8n signatures bind method, path, body, organization, and delivery id', async () => {
  const token = 'test-token';
  const body = JSON.stringify({ input: { leadId: 'lead-1' } });
  const timestamp = '1785660000';
  const signed = signIntelligenceApiRequest({
    token,
    method: 'POST',
    path: '/api/intelligence/v1/workflows/lead_intelligence',
    body,
    deliveryId: 'n8n-run-1',
    timestamp,
  });
  const headers = {
    organizationId: 'org-1',
    timestamp: signed.timestamp,
    deliveryId: signed.deliveryId,
    signature: signed.signature,
  };
  const getToken = async () => token;
  const verified = await verifyIntelligenceApiRequest({
    headers,
    method: 'POST',
    path: '/api/intelligence/v1/workflows/lead_intelligence',
    body,
    now: Number(timestamp),
  }, { getToken });
  assert.deepEqual(verified, { organizationId: 'org-1', deliveryId: 'n8n-run-1' });
  assert.equal(await verifyIntelligenceApiRequest({
    headers,
    method: 'POST',
    path: '/api/intelligence/v1/workflows/outreach_intelligence',
    body,
    now: Number(timestamp),
  }, { getToken }), null);
  assert.equal(canonicalIntelligenceApiPayload({ method: 'get', path: '/x', body: '' }), 'GET\n/x\n');
});

test('expired signatures and unknown organizations are rejected uniformly', async () => {
  const signed = signIntelligenceApiRequest({
    token: 'test-token',
    method: 'GET',
    path: '/api/intelligence/v1/runs/run-1',
    deliveryId: 'poll-1',
    timestamp: '100',
  });
  assert.equal(await verifyIntelligenceApiRequest({
    headers: { organizationId: 'org-1', ...signed },
    method: 'GET',
    path: '/api/intelligence/v1/runs/run-1',
    now: 1_000,
  }, { getToken: async () => 'test-token' }), null);
  assert.equal(await verifyIntelligenceApiRequest({
    headers: { organizationId: '../bad', ...signed },
    method: 'GET',
    path: '/api/intelligence/v1/runs/run-1',
    now: 100,
  }, { getToken: async () => 'test-token' }), null);
});
