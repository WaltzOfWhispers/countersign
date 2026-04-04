import { dayKey } from './ids.js';

export const DEFAULT_POLICY = {
  perTransactionLimitCents: 15000,
  dailyCapCents: 50000,
  approvalThresholdCents: 7500,
  allowedMerchants: []
};

function sanitizeAmount(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.round(parsed);
}

export function normalizePolicy(input = {}) {
  const allowedMerchants = Array.isArray(input.allowedMerchants)
    ? [...new Set(input.allowedMerchants.map((merchant) => String(merchant).trim()).filter(Boolean))]
    : DEFAULT_POLICY.allowedMerchants;

  return {
    perTransactionLimitCents: sanitizeAmount(
      input.perTransactionLimitCents,
      DEFAULT_POLICY.perTransactionLimitCents
    ),
    dailyCapCents: sanitizeAmount(input.dailyCapCents, DEFAULT_POLICY.dailyCapCents),
    approvalThresholdCents: sanitizeAmount(
      input.approvalThresholdCents,
      DEFAULT_POLICY.approvalThresholdCents
    ),
    allowedMerchants
  };
}

export function evaluatePolicy({
  policy,
  approvedTransactions,
  balanceCents,
  amountCents,
  merchant,
  requestedAt,
  skipApprovalThreshold = false,
  skipBalanceCheck = false
}) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { decision: 'reject', reason: 'invalid_amount', daySpendCents: 0 };
  }

  if (amountCents > policy.perTransactionLimitCents) {
    return {
      decision: 'reject',
      reason: 'per_transaction_limit_exceeded',
      daySpendCents: 0
    };
  }

  if (policy.allowedMerchants.length > 0 && !policy.allowedMerchants.includes(merchant)) {
    return { decision: 'reject', reason: 'merchant_not_allowlisted', daySpendCents: 0 };
  }

  const requestDay = dayKey(requestedAt);
  const daySpendCents = approvedTransactions
    .filter((transaction) => dayKey(transaction.createdAt) === requestDay)
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);

  if (daySpendCents + amountCents > policy.dailyCapCents) {
    return { decision: 'reject', reason: 'daily_cap_exceeded', daySpendCents };
  }

  if (!skipBalanceCheck && balanceCents < amountCents) {
    return { decision: 'reject', reason: 'insufficient_funds', daySpendCents };
  }

  if (!skipApprovalThreshold && amountCents > policy.approvalThresholdCents) {
    return { decision: 'pending_approval', reason: 'human_approval_required', daySpendCents };
  }

  return { decision: 'approve', reason: 'policy_passed', daySpendCents };
}
