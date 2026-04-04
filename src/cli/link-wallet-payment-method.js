import { parseArgs } from 'node:util';

import { createMockStripePaymentMethod } from '../lib/payment-rails.js';
import { updateWalletInstallation } from '../lib/wallet-installation-files.js';

const { values } = parseArgs({
  options: {
    wallet: { type: 'string' },
    'card-brand': { type: 'string', default: 'visa' },
    'card-last4': { type: 'string', default: '4242' },
    'exp-month': { type: 'string', default: '12' },
    'exp-year': { type: 'string', default: '2030' }
  }
});

if (!values.wallet) {
  console.error(
    'Usage: npm run wallet:link-payment-method -- --wallet <wallet-installation-id-or-file> [--card-brand visa] [--card-last4 4242] [--exp-month 12] [--exp-year 2030]'
  );
  process.exit(1);
}

const { installation } = await updateWalletInstallation(values.wallet, (installation) => ({
  ...installation,
  paymentMethod: createMockStripePaymentMethod({
    cardBrand: values['card-brand'],
    cardLast4: values['card-last4'],
    expMonth: Number(values['exp-month']),
    expYear: Number(values['exp-year'])
  })
}));

console.log(`Linked local payment method ${installation.paymentMethod.paymentMethodId} to ${installation.walletInstallationId}.`);
console.log(
  `Card: ${installation.paymentMethod.cardBrand.toUpperCase()} ending ${installation.paymentMethod.cardLast4}`
);
