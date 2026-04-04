import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createCountersignControlPlane } from './control-plane.js';
import { loadEnvFile } from '../lib/env-file.js';

const SERVER_INFO = {
  name: 'countersign-mcp',
  version: '0.1.0'
};

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'];

function parseTrustedAgents(value = process.env.COUNTERSIGN_TRUSTED_AGENTS_JSON) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new Error('COUNTERSIGN_TRUSTED_AGENTS_JSON must be valid JSON.');
  }
}

function projectRootFromImportMeta(importMetaUrl = import.meta.url) {
  return dirname(dirname(dirname(fileURLToPath(importMetaUrl))));
}

export function resolveMcpServerPaths({
  env = process.env,
  cwd = process.cwd(),
  importMetaUrl = import.meta.url
} = {}) {
  const projectRoot = projectRootFromImportMeta(importMetaUrl);
  const baseDir = projectRoot || cwd;
  loadEnvFile({ env, baseDir });

  return {
    dataFile: env.COUNTERSIGN_DATA_FILE || join(baseDir, 'data', 'store.json'),
    walletDir: env.COUNTERSIGN_WALLET_DIR || join(baseDir, 'local-wallet'),
    trustedAgents: parseTrustedAgents(env.COUNTERSIGN_TRUSTED_AGENTS_JSON)
  };
}

function buildTools() {
  return [
    {
      name: 'list_wallets',
      description: 'List wallet accounts available in the shared Countersign store.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'create_wallet',
      description: 'Create a new Countersign wallet account.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Optional wallet owner name.' }
        }
      }
    },
    {
      name: 'get_wallet',
      description: 'Get the current wallet summary, including policy, balance, claim token, and installations.',
      inputSchema: {
        type: 'object',
        properties: {
          walletAccountId: { type: 'string' }
        },
        required: ['walletAccountId']
      }
    },
    {
      name: 'fund_wallet',
      description: 'Top up the legacy mock wallet balance used by non-desktop test flows. The desktop Stripe wallet path does not support USD top-ups.',
      inputSchema: {
        type: 'object',
        properties: {
          walletAccountId: { type: 'string' },
          amountUsd: { type: 'number' }
        },
        required: ['walletAccountId', 'amountUsd']
      }
    },
    {
      name: 'set_wallet_policy',
      description: 'Update wallet spending policy in USD terms.',
      inputSchema: {
        type: 'object',
        properties: {
          walletAccountId: { type: 'string' },
          perTransactionLimitUsd: { type: 'number' },
          dailyCapUsd: { type: 'number' },
          approvalThresholdUsd: { type: 'number' },
          allowedMerchants: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['walletAccountId']
      }
    },
    {
      name: 'generate_claim_token',
      description: 'Generate a one-time wallet daemon claim token.',
      inputSchema: {
        type: 'object',
        properties: {
          walletAccountId: { type: 'string' }
        },
        required: ['walletAccountId']
      }
    },
    {
      name: 'install_wallet_daemon',
      description: 'Create a new local wallet daemon identity and save it under local-wallet/.',
      inputSchema: {
        type: 'object',
        properties: {
          label: { type: 'string' }
        }
      }
    },
    {
      name: 'claim_wallet_daemon',
      description: 'Claim a local wallet daemon identity to a wallet account using a claim token.',
      inputSchema: {
        type: 'object',
        properties: {
          walletInstallationId: { type: 'string' },
          walletAccountId: { type: 'string' },
          claimToken: { type: 'string' },
          label: { type: 'string' }
        },
        required: ['walletInstallationId', 'walletAccountId', 'claimToken']
      }
    },
    {
      name: 'link_wallet_payment_method',
      description: 'Start or complete a real Stripe card-link flow for a claimed wallet daemon installation.',
      inputSchema: {
        type: 'object',
        properties: {
          walletInstallationId: { type: 'string' },
          walletAccountId: { type: 'string' },
          checkoutSessionId: { type: 'string' },
          returnUrl: { type: 'string' },
          cancelUrl: { type: 'string' }
        },
        required: ['walletInstallationId', 'walletAccountId']
      }
    },
    {
      name: 'list_pending_wallet_requests',
      description: 'Poll the relay queue for pending travel-agent authorization requests for a local wallet daemon.',
      inputSchema: {
        type: 'object',
        properties: {
          walletInstallationId: { type: 'string' }
        },
        required: ['walletInstallationId']
      }
    },
    {
      name: 'review_wallet_request',
      description: 'Legacy low-level tool to approve or reject a pending travel-agent authorization request from a specific local wallet daemon installation.',
      inputSchema: {
        type: 'object',
        properties: {
          walletInstallationId: { type: 'string' },
          walletAccountId: { type: 'string' },
          relayRequestId: { type: 'string' },
          decision: {
            type: 'string',
            enum: ['approve', 'reject']
          },
          reasonCode: { type: 'string' }
        },
        required: ['walletInstallationId', 'walletAccountId', 'relayRequestId', 'decision']
      }
    },
    {
      name: 'list_wallet_cards',
      description: 'List the saved cards on the claimed local runtime for a wallet, including the active default card.',
      inputSchema: {
        type: 'object',
        properties: {
          walletAccountId: { type: 'string' }
        },
        required: ['walletAccountId']
      }
    },
    {
      name: 'set_default_wallet_card',
      description: 'Set the default saved card used for wallet-run charges on the claimed local runtime.',
      inputSchema: {
        type: 'object',
        properties: {
          walletAccountId: { type: 'string' },
          paymentMethodId: { type: 'string' }
        },
        required: ['walletAccountId', 'paymentMethodId']
      }
    },
    {
      name: 'request_wallet_charge',
      description: 'Ask the local wallet to evaluate policy and run a charge with the default or selected saved card.',
      inputSchema: {
        type: 'object',
        properties: {
          walletAccountId: { type: 'string' },
          merchant: { type: 'string' },
          amountUsd: { type: 'number' },
          memo: { type: 'string' },
          bookingReference: { type: 'string' },
          paymentMethodId: { type: 'string' }
        },
        required: ['walletAccountId', 'merchant', 'amountUsd']
      }
    },
    {
      name: 'list_wallet_requests',
      description: 'List pending wallet requests for the claimed local runtime behind a wallet account.',
      inputSchema: {
        type: 'object',
        properties: {
          walletAccountId: { type: 'string' }
        },
        required: ['walletAccountId']
      }
    },
    {
      name: 'respond_wallet_request',
      description: 'Wallet-owner action: approve or reject a pending wallet request for the claimed local runtime behind a wallet account.',
      inputSchema: {
        type: 'object',
        properties: {
          walletAccountId: { type: 'string' },
          relayRequestId: { type: 'string' },
          decision: {
            type: 'string',
            enum: ['approve', 'reject']
          },
          reasonCode: { type: 'string' },
          paymentMethodId: { type: 'string' }
        },
        required: ['walletAccountId', 'relayRequestId', 'decision']
      }
    }
  ];
}

function toolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function toolError(message) {
  return {
    content: [
      {
        type: 'text',
        text: message
      }
    ],
    isError: true
  };
}

export function createMcpServer({
  env = process.env,
  cwd = process.cwd(),
  importMetaUrl = import.meta.url
} = {}) {
  const tools = buildTools();
  const controlPlane = createCountersignControlPlane(
    resolveMcpServerPaths({ env, cwd, importMetaUrl })
  );

  let initialized = false;

  async function handleToolCall(name, args = {}) {
    switch (name) {
      case 'list_wallets':
        return toolResult(await controlPlane.listWallets(args));
      case 'create_wallet':
        return toolResult(await controlPlane.createWallet(args));
      case 'get_wallet':
        return toolResult(await controlPlane.getWallet(args));
      case 'fund_wallet':
        return toolResult(await controlPlane.fundWallet(args));
      case 'set_wallet_policy':
        return toolResult(await controlPlane.setWalletPolicy(args));
      case 'generate_claim_token':
        return toolResult(await controlPlane.generateClaimToken(args));
      case 'install_wallet_daemon':
        return toolResult(await controlPlane.installWalletDaemon(args));
      case 'claim_wallet_daemon':
        return toolResult(await controlPlane.claimWalletDaemon(args));
      case 'link_wallet_payment_method':
        return toolResult(await controlPlane.linkWalletPaymentMethod(args));
      case 'list_pending_wallet_requests':
        return toolResult(await controlPlane.listPendingWalletRequests(args));
      case 'review_wallet_request':
        return toolResult(await controlPlane.reviewWalletRequest(args));
      case 'list_wallet_cards':
        return toolResult(await controlPlane.listWalletCards(args));
      case 'set_default_wallet_card':
        return toolResult(await controlPlane.setDefaultWalletCard(args));
      case 'request_wallet_charge':
        return toolResult(await controlPlane.requestWalletCharge(args));
      case 'list_wallet_requests':
        return toolResult(await controlPlane.listWalletRequests(args));
      case 'respond_wallet_request':
        return toolResult(await controlPlane.respondWalletRequest(args));
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async function handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return null;
    }

    if (!('method' in message)) {
      return null;
    }

    if (message.method === 'notifications/initialized') {
      initialized = true;
      return null;
    }

    if (message.method === 'initialize') {
      await controlPlane.initialize();
      initialized = true;
      const requestedVersion = message.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : SUPPORTED_PROTOCOL_VERSIONS[0];

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion,
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: SERVER_INFO
        }
      };
    }

    if (!initialized) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32002,
          message: 'Server not initialized.'
        }
      };
    }

    if (message.method === 'ping') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {}
      };
    }

    if (message.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools
        }
      };
    }

    if (message.method === 'tools/call') {
      try {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: await handleToolCall(message.params?.name, message.params?.arguments || {})
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: toolError(error.message || 'Tool call failed.')
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32601,
        message: `Method not found: ${message.method}`
      }
    };
  }

  return {
    handleMessage
  };
}

export async function main({
  env = process.env,
  cwd = process.cwd(),
  importMetaUrl = import.meta.url
} = {}) {
  const server = createMcpServer({ env, cwd, importMetaUrl });

  process.stdin.setEncoding('utf8');
  let buffer = '';

  process.stdin.on('data', async (chunk) => {
    buffer += chunk;

    while (buffer.includes('\n')) {
      const newlineIndex = buffer.indexOf('\n');
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      try {
        const message = JSON.parse(line);
        const response = await server.handleMessage(message);
        if (response) {
          process.stdout.write(`${JSON.stringify(response)}\n`);
        }
      } catch (error) {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: error.message || 'Parse error.'
            }
          })}\n`
        );
      }
    }
  });
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
