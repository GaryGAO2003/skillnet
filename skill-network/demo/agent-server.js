'use strict'
/**
 * SkillNet Agent UI — port 3001
 *
 * A simple chat interface backed by Qwen. When Qwen decides to use a skill
 * (via OpenAI-compatible tool_calls), we:
 *   1. POST /api/call/:id on the SkillNet demo server  → recorded in Call Log
 *   2. Execute the skill by calling Qwen with a role-specific system prompt
 *   3. Stream the skill result back into Qwen's context for the final reply
 *
 * No extra npm packages — reuses demo/node_modules (express, etc.)
 * Reads QWEN_API_KEY / QWEN_MODEL from demo/.env.hedera
 */

const express = require('express')
const path    = require('path')
const fs      = require('fs')
const https   = require('https')
const http    = require('http')

// ── Load env from same .env.hedera as the demo server ────────────────────────
const envPath = path.join(__dirname, '.env.hedera')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .forEach(l => {
      const i = l.indexOf('=')
      const k = l.slice(0, i).trim()
      const v = l.slice(i + 1).trim()
      if (v && !process.env[k]) process.env[k] = v
    })
}

const QWEN_API_KEY = process.env.QWEN_API_KEY  || ''
const QWEN_MODEL   = process.env.QWEN_MODEL    || 'qwen-plus'
const QWEN_HOST    = process.env.QWEN_HOST     || 'dashscope-intl.aliyuncs.com'
const QWEN_PATH    = '/compatible-mode/v1/chat/completions'
const SKILLNET_URL = `http://localhost:${process.env.SKILLNET_PORT || 3000}`

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public-agent')))

// ── SkillNet HTTP helpers ─────────────────────────────────────────────────────

function snGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(SKILLNET_URL + urlPath, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch(e) { reject(e) } })
    }).on('error', reject)
  })
}

function snPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req  = http.request(SKILLNET_URL + urlPath, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({}) } })
    })
    req.on('error', e => { console.warn('[SkillNet]', e.message); resolve({}) })
    req.write(data)
    req.end()
  })
}

// ── Qwen call ─────────────────────────────────────────────────────────────────

