import test from 'node:test';
import assert from 'node:assert/strict';

import { generateEd25519Keypair, signPayload, verifyPayload } from '../src/lib/crypto.js';

test('payload signatures verify even when object keys are ordered differently', () => {
  const keys = generateEd25519Keypair();
  const payload = {
    merchant: 'travel-api',
    amountCents: 2450,
    nested: {
      b: 2,
      a: 1
    }
  };

  const signature = signPayload(payload, keys.privateKeyPem);
  const reordered = {
    amountCents: 2450,
    nested: {
      a: 1,
      b: 2
    },
    merchant: 'travel-api'
  };

  assert.equal(verifyPayload(reordered, signature, keys.publicKeyPem), true);
});
