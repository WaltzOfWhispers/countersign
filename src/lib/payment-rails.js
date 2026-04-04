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

export function createMockStripePaymentMethod({
  cardBrand = 'visa',
  cardLast4 = '4242',
  expMonth = 12,
  expYear = 2030
} = {}) {
  return {
    provider: 'mock_stripe_payment_method',
    customerId: createId('cus'),
    paymentMethodId: createId('pm'),
    cardBrand: String(cardBrand).trim().toLowerCase() || 'visa',
    cardLast4: String(cardLast4).trim(),
    expMonth: Number(expMonth),
    expYear: Number(expYear),
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

export function runMockStripeWalletCharge({
  amountCents,
  currency = 'USD',
  walletAccountId,
  agentId,
  relayRequestId,
  paymentMethod
}) {
  return {
    id: createId('charge'),
    provider: 'mock_stripe_wallet_charge',
    providerReference: createId('pi'),
    status: 'succeeded',
    amountCents,
    currency,
    walletAccountId,
    agentId,
    relayRequestId,
    paymentMethodId: paymentMethod.paymentMethodId,
    customerId: paymentMethod.customerId,
    cardBrand: paymentMethod.cardBrand,
    cardLast4: paymentMethod.cardLast4,
    createdAt: nowIsoTimestamp()
  };
}
