'use strict'
/**
 * HCS-26 Integration for SkillNet
 * ─────────────────────────────────────────────────────────────────────────────
 * Publishes skills to Hedera Consensus Service (HCS-26 standard).
 * Reads registered skills back via the Hedera Mirror Node (no auth needed).
 *
 * HCS-26 architecture used here:
 *   Discovery Registry (one global HCS-2 topic)
 *     └─ Each register message → sequence_number = skill_uid
 *   Version Registry (one per skill — created on first publish)
 *     └─ Tracks semver + status (active / deprecated / yanked)
 *
 * Environment variables required (in demo/.env.hedera):
 *   HEDERA_ACCOUNT_ID       e.g. 0.0.8598575
 *   HEDERA_PRIVATE_KEY      hex-encoded ECDSA private key
 *   HCS26_DISCOVERY_TOPIC   HCS-2 topic ID (created by scripts/setup-hedera.mjs)
 */

// OASF numeric skill ID mapping from SkillNet skillType enum
const SKILLTYPE_TO_OASF = {
  PROMPT_WORKFLOW:  [10102],        // NLP – Text Generation
  TOOL_ADAPTER:     [1403],         // Tool Interaction – API Integration
  AGENT_BEHAVIOR:   [1001],         // Agent Orchestration – Task Delegation
  EVAL_PIPELINE:    [1101],         // Evaluation & Monitoring – Performance Evaluation
  LORA_ADAPTER:     [1201],         // DevOps/MLOps – Model Deployment
  DATASET:          [90101],        // Data Engineering – Data Cleaning
  COMPOSITE_BUNDLE: [1001, 1403],   // Delegation + API
}

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com/api/v1'

// Lazy-loaded Hedera client (only initialised when env vars are present)
let _client = null

// ─── Configuration check ─────────────────────────────────────────────────────

function isConfigured() {
  return !!(
    process.env.HEDERA_ACCOUNT_ID &&
    process.env.HEDERA_PRIVATE_KEY &&
    process.env.HCS26_DISCOVERY_TOPIC
  )
}

// ─── Hedera client ────────────────────────────────────────────────────────────

function getClient() {
  if (_client) return _client
  const { Client, AccountId, PrivateKey } = require('@hashgraph/sdk')
  _client = Client.forTestnet()
  _client.setOperator(
    AccountId.fromString(process.env.HEDERA_ACCOUNT_ID),
    PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY)
  )
  return _client
}

// ─── Publish skill to HCS-26 Discovery Registry ───────────────────────────────

/**
 * Register a new skill in the HCS-26 Discovery Registry.
 * @param {object} skill  SkillNet skill object (name, description, skillType, tier, creator, …)
 * @param {string} [versionRegistryTopicId]  Per-skill version registry topic (optional)
 * @returns {Promise<number>}  HCS-26 skill_uid (sequence number of the register message)
 */
async function publishSkill(skill, versionRegistryTopicId) {
  const { TopicMessageSubmitTransaction } = require('@hashgraph/sdk')
  const client = getClient()
  const discoveryTopicId = process.env.HCS26_DISCOVERY_TOPIC

  const message = JSON.stringify({
    p:          'hcs-26',
    op:         'register',
    t_id:       versionRegistryTopicId || discoveryTopicId,  // per-skill version registry
    account_id: process.env.HEDERA_ACCOUNT_ID,
    metadata: {
      name:        skill.name,
      description: skill.description || '',
      author:      skill.creator || process.env.HEDERA_ACCOUNT_ID,
      license:     'MIT',
      tags:        SKILLTYPE_TO_OASF[skill.skillType] || [],
    },
    m: `SkillNet [${skill.tier}] ${skill.name}`,
  })

  const txResponse = await new TopicMessageSubmitTransaction()
    .setTopicId(discoveryTopicId)
    .setMessage(message)
    .execute(client)

  const receipt = await txResponse.getReceipt(client)
  return Number(receipt.topicSequenceNumber)
}

// ─── Publish version entry to Version Registry ────────────────────────────────

