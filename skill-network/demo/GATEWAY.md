# Settlement gateway

Closes the loop between the demo's off-chain money path and the on-chain **SettlementVault**
(Base Sepolia, chainId `84532`). Demo calls accrue into a persistent settlement engine → each
payer's cumulative-spend voucher is signed (EIP-712) → the gateway submits `settleBatch` on-chain.

The gateway is an **on-chain shadow**: it runs in parallel and never touches the demo's own
`state.balances` ledger. If its chain env is absent it runs **disabled** and the demo behaves
exactly as before (all gateway endpoints return `{ "enabled": false }`).

> **DEMO-MODE CUSTODY.** In production each payer signs its own voucher client-side and the
> gateway never holds a payer key. For this self-contained testnet demo the gateway *derives* a
> deterministic throwaway wallet per caller name from `DEMO_PAYER_SEED` and signs on their behalf.
> Those wallets hold only what you deposit for the demo. This is a testnet simplification, not a
> production trust model.

## Environment

| Var | Default | Purpose |
|-----|---------|---------|
| `GATEWAY_PRIVATE_KEY` | falls back to `PRIVATE_KEY` | the gateway/deployer key that submits `settleBatch` |
| `BASE_SEPOLIA_RPC_URL` | — | RPC endpoint (enables the gateway when set with the two below) |
| `SETTLEMENT_VAULT_ADDRESS` | — | deployed vault (`0xb6DECc3e5d3a4E8a0F64DdFC5Fe8A6128abeb8B8`) |
| `TREASURY_ADDRESS` | — | address the protocol-fee `treasury` credit resolves to |
| `SETTLE_THRESHOLD_WEI` | `20000000000000000` (0.02 ETH) | auto-settle when pending ≥ this |
| `SETTLE_MIN_INTERVAL_MS` | `60000` | minimum time between settlements (rate-limit) |
| `DEMO_PAYER_SEED` | fixed dev constant | seed for deterministic demo payer wallets (server + E2E must match) |

The gateway is **enabled** only when `GATEWAY_PRIVATE_KEY`/`PRIVATE_KEY`, `BASE_SEPOLIA_RPC_URL`,
and `SETTLEMENT_VAULT_ADDRESS` are all present. Secrets are never printed to logs, errors, or responses.

## Endpoints

- `GET /api/settlements` — public.
  `{ enabled, gatewayAddress, vaultAddress, pendingWei, threshold, settlements[] }` (BigInts as strings).
- `POST /api/settle` — manual/cron trigger. Signature-gated in signature mode (like other writes).
  Returns the settle result: `{ ok, txHash, blockNumber, batchValue, calls, vouchers, credits }`,
  or `{ busy }` / `{ skipped, reason }` / `{ ok: false, error }` / `{ enabled: false }`.

Settlement is also fired automatically (fire-and-forget) after a paid call once
`pendingWei ≥ SETTLE_THRESHOLD_WEI` and the last settle was more than `SETTLE_MIN_INTERVAL_MS` ago.
It never blocks or fails the call response.

**Correctness.** `settle()` is mutex-guarded (concurrent calls get `{ busy: true }`) and snapshots
the accrual window before building the batch; if the on-chain submit reverts or times out it
**restores** the window (merge-adding any amounts that accrued concurrently) and rolls back the
per-payer voucher cursor, so nothing is lost and a retry re-settles the full amount. On boot it
reconciles each known payer against on-chain `spent()` (chain is truth) to avoid stale-voucher
reverts after state loss.

## Cron suggestion

On a sleep-prone host (e.g. Render free tier) an external cron keeps the batch flushing and wakes
the instance:

```
*/5 * * * *  curl -fsS -X POST https://<your-demo-host>/api/settle \
  -H 'content-type: application/json' \
  -H 'x-skillnet-pubkey: <b64url>' -H 'x-skillnet-timestamp: <ms>' -H 'x-skillnet-signature: <b64url>'
```

(In `AUTH_MODE=dev` the signature headers are unnecessary.) `SETTLE_MIN_INTERVAL_MS` protects
against over-frequent settlement even if cron fires often.

## End-to-end proof (manual, against Base Sepolia)

`scripts/e2e-settle.mjs` funds two demo payers, makes ~6 cheap calls, settles, and asserts on-chain
`debited == credited == batchValue`. It is **not** run by the test suite.

```bash
cd skill-network/demo
# 1) start the demo server with the chain env (SETTLE_MIN_INTERVAL_MS=0 so manual settle isn't rate-limited)
GATEWAY_PRIVATE_KEY=$PRIVATE_KEY \
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org \
SETTLEMENT_VAULT_ADDRESS=0xb6DECc3e5d3a4E8a0F64DdFC5Fe8A6128abeb8B8 \
TREASURY_ADDRESS=$TREASURY_ADDRESS \
SETTLE_MIN_INTERVAL_MS=0 \
node server.js
# 2) in another shell (contracts/.env is auto-loaded for the chain calls):
node scripts/e2e-settle.mjs
```

Prints Basescan links for the settle tx, vault, gateway, and both payers.
