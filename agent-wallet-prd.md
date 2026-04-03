# Product Requirements Document
## Agent Wallet

**Version:** 0.4 (pre-seed)  
**Status:** Draft  
**Author:** [your name]

---

## 1. Problem Statement

Agent wallets exist. Coinbase, OKX, Sponge, Polygon, Privy, OWS — all shipping in 2026. None of them have solved the two foundational problems that make agent payments actually safe and autonomous:

**Problem 1: The wallet doesn't know which agent it's talking to.**

Claude has no persistent identity across sessions. Every conversation starts fresh. When an MCP server receives a payment request, there is no native mechanism to verify whether the request comes from a legitimate, registered agent or something pretending to be one. The current industry answer — session tokens or API keys — tells you which human authenticated at some point. It says nothing about what is happening right now.

The TEE approach (Coinbase, OKX) keeps keys secure inside a trusted enclave, but the trust anchor is still a centralized account. If Coinbase freezes your account, your "autonomous" agent stops. That is not autonomous — it is custodial with a whitepaper.

The local-first approach (OWS) is philosophically cleaner — keys never leave the user's machine, policy engine gates every transaction. But authentication is still API-key-based: token-as-capability, scoped to wallets. There is no persistent agent identity, no reputation layer, no way for the wallet to know if the token was stolen or the agent was manipulated.

**Problem 2: Even with agent identity, the wallet cannot verify that the human intended this specific transaction.**

Prompt injection is real. An agent can be manipulated into taking actions the user never authorized. Spending limits and whitelists reduce blast radius but do not solve the problem — they are damage control, not authentication.

The actual fix is mutual authentication: the wallet verifies the agent, and the agent verifies the wallet, cryptographically, before any funds move. Nobody has built this yet.

---

## 2. Demand Status

**Unvalidated.** The founder has deep domain knowledge (AI + crypto background, followed ERC-8004 closely, identified the adoption gap) but:

- No external validation from agent builders or consumers that mutual authentication is a must-have vs. nice-to-have
- No usage data or behavioral evidence that existing wallets' lack of agent identity is blocking adoption
- The agent economy itself is nascent — autonomous agent-initiated payments are not yet a common pattern
- Existing wallets (Coinbase, Sponge, OWS) are tolerable for current use cases, even without agent identity

The core bet is that as agents become more autonomous and handle higher-value transactions, the identity and trust gap becomes untenable. This is a thesis about where the market is going, not where it is today.

**What would increase confidence:**
- Agent builders expressing frustration with current auth models (API keys, session tokens)
- Incidents where prompt injection led to unauthorized agent spending
- Demand for portable agent reputation across ecosystems
- A vertical use case (e.g., the travel agent) where the wallet solves a concrete, felt problem

---

## 3. Proposed Solution

An agent wallet where the **MCP server instance is the agent identity**, with credit card as the primary payment rail and crypto used only where it adds genuine value — the identity and trust layer.

**The key separation:** identity and payment rails are independent problems. The onchain identity layer — MCP server keypair, ERC-8004 registration, mutual authentication — has nothing to do with what rail moves the money. A user funds their wallet with a Visa card. The agent authenticates with a cryptographic identity. These are two different layers.

When a user installs the wallet MCP server, the installation generates a keypair. That keypair becomes the stable, persistent identity for that agent — anchored not to a session or a Coinbase account, but to a cryptographic identity the user controls. Privacy is preserved: the onchain identity is a keypair, not a name or email.

Every transaction request is signed by the MCP server instance. The wallet backend verifies the signature before moving any funds. Neither side trusts the other blindly.

The wallet is general-purpose infrastructure. It is not tied to any specific service or vertical. Any agent-powered product — travel, shopping, research, logistics — can use it as the payment and identity layer.

---

## 4. Target Users

**Primary — Consumers**  
Non-crypto-native users who want to delegate tasks to AI agents without manually approving every payment. They fund the wallet once with a credit card and set a spending policy. From then on, their agents can pay for services autonomously within those limits.

**Secondary — Agent builders**  
Developers building autonomous agents who need wallet infrastructure that works across frameworks (Claude/MCP, OpenClaw, custom). They integrate the wallet SDK or MCP server and get identity, trust, and payments in one package.

---

## 5. Distribution

The wallet is general-purpose infrastructure. It should not depend on any single vertical for distribution. The founder is also building an AI travel agent — if the travel agent validates, it becomes a powerful distribution channel for the wallet. But the wallet must have its own path to users independent of the travel agent.

**Channel 1 — MCP server for Claude**  
Published as an installable MCP server. User installs via `npx`, funds via credit card, and any Claude-powered agent can immediately pay for services autonomously. Distribution via MCP registries, Claude Code plugin directories, and developer communities.

**Channel 2 — OpenClaw skill**  
Same core wallet exposed as an OpenClaw skill. OpenClaw's messaging-first interface and existing user base make it a natural second channel.