/**
 * Register a version in a per-skill version registry topic.
 * @param {string} versionTopicId  The per-skill version registry topic ID
 * @param {object} opts            { skill_uid, version, manifestTopicId, status }
 */
async function publishVersion(versionTopicId, { skill_uid, version = '1.0.0', manifestTopicId, status = 'active' }) {
  const { TopicMessageSubmitTransaction } = require('@hashgraph/sdk')
  const client = getClient()

  const message = JSON.stringify({
    p:         'hcs-26',
    op:        'register',
    skill_uid,
    version,
    t_id:      manifestTopicId || versionTopicId,
    status,
    m:         `v${version} – ${status}`,
  })

  const txResponse = await new TopicMessageSubmitTransaction()
    .setTopicId(versionTopicId)
    .setMessage(message)
    .execute(client)

  const receipt = await txResponse.getReceipt(client)
  return Number(receipt.topicSequenceNumber)
}

// ─── Create a new HCS-2 topic (version registry per skill) ───────────────────

/**
 * Create a new HCS-2 topic to serve as a per-skill version registry.
 * @returns {Promise<string>}  The new topic ID (e.g. "0.0.123456")
 */
async function createVersionRegistryTopic(skillName) {
  const { TopicCreateTransaction } = require('@hashgraph/sdk')
  const client = getClient()

  const tx = await new TopicCreateTransaction()
    .setTopicMemo(`hcs-26:0:86400:1`)    // type 1 = version registry
    .execute(client)

  const receipt = await tx.getReceipt(client)
  return receipt.topicId.toString()
}

// ─── Read skills from HCS-26 via Mirror Node ─────────────────────────────────

/**
 * Fetch all registered skills from the Discovery Registry via Hedera Mirror Node.
 * No authentication required — mirror node is public.
 * @returns {Promise<object[]>}  Array of HCS-26 skill registration objects
 */
async function fetchRegisteredSkills() {
  const topicId = process.env.HCS26_DISCOVERY_TOPIC
  if (!topicId) return []

  let allMessages = []
  let url = `${MIRROR_BASE}/topics/${topicId}/messages?limit=100&order=asc`

  // Handle pagination
  while (url) {
    const res = await fetch(url)
    if (!res.ok) break
    const data = await res.json()
    allMessages = allMessages.concat(data.messages || [])
    url = data.links?.next ? `${MIRROR_BASE}${data.links.next}` : null
  }

  return allMessages
    .filter(m => m.message)
    .map(m => {
      try {
        const text   = Buffer.from(m.message, 'base64').toString('utf8')
        const parsed = JSON.parse(text)
        if (parsed.p !== 'hcs-26' || parsed.op !== 'register') return null

        const meta = typeof parsed.metadata === 'object' ? parsed.metadata : {}
        return {
          skill_uid:           Number(m.sequence_number),
          consensus_timestamp: m.consensus_timestamp,
          name:                meta.name        || '(unnamed)',
          description:         meta.description || '',
          author:              meta.author      || '',
          license:             meta.license     || '',
          tags:                meta.tags        || [],
          tier:                parsed.m?.match(/\[(OPEN|SHIELDED|PRIVATE)\]/)?.[1] || 'OPEN',
          version_registry:    parsed.t_id,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/**
 * Fetch version entries for a specific skill from its version registry topic.
 */
async function fetchSkillVersions(versionTopicId) {
  if (!versionTopicId) return []
  const url = `${MIRROR_BASE}/topics/${versionTopicId}/messages?limit=50&order=desc`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()

  return (data.messages || [])
    .map(m => {
      try {
        const parsed = JSON.parse(Buffer.from(m.message, 'base64').toString('utf8'))
        if (parsed.p !== 'hcs-26' || parsed.op !== 'register') return null
        return { version: parsed.version, status: parsed.status || 'active', seq: m.sequence_number }
      } catch { return null }
    })
    .filter(Boolean)
}

module.exports = {
  isConfigured,
  publishSkill,
  publishVersion,
  createVersionRegistryTopic,
  fetchRegisteredSkills,
  fetchSkillVersions,
  SKILLTYPE_TO_OASF,
}