function qwen(messages, tools) {
  return new Promise((resolve, reject) => {
    if (!QWEN_API_KEY) return reject(new Error('QWEN_API_KEY not set in demo/.env.hedera'))

    const payload = {
      model:           QWEN_MODEL,
      messages,
      max_tokens:      2048,
      temperature:     0.7,
      enable_thinking: false,   // disable chain-of-thought for faster tool calls
    }
    if (tools?.length) {
      payload.tools       = tools
      payload.tool_choice = 'auto'
    }

    const body = JSON.stringify(payload)

    const req = https.request({
      hostname: QWEN_HOST, port: 443, path: QWEN_PATH, method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${QWEN_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        try {
          const p = JSON.parse(raw)
          if (p.error) return reject(new Error(p.error.message || JSON.stringify(p.error)))
          resolve(p)
        } catch(e) { reject(new Error('Qwen parse error: ' + raw.slice(0, 300))) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Strip <think>…</think> blocks that qwen3 models sometimes return
function clean(text) {
  return (text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

// ── SKILL ROUTING ─────────────────────────────────────────────────────────────
//
// How does the agent decide which skill (if any) to invoke?
//
// THIS DEMO — LLM router:
//   A dedicated Qwen call receives the user message and the full skill
//   catalogue, then returns a structured JSON decision:
//     { "skillId": 1, "input": "..." }   → invoke this skill
//     { "skillId": null }                → no skill needed, answer directly
//
//   Pros: zero extra dependencies, readable, easy to debug.
//   Cons: one extra LLM call per turn; non-deterministic; doesn't scale
//         gracefully to large catalogues.
//
// PRODUCTION — embedding similarity:
//   1. Index time: encode each skill's name + description into a dense vector
//      (e.g. text-embedding-3-small, 1536 dims). Store in a vector DB.
//   2. Query time: encode the user message, find top-K nearest skills by
//      cosine similarity, threshold at ~0.75.
//   No extra LLM call — sub-5ms, deterministic, scales to 10k+ skills.
//
// HYBRID (best of both):
//   Embeddings shortlist the top-3 candidates; LLM resolves ambiguity.
//   Fast for clear matches, accurate for edge cases.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent router — asks Qwen to decide which skill fits the user's message.
 * Returns { skill, input } or null (no match / no skills available).
 */
async function routeToSkill(userMessage, skills) {
  if (!skills.length) return null

  const catalogue = skills.map(s =>
    `  { "id": ${s.id}, "name": "${s.name}", "tier": "${s.tier}", "description": "${s.description}" }`
  ).join('\n')

  const routerPrompt =
    `You are a skill router for the SkillNet AI marketplace.\n` +
    `Decide whether the user's message should be handled by one of the registered skills.\n\n` +
    `Registered skills:\n[\n${catalogue}\n]\n\n` +
    `User message: "${userMessage}"\n\n` +
    `Rules:\n` +
    `- If the message clearly maps to a skill's purpose, return that skill.\n` +
    `- If the message is a general question or chitchat, return skillId null.\n` +
    `- The "input" field should be the exact text or data the skill needs.\n\n` +
    `Respond with JSON only — no explanation, no markdown:\n` +
    `{"skillId": <number or null>, "input": "<string>"}`

  const resp = await qwen([{ role: 'user', content: routerPrompt }])
  const raw  = clean(resp.choices[0].message.content)

  // Strip accidental markdown fences (```json … ```)
  const jsonText = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()

  try {
    const decision = JSON.parse(jsonText)
    if (!decision.skillId) return null
    const skill = skills.find(s => s.id === decision.skillId)
    return skill ? { skill, input: decision.input || '' } : null
  } catch(e) {
    console.warn('[Router] JSON parse failed, falling back to no-skill:', jsonText)
    return null
  }
}

// ── POST /api/chat  ───────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body || {}
  if (!messages?.length) return res.status(400).json({ error: 'messages required' })
  if (!QWEN_API_KEY)     return res.status(503).json({
    error: 'QWEN_API_KEY not configured — add it to skill-network/demo/.env.hedera',
  })

  try {
    // 1. Fetch live skill list from SkillNet
    let skills = []
    try { skills = (await snGet('/api/state')).skills || [] }
    catch(e) { console.warn('[SkillNet unreachable]', e.message) }

    // 2. Router: does this message need a skill?
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || ''
    const route = await routeToSkill(lastUserMsg, skills)

    const skillCalls = []
    let skillContext = ''   // injected into the final Qwen call if a skill ran

    if (route) {
      const { skill, input } = route

      // 3. Record on SkillNet → appears in Call Log with caller "qwen-agent"
      let tx = null
      try {
        const r = await snPost(`/api/call/${skill.id}`, {
          value:  skill.pricePerCall || 0,
          caller: 'qwen-agent',
        })
        tx = r.tx || null
      } catch(e) { console.warn('[SkillNet record error]', e.message) }

      // 4. Collect skill result (server.js executes save-hello natively;
      //    for future skills a Qwen sub-call or handler would run here)
      let skillResult
      if (tx?.fileWritten != null) {
        if (tx.fileWritten) {
          // Read the actual file content so the agent can report what was written
          const fs = require('fs'), path = require('path')
          const helloPath = path.join(__dirname, '..', 'skills', 'save-hello', 'hello.txt')
          try {
            const content = fs.readFileSync(helloPath, 'utf8').trim()
            skillResult = `File hello.txt written successfully. Contents:\n${content}`
          } catch { skillResult = 'File hello.txt written successfully.' }
        } else {
          skillResult = 'File write failed.'
        }
      } else {
        skillResult = `Skill "${skill.name}" invoked and recorded on SkillNet.`
      }

      skillCalls.push({ skillId: skill.id, skillName: skill.name, tier: skill.tier, input, result: skillResult, tx })
      skillContext = `\n\n[Skill result from "${skill.name}": ${skillResult}]`
    }

    // 5. Final Qwen call — answer the user, incorporating skill output if present
    const systemMsg = {
      role:    'system',
      content: `You are a SkillNet agent powered by Qwen. ` +
               `You have access to registered skills from the SkillNet marketplace. ` +
               `A separate router already decided whether to invoke a skill before this call. ` +
               `If a skill result is appended to the user message, incorporate it naturally into your reply.`,
    }

    // Append skill context to the last user message so Qwen sees it
    const augmentedMessages = messages.map((m, i) =>
      i === messages.length - 1 && m.role === 'user' && skillContext
        ? { ...m, content: m.content + skillContext }
        : m
    )

    const r = await qwen([systemMsg, ...augmentedMessages])
    return res.json({
      reply:      clean(r.choices[0].message.content),
      skillCalls,
      routerDecision: route ? { skillId: route.skill.id, skillName: route.skill.name } : null,
      usage:      r.usage || {},
    })

  } catch(e) {
    console.error('[/api/chat error]', e)
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/skills  (proxy to SkillNet for the sidebar) ─────────────────────

app.get('/api/skills', async (_req, res) => {
  try {
    const d = await snGet('/api/state')
    res.json({
      skills:      d.skills || [],
      count:       d.skills?.length || 0,
      skillnetUrl: SKILLNET_URL,
    })
  } catch(e) {
    res.json({ skills: [], count: 0, error: e.message, skillnetUrl: SKILLNET_URL })
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = +(process.env.AGENT_PORT || 3001)
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   SkillNet Agent UI                   ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`\n  Agent UI  →  http://localhost:${PORT}`)
  console.log(`  SkillNet  →  ${SKILLNET_URL}`)
  console.log(`  Qwen      →  ${QWEN_MODEL} ${QWEN_API_KEY ? '✓' : '✗ (QWEN_API_KEY missing)'}`)
  console.log()
})
