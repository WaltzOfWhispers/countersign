import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY, evaluatePolicy } from '../src/lib/policy.js';

test('policy requests approval above the threshold', () => {
  const result = evaluatePolicy({
    policy: DEFAULT_POLICY,
    approvedTransactions: [],
    balanceCents: 50_000,
    amountCents: 9_000,
    merchant: 'travel-api',
    requestedAt: new Date().toISOString()
  });

  assert.equal(result.decision, 'pending_approval');
  assert.equal(result.reason, 'human_approval_required');
});

test('policy rejects merchants outside the allowlist', () => {
  const result = evaluatePolicy({
    policy: {
      ...DEFAULT_POLICY,
      allowedMerchants: ['travel-api']
    },
    approvedTransactions: [],
    balanceCents: 50_000,
    amountCents: 2_000,
    merchant: 'other-service',
    requestedAt: new Date().toISOString()
  });

  assert.equal(result.decision, 'reject');
  assert.equal(result.reason, 'merchant_not_allowlisted');
});
