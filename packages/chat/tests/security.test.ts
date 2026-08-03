import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anonymousSubjectId,
  signInternalRequest,
  validatedTenantId,
  verifiedEmailSubjectId,
  verifyInternalRequest,
} from '../security'

const secret = 'test-assistant-secret-with-at-least-32-characters'

test('request signatures match the cross-repository compatibility vector', () => {
  const signed = signInternalRequest(
    'assistant-contract-fixture-secret-1234567890',
    '{"version":"1","probe":"assistant-contract"}',
    '019c94cf-0b89-76b4-a337-c37a891f1274',
    '1785384000',
  )
  assert.equal(
    signed.signature,
    'sha256=782176601110ebf602383ff1762c4e989e368894b01558f88454991013d0fc1a',
  )
})

test('internal request signatures bind timestamp and body', () => {
  const requestId = '019c94cf-0b89-76b4-a337-c37a891f1274'
  const signed = signInternalRequest(secret, '{"hello":"world"}', requestId, '1000')
  assert.equal(verifyInternalRequest({
    secret,
    body: '{"hello":"world"}',
    requestId: signed.requestId,
    timestamp: signed.timestamp,
    signature: signed.signature,
    now: 1000,
  }), true)
  assert.equal(verifyInternalRequest({
    secret,
    body: '{"hello":"tampered"}',
    requestId: signed.requestId,
    timestamp: signed.timestamp,
    signature: signed.signature,
    now: 1000,
  }), false)
  assert.equal(verifyInternalRequest({
    secret,
    body: '{"hello":"world"}',
    requestId: '019c94cf-0b89-76b4-a337-c37a891f1275',
    timestamp: signed.timestamp,
    signature: signed.signature,
    now: 1000,
  }), false)
})

test('internal request signatures expire', () => {
  const signed = signInternalRequest(
    secret,
    '{}',
    '019c94cf-0b89-76b4-a337-c37a891f1274',
    '1000',
  )
  assert.equal(verifyInternalRequest({
    secret,
    body: '{}',
    requestId: signed.requestId,
    timestamp: signed.timestamp,
    signature: signed.signature,
    now: 1_301,
  }), false)
})

test('internal request signatures require a safe stable request ID', () => {
  assert.throws(() => signInternalRequest(secret, '{}', '../unsafe'))
  const signed = signInternalRequest(secret, '{}')
  assert.match(signed.requestId, /^[a-f0-9-]{36}$/)
  assert.equal(verifyInternalRequest({
    secret,
    body: '{}',
    requestId: null,
    timestamp: signed.timestamp,
    signature: signed.signature,
  }), false)
})

test('tenant and anonymous subject identifiers are constrained', () => {
  assert.equal(validatedTenantId('taicho'), 'taicho')
  assert.throws(() => validatedTenantId('../another-tenant'))
  assert.equal(anonymousSubjectId('1234567890abcdef'), 'anonymous:1234567890abcdef')
  assert.throws(() => anonymousSubjectId('short'))
})

test('verified email subjects reject malformed and oversized input in linear time', () => {
  assert.match(verifiedEmailSubjectId('User@example.com'), /^email:[a-f0-9]{64}$/)
  assert.throws(() => verifiedEmailSubjectId('user@@example.com'))
  assert.throws(() => verifiedEmailSubjectId(`${'a.'.repeat(2_000)}@example.com`))
})