**Channel 3 — Travel agent integration (if validated)**  
If the AI travel agent validates demand, the wallet becomes its payment layer. Travel agent users get the wallet provisioned as part of onboarding. This is a powerful acquisition channel but is contingent on the travel agent succeeding — the wallet must not depend on it.

**Channel 4 — SDK for agent builders**  
Documented wallet infrastructure that external developers can integrate into their own agent products.

---

## 6. Architecture

### 6.1 Layers

**Identity Layer — cryptographic, censorship-resistant**  
MCP server keypair, mutual wallet/agent authentication, and optionally onchain registration and reputation. This is where the core differentiation lives. No central authority can revoke an agent identity.

**Payment Rail Layer — user's choice, credit card first**  
How money actually moves. Credit card via Stripe (user onramp) and Crossmint (agent spending). Stablecoin optionally for users who prefer it or for agent-to-agent transactions in later phases.

### 6.2 Components

**Wallet Core**  
Manages credentials, enforces spending policies, coordinates between identity layer and payment rails. Shared across all surfaces. OWS-compatible: exposes equivalent abstract operations so wallets here work in OWS-compatible tools.

**MCP Server (Agent Identity Layer)**  
Installed by the user via `npx`. On first install, generates a keypair. All subsequent requests from this installation are signed with that keypair. The wallet backend authenticates against the registered identity before executing any transaction.

**Web Dashboard**  
User-facing management interface. Fund wallet, set spending policies, view transaction history, manage agent identities. No crypto knowledge required.

### 6.3 Payment Infrastructure

**User onramp — Stripe**  
User enters credit card to fund their wallet balance. Stripe handles card processing, fraud detection, and compliance. This is a one-time or recurring top-up, not a per-transaction flow.

**Agent spending — Crossmint**  
When an agent needs to pay a service, the wallet instructs Crossmint to execute the payment via a virtual Visa/Mastercard card. Crossmint acts as Merchant of Record, handling returns, chargebacks, and compliance on a per-transaction basis. Crossmint is already integrated with OpenClaw via lobster.cash and is AP2-compatible.

This separation means: Stripe for human-to-wallet funding (clean, familiar UX), Crossmint for wallet-to-service spending (agent-native, handles the edge cases).

### 6.4 Authentication Flow

```
1. User installs MCP server
   → keypair generated locally
   → user claims ownership via web dashboard
   → user funds wallet via credit card (Stripe)
   → spending policy declared: per-transaction limit, daily cap,
     service allowlist, approval threshold

2. Agent makes a payment request
   → MCP server signs request with instance keypair
   → wallet backend verifies signature
   → wallet checks: is this keypair registered and linked to a funded account?
   → wallet checks: does this transaction fall within declared spending policy?
   → if all pass: payment executes via Crossmint (credit card rail)

3. Wallet authenticates itself to the agent
   → wallet signs its response with its own keypair
   → MCP server verifies before accepting the result
   → mutual authentication complete
```

### 6.5 Identity Model

- Each MCP server installation = one agent identity (keypair)
- Human account links to one or more agent identities
- No central authority can revoke an agent identity
- Privacy preserved: identity is a public key, not PII
- Optional ERC-8004 registration for portable reputation and cross-ecosystem discoverability

### 6.6 Spending Policy Layer

OWS-compatible policy semantics — default-deny on failure:

- Per-transaction limit
- Daily/weekly cap
- Service/domain allowlist
- Category restrictions
- Human approval threshold (transactions above $X require explicit confirmation)

### 6.7 Protocol Compatibility

| Protocol | Role | When relevant |
|---|---|---|
| OWS | Local wallet standard — compatible interface | Phase 1 |
| Stripe | User funding onramp | Phase 1 |
| Crossmint / AP2 | Agent spending rail, Merchant of Record | Phase 1 |
| ERC-8004 | Optional identity registration, portable reputation | Phase 2 |
| x402 | Crypto micropayment rail | Phase 2 |
| ERC-8183 | Trustless agent-to-agent commerce (escrow, job lifecycle) | Phase 3 |

ERC-8183 is specifically relevant when agents hire other agents and need trustless settlement — the Client locks funds, the Provider delivers, the Evaluator attests completion on-chain. This is infrastructure for the open agent economy, not needed for consumer-facing Phase 1.

---

## 7. Competitive Differentiation

| | Coinbase/OKX | Sponge | OWS | **Agent Wallet** |
|---|---|---|---|---|
| Key custody | TEE (centralized auth) | Custodial | Local filesystem | Local keypair |
| Agent identity | None | None | API key only | Keypair, mutual auth |
| MCP server auth | No | No | API key | Yes — cryptographic |
| Censorship resistant | No | No | Yes (local) | Yes |
| Credit card onramp | Coinbase account | No | No | Yes (Stripe) |
| Agent spending rail | No | No | No | Yes (Crossmint) |
| OWS compatible | No | No | Native | Yes |

---

## 8. Validation Plan

The wallet has a chicken-and-egg problem: consumers need agent products worth paying for before they'll fund a wallet, and agent builders need wallet infrastructure before they'll build paid agent products. The validation plan attacks both sides.

