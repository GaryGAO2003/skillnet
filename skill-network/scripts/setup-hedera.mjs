/**
 * HCS-26 One-Time Setup
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates the HCS-26 Discovery Registry topic on Hedera Testnet and writes
 * the topic ID back into demo/.env.hedera automatically.
 *
 * Run once:
 *   node scripts/setup-hedera.mjs
 *
 * Prerequisites:
 *   - demo/.env.hedera exists with HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY set
 *   - npm install has been run in demo/ (provides @hashgraph/sdk)
 */

import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require   = createRequire(path.join(__dirname, '..', 'demo', 'package.json'))
const { Client, TopicCreateTransaction, AccountId, PrivateKey } = require('@hashgraph/sdk')

const ENV_PATH  = path.join(__dirname, '..', 'demo', '.env.hedera')

// ─── Load .env.hedera ─────────────────────────────────────────────────────────

if (!fs.existsSync(ENV_PATH)) {
  console.error(`\n✗ demo/.env.hedera not found.`)
  console.error(`  Copy demo/.env.hedera.example → demo/.env.hedera and fill in your credentials.\n`)
  process.exit(1)
}

const env = Object.fromEntries(
  fs.readFileSync(ENV_PATH, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
    })
)

if (!env.HEDERA_ACCOUNT_ID || !env.HEDERA_PRIVATE_KEY) {
  console.error('\n✗ HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set in demo/.env.hedera\n')
  process.exit(1)
}

// ─── Connect ──────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════╗')
console.log('║   HCS-26 Setup for SkillNet           ║')
console.log('╚══════════════════════════════════════╝')
console.log(`\n  Account : ${env.HEDERA_ACCOUNT_ID}`)
console.log(`  Network : Hedera Testnet\n`)

const client = Client.forTestnet()
client.setOperator(
  AccountId.fromString(env.HEDERA_ACCOUNT_ID),
  PrivateKey.fromStringECDSA(env.HEDERA_PRIVATE_KEY)
)

// ─── Create Discovery Registry topic ─────────────────────────────────────────

console.log('Creating HCS-26 Discovery Registry topic (type 0)…')
const discoveryTx      = await new TopicCreateTransaction()
  .setTopicMemo('hcs-26:0:86400:0')
  .execute(client)
const discoveryReceipt = await discoveryTx.getReceipt(client)
const discoveryTopicId = discoveryReceipt.topicId.toString()
console.log(`  ✓ Discovery Registry : ${discoveryTopicId}`)

// ─── Write topic IDs back to .env.hedera ──────────────────────────────────────

let envContent = fs.readFileSync(ENV_PATH, 'utf8')

function setEnvVar(content, key, value) {
  const re = new RegExp(`^${key}=.*`, 'm')
  return re.test(content)
    ? content.replace(re, `${key}=${value}`)
    : content + `\n${key}=${value}\n`
}

envContent = setEnvVar(envContent, 'HCS26_DISCOVERY_TOPIC', discoveryTopicId)
fs.writeFileSync(ENV_PATH, envContent)

console.log('\n  ✓ demo/.env.hedera updated\n')
console.log('  Next steps:')
console.log('    1. cd demo && node server.js')
console.log('    2. The server will publish new skills to HCS-26 automatically\n')

client.close()
