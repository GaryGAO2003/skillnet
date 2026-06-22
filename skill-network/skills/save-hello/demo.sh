#!/usr/bin/env bash
# Demo: mint the save-hello skill as an NFT, pay to call it, then execute it locally.
# Prerequisites: Anvil running, contracts deployed, env vars set.

export PATH="$PATH:/c/Users/Admin/.foundry/bin"

SKILL_NFT="${SKILL_NFT_ADDRESS:?Error: SKILL_NFT_ADDRESS not set}"
FEE_ROUTER="${FEE_ROUTER_ADDRESS:?Error: FEE_ROUTER_ADDRESS not set}"
RPC="${RPC_URL:-http://localhost:8545}"
PK="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
DEPLOYER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

CONTENT_HASH="0x$(node -e "console.log(require('crypto').createHash('sha256').update('save-hello-v1').digest('hex'))")"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║    save-hello skill demo              ║"
echo "╚══════════════════════════════════════╝"

# ── Step 1: Mint ──────────────────────────────────────────────────────────────
echo ""
echo "Step 1: Minting save-hello as an NFT..."
cast send "$SKILL_NFT" \
  "mintSkill(string,string,uint8,uint8,bytes32,string,uint256,uint256)" \
  "save-hello" \
  "Saves Hello World to a text file" \
  "0" "0" \
  "$CONTENT_HASH" \
  "ipfs://QmSaveHelloSchema" \
  "1000000000000000" \
  "0" \
  --rpc-url "$RPC" \
  --private-key "$PK" \
  --quiet

TOKEN_ID=$(cast call "$SKILL_NFT" "totalSkills()(uint256)" --rpc-url "$RPC")
echo "  ✓ Minted as token #$TOKEN_ID"

# ── Step 2: Pay to call ───────────────────────────────────────────────────────
echo ""
echo "Step 2: Paying 0.001 ETH to call skill #$TOKEN_ID via FeeRouter..."
cast send "$FEE_ROUTER" \
  "payForCall(uint256)" "$TOKEN_ID" \
  --value 0.001ether \
  --rpc-url "$RPC" \
  --private-key "$PK" \
  --quiet
echo "  ✓ Payment routed (70% creator, 20% upstream, 10% protocol)"

# ── Step 3: Execute the actual skill ─────────────────────────────────────────
echo ""
echo "Step 3: Executing skill locally..."
node "$(dirname "$0")/skill.js"

# ── Step 4: Read on-chain state ───────────────────────────────────────────────
echo ""
echo "Step 4: On-chain stats for token #$TOKEN_ID"

# totalSkills confirms the mint
TOTAL=$(cast call "$SKILL_NFT" "totalSkills()(uint256)" --rpc-url "$RPC")
echo "  total skills on-chain : $TOTAL"

# balance in wei, strip the [annotation] cast adds
BALANCE_WEI=$(cast call "$FEE_ROUTER" "getBalance(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC" | awk '{print $1}')
BALANCE_ETH=$(node -e "console.log(($BALANCE_WEI / 1e18).toFixed(6) + ' ETH')")
echo "  claimable balance     : $BALANCE_ETH  (in FeeRouter for deployer)"

echo ""
echo "Output file:"
cat "$(dirname "$0")/hello.txt"
echo ""
echo "Done. Open http://localhost:5173/skill/$TOKEN_ID to see it in the UI."
