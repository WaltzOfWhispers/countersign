import { createId, nowIsoTimestamp } from './ids.js';

export function runMockStripeTopUp({ amountCents }) {
  return {
    id: createId('fund'),
    provider: 'mock_stripe',
    status: 'succeeded',
    amountCents,
    createdAt: nowIsoTimestamp()
  };
}

export function runMockCrossmintCharge({ merchant, amountCents, currency = 'USD' }) {
  return {
    id: createId('charge'),
    provider: 'mock_crossmint',
    providerReference: createId('cm'),
    status: 'authorized',
    merchant,
    amountCents,
    currency,
    cardBrand: 'visa',
    cardLast4: '4242',
    createdAt: nowIsoTimestamp()
  };
}

export function runMockStripeTravelCharge({
  amountCents,
  currency = 'USD',
  walletAccountId,
  agentId,
  relayRequestId
}) {
  return {
    id: createId('charge'),
    provider: 'mock_stripe_travel_charge',
    providerReference: createId('pi'),
    status: 'captured',
    amountCents,
    currency,
    walletAccountId,
    agentId,
    relayRequestId,
    createdAt: nowIsoTimestamp()
  };
}