### Phase 1 — Prove the core loop works

**Build:**
- MCP server with keypair generation and mutual authentication
- Wallet backend with Stripe funding and Crossmint spending
- Web dashboard (minimal: fund, set policy, view transactions)
- Basic spending policy (per-transaction limit, daily cap)

**Validate with agent builders first:**
The fastest path to 50 funded wallets is not consumers — it's developers already building agents who need a payment layer. They're more forgiving of rough edges, they understand MCP, and they have their own user bases.

- Post in Claude Code communities, MCP developer channels, OpenClaw Discord
- Target developers building agents that already need to pay for external services (API calls, data access, tool usage)
- Offer to integrate with 3-5 agent projects as the payment layer

**Validate with own vertical (if travel agent succeeds):**
If the travel agent validates demand in its own Phase 1, integrate the wallet as its payment layer. Travel agent users get the wallet provisioned during onboarding — card captured via Stripe link, wallet funded, spending policy set to travel-relevant defaults. This is a powerful acquisition channel but is not the only one.

**Kill/continue criteria:**
- **0-10 funded wallets after outreach:** The timing is too early, or the identity/trust angle isn't compelling enough yet. Focus on the travel agent and revisit the wallet when the agent economy matures.
- **10-30 funded wallets:** Signal worth pursuing. Double down on whatever distribution channel worked.
- **30+ funded wallets with repeat transactions:** Strong signal. Move to Phase 2.

### Phase 2 — Expand distribution

- OpenClaw skill live
- Key recovery mechanism shipped
- ERC-8004 registration available as optional enrichment
- SDK documented for external agent builders

### Phase 3 — Open agent economy

- x402 micropayment rail for agent-to-agent transactions
- ERC-8183 integration for trustless agent-to-agent commerce
- At least 3 third-party agent products integrated

---

## 9. Success Metrics

**Phase 1**
- First autonomous payment executed via MCP server
- 50 funded wallets with at least one successful agent-initiated transaction
- Install-to-first-transaction under 10 minutes
- At least 3 agent builders integrating the wallet (independent of travel agent)

**Phase 2**
- 500 active wallets across at least two agent products
- Key recovery mechanism shipped
- OpenClaw skill live

**Phase 3**
- ERC-8004 registration available
- SDK documented for external agent builders
- At least 3 third-party agent products integrated

---

## 10. Open Problems

**Key recovery**  
If a user loses their MCP server keypair, they lose their agent identity. Recovery options to evaluate: social recovery, threshold signatures, time-locked secondary key. Must be resolved before broad launch. Note: the payment balance (Stripe/Crossmint) has its own recovery path independent of the keypair — losing the keypair means losing agent identity and policy history, not necessarily the funds.

**Intent verification**  
Mutual authentication solves "is this the right agent." It does not fully solve "did the human want this right now." Spending policy mitigates this. Longer term: transaction previews for high-value or out-of-pattern transactions.

**Crossmint dependency**  
Deliberate tradeoff — consumer adoption now, rail optionality later. Identity layer and payment rail are cleanly separated so the rail can be swapped without touching the identity model.

**Chicken-and-egg**  
The wallet needs agent products to be useful, and agent products need wallets to monetize. The validation plan addresses this by targeting agent builders first (they have the strongest immediate need) and using the travel agent as a parallel path if it validates.

---

## 11. What This Is Not

Not a general-purpose DeFi wallet. Not competing with MetaMask or Coinbase Wallet for humans managing crypto. Not a developer-first infrastructure play competing with Coinbase CDP, Privy, or OWS.

The crypto is not the point. The trust is the point. Crypto is the best available infrastructure for a censorship-resistant, permissionless identity layer — but the user never needs to know that. They fund with a credit card and their agents get to work.

It is a wallet where the agent is the primary user, the human is the owner, and trust between them is the product.

---

## 12. Relationship to Travel Agent

The founder is building both an AI travel agent (separate PRD) and this wallet. The two products are designed to be independent but complementary:

- **The travel agent does not require the wallet.** Phase 1 of the travel agent uses Stripe Payment Intents directly. The wallet is not a dependency.
- **The wallet does not require the travel agent.** The wallet's path to users includes MCP developer communities, OpenClaw, and direct outreach to agent builders. The travel agent is one possible vertical, not the only one.
- **If both validate, they reinforce each other.** The travel agent becomes a high-conviction distribution channel for the wallet. The wallet gives the travel agent a more sophisticated payment and identity layer. Card details captured during travel agent onboarding can provision the wallet silently in the background — one onboarding, both products.
- **If the travel agent doesn't validate, the wallet continues.** The wallet's value proposition (agent identity + trust + payments) is vertical-agnostic. It just needs a different first vertical.
- **If the wallet doesn't validate, the travel agent continues.** Stripe Payment Intents work fine for the travel agent's needs. The wallet is an enhancement, not a requirement.

This independence is deliberate. Neither product's survival depends on the other.
