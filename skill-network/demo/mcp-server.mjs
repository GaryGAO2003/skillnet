/**
 * SkillNet MCP Server
 * Exposes the local SkillNet demo as Claude tools:
 *   list_skills, call_skill, get_dag, get_balances, mint_skill, compose_skill, withdraw
 *
 * Requires the demo server running at http://localhost:3000
 */
import { Server }               from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const BASE = 'http://localhost:3000'

async function call(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  return r.json()
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_skills',
    description: 'List all skills in the SkillNet marketplace with their tier, type, call count, revenue, and price.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'call_skill',
    description: 'Call a skill and pay the fee. Triggers recursive fee distribution through the composition DAG — 70% to creator, 20% upstream, 10% protocol. Calling "save-hello" also writes hello.txt to disk.',
    inputSchema: {
      type: 'object',
      required: ['skillId'],
      properties: {
        skillId: { type: 'number', description: 'The skill ID to call (see list_skills)' },
        value:   { type: 'number', description: 'ETH amount to pay. Defaults to the skill price (0 for free skills).' },
        caller:  { type: 'string', description: 'Caller identity: deployer | alice | bob | carol', default: 'deployer' },
      },
    },
  },
  {
    name: 'get_dag',
    description: 'Get the full composition DAG tree for a skill, showing all dependencies and their royalty weights.',
    inputSchema: {
      type: 'object',
      required: ['skillId'],
      properties: {
        skillId: { type: 'number', description: 'Skill ID to inspect' },
      },
    },
  },
  {
    name: 'get_balances',
    description: 'Get the current claimable ETH balance for every user (deployer, alice, bob, carol, treasury).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mint_skill',
    description: 'Mint a new skill NFT. Optionally compose it with parent skills afterwards using compose_skill.',
    inputSchema: {
      type: 'object',
      required: ['name', 'description', 'skillType', 'tier'],
      properties: {
        name:         { type: 'string' },
        description:  { type: 'string' },
        skillType:    { type: 'string', enum: ['PROMPT_WORKFLOW','TOOL_ADAPTER','AGENT_BEHAVIOR','EVAL_PIPELINE','LORA_ADAPTER','DATASET','COMPOSITE_BUNDLE'] },
        tier:         { type: 'string', enum: ['OPEN','SHIELDED','PRIVATE'] },
        pricePerCall: { type: 'number', description: 'ETH price per call (default 0)' },
        creator:      { type: 'string', description: 'Owner: deployer | alice | bob | carol', default: 'deployer' },
      },
    },
  },
  {
    name: 'compose_skill',
    description: 'Register composition dependencies for an existing skill. Weights must sum to 100. Enforces max depth 5 and cycle detection.',
    inputSchema: {
      type: 'object',
      required: ['childId', 'parentIds', 'weights', 'caller'],
      properties: {
        childId:   { type: 'number', description: 'The child skill ID' },
        parentIds: { type: 'array',  items: { type: 'number' }, description: 'Parent skill IDs' },
        weights:   { type: 'array',  items: { type: 'number' }, description: 'Royalty weights (must sum to 100)' },
        caller:    { type: 'string', description: 'Must be the owner of the child skill' },
      },
    },
  },
  {
    name: 'withdraw',
    description: 'Withdraw accumulated ETH balance for a user from the FeeRouter.',
    inputSchema: {
      type: 'object',
      required: ['user'],
      properties: {
        user: { type: 'string', enum: ['deployer','alice','bob','carol'] },
      },
    },
  },
  {
    name: 'hcs26_registry',
    description: 'Query the HCS-26 Decentralized Agent Skills Registry on Hedera Testnet. Returns all skills published to the Discovery Registry topic, including their skill_uid (HCS-2 sequence number), metadata, OASF tags, and consensus timestamp. Also shows connection status.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'status'],
          description: '"list" returns all registered skills from Hedera mirror node. "status" returns HCS-26 connection info.',
          default: 'list',
        },
      },
    },
  },
]

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'skillnet', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params

  try {
    let text = ''

    switch (name) {

      case 'list_skills': {
        const { skills } = await call('GET', '/api/state')
        text = skills.map(s =>
          `#${s.id}  ${s.name}\n` +
          `     tier: ${s.tier}  type: ${s.skillType}\n` +
          `     price: ${s.pricePerCall} ETH  calls: ${s.totalCalls}  revenue: ${s.totalRevenue.toFixed(6)} ETH\n` +
          `     creator: ${s.creator}`
        ).join('\n\n')
        break
      }

      case 'call_skill': {
        const { skills } = await call('GET', '/api/state')
        const skill = skills.find(s => s.id === args.skillId)
        const value = args.value ?? skill?.pricePerCall ?? 0
        const res   = await call('POST', `/api/call/${args.skillId}`, {
          value,
          caller: args.caller || 'deployer',
        })
        if (res.error) { text = `Error: ${res.error}`; break }
        const tx = res.tx
        const ups = tx.breakdown.upstream
        text =
          `Called "${tx.skillName}" (skill #${tx.skillId})\n` +
          `Caller: ${tx.caller}  |  Payment: ${tx.value} ETH\n\n` +
          `Fee breakdown:\n` +
          `  Protocol → treasury:    ${tx.breakdown.protocol.toFixed(6)} ETH (10%)\n` +
          `  Creator  → ${tx.breakdown.creatorTotal.toFixed(6)} ETH (70% + upstream remainder)\n` +
          (ups.length
            ? `  Upstream royalties:\n` + ups.map(u =>
                `    depth ${u.depth} · "${u.skillName}" (weight ${u.weight}%) → ${u.creator}: ${u.amount.toFixed(6)} ETH`
              ).join('\n')
            : `  Upstream: none (leaf skill)`)
        if (res.tx.fileWritten)        text += '\n\n✓ hello.txt written to disk'
        if (res.tx.fileWritten === false) text += '\n\n(skill.js not found — start server from skill-network/ root)'
        break
      }

      case 'get_dag': {
        const dag = await call('GET', `/api/dag/${args.skillId}`)
        function printTree(node, indent = '') {
          if (!node) return ''
          const w   = node.weight !== undefined ? `[${node.weight}%] ` : ''
          const hdr = `${indent}${w}${node.name} [${node.tier}] — creator: ${node.creator}`
          const kids = (node.children || []).map(c => printTree(c, indent + '    ')).join('\n')
          return kids ? `${hdr}\n${kids}` : hdr
        }
        text = printTree(dag)
        if (!dag?.children?.length) text += '\n(leaf skill — no dependencies)'
        break
      }

      case 'get_balances': {
        const { balances } = await call('GET', '/api/state')
        const total = Object.values(balances).reduce((a, b) => a + b, 0)
        text = 'Claimable balances in FeeRouter:\n\n' +
          Object.entries(balances)
            .map(([u, b]) => `  ${u.padEnd(12)} ${b.toFixed(6)} ETH`)
            .join('\n') +
          `\n\n  TOTAL        ${total.toFixed(6)} ETH`
        break
      }

      case 'mint_skill': {
        const res = await call('POST', '/api/mint', args)
        text = res.error ? `Error: ${res.error}` : `Minted skill #${res.id} — "${args.name}" [${args.tier}]`
        break
      }

      case 'compose_skill': {
        const res = await call('POST', '/api/compose', args)
        text = res.error
          ? `Error: ${res.error}`
          : `Skill #${args.childId} composed with parents [${args.parentIds.join(', ')}] (weights: ${args.weights.join('%, ')}%)`
        break
      }

      case 'withdraw': {
        const res = await call('POST', '/api/withdraw', { user: args.user })
        text = res.error
          ? `Error: ${res.error}`
          : `Withdrew ${res.tx.amount.toFixed(6)} ETH for ${args.user}`
        break
      }

      case 'hcs26_registry': {
        const action = args.action || 'list'

        if (action === 'status') {
          const st = await call('GET', '/api/hcs26/status')
          text =
            `HCS-26 Registry Status\n` +
            `  Configured    : ${st.configured}\n` +
            `  Account ID    : ${st.account_id || '(not set)'}\n` +
            `  Discovery topic: ${st.discovery_topic || '(not set — run scripts/setup-hedera.mjs)'}\n` +
            `  Mirror node   : ${st.mirror_node}`
          break
        }

        // action === 'list'
        const { skills, count, topic, error } = await call('GET', '/api/hcs26/skills')
        if (error) { text = `HCS-26 Error: ${error}`; break }

        if (!count) {
          text = `HCS-26 Discovery Registry (topic ${topic})\nNo skills registered yet.\n\nMint a skill via the demo UI or call mint_skill — it will be auto-published to Hedera.`
          break
        }

        text =
          `HCS-26 Discovery Registry  (topic ${topic})\n` +
          `${count} skill${count === 1 ? '' : 's'} registered on Hedera Testnet\n\n` +
          skills.map(s =>
            `uid=${s.skill_uid}  "${s.name}"\n` +
            `  ${s.description}\n` +
            `  author: ${s.author}  license: ${s.license}\n` +
            `  tags (OASF): [${s.tags.join(', ')}]  tier: ${s.tier}\n` +
            `  consensus_ts: ${s.consensus_timestamp}`
          ).join('\n\n')
        break
      }

      default:
        text = `Unknown tool: ${name}`
    }

    return { content: [{ type: 'text', text }] }

  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error connecting to SkillNet (is http://localhost:3000 running?): ${err.message}` }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
