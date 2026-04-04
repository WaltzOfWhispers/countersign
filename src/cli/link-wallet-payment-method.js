import { parseArgs } from 'node:util';

import { requestJson } from '../lib/http-client.js';

const { values } = parseArgs({
  options: {
    server: { type: 'string', default: 'http://localhost:3000' },
    wallet: { type: 'string' },
    'wallet-account-id': { type: 'string' },
    'checkout-session-id': { type: 'string' },
    'return-url': { type: 'string' },
    'cancel-url': { type: 'string' }
  }
});

if (!values.wallet || !values['wallet-account-id']) {
  console.error(
    'Usage: npm run wallet:link-payment-method -- --wallet <wallet-installation-id> --wallet-account-id <wallet-account-id> [--server http://localhost:3000] [--return-url https://example.com/success] [--cancel-url https://example.com/cancel] [--checkout-session-id cs_test_123]'
  );
  process.exit(1);
}

const baseUrl = values.server.replace(/\/$/, '');
const walletInstallationId = values.wallet;
const walletAccountId = values['wallet-account-id'];

if (!values['checkout-session-id']) {
  const started = await requestJson(
    `${baseUrl}/api/users/${walletAccountId}/local-wallet-installations/${walletInstallationId}/stripe/setup-session`,
    {
      method: 'POST',
      body: {
        returnUrl: values['return-url'],
        cancelUrl: values['cancel-url']
      }
    }
  );

  console.log(`Started Stripe setup for ${walletInstallationId}.`);
  console.log(`Checkout URL: ${started.checkoutUrl}`);
  console.log(`Checkout session id: ${started.checkoutSessionId}`);
  console.log('');
  console.log('After you complete the Stripe checkout in your browser, run:');
  console.log(
    `npm run wallet:link-payment-method -- --server ${baseUrl} --wallet ${walletInstallationId} --wallet-account-id ${walletAccountId} --checkout-session-id ${started.checkoutSessionId}`
  );
  process.exit(0);
}

const linked = await requestJson(
  `${baseUrl}/api/users/${walletAccountId}/local-wallet-installations/${walletInstallationId}/payment-method/stripe-session`,
  {
    method: 'POST',
    body: {
      checkoutSessionId: values['checkout-session-id']
    }
  }
);

console.log(
  `Linked Stripe payment method ${linked.walletInstallation.paymentMethod.paymentMethodId} to ${walletInstallationId}.`
);
console.log(
  `Card: ${linked.walletInstallation.paymentMethod.cardBrand.toUpperCase()} ending ${linked.walletInstallation.paymentMethod.cardLast4}`
);
