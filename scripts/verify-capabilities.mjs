#!/usr/bin/env node
/**
 * Capability resolver — real-catalog check.
 *
 * The unit tests in `tests/capabilities.test.ts` use fixed ids. This script
 * runs the same resolver over the models *your* `llm-pi-ai` configuration
 * actually declares, and checks the ids whose verdict 0.3 got wrong.
 *
 *   node scripts/verify-capabilities.mjs
 *   node scripts/verify-capabilities.mjs --patch ~/.dsh/profiles/web/cordis.patch.yml
 *   node scripts/verify-capabilities.mjs --all      # also print every model
 *
 * Exit code 1 when an expected verdict does not match.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(join(ROOT, 'package.json'))
const YAML = require('yaml')
const { resolveCapabilities, MODALITIES } = await import(join(ROOT, 'lib/capabilities.js'))

/** Every verdict 0.3 got wrong, plus a few it got right (regressions). */
const EXPECT = {
  // image models the keyword table missed
  'gemini-nano-banana-2.1': ['image'],
  'gemini-3-pro-image': ['image'],
  'gemini-3.1-flash-image': ['image'],
  'gemini-3.1-flash-lite-image': ['image'],
  'flux.2-klein-4b': ['image'],
  'agnes-image-2.5-flash': ['image'],
  'agnes-image-2.1-flash': ['image'],
  'agnes-image-2.0-flash': ['image'],
  // video models (a "wan"/"veo" family with real generation endpoints)
  'google/veo-3.1-fast': ['video'],
  'wan-ai/wan-2.6-t2v': ['video'],
  'agnes-video-2.5-flash': ['video'],
  'agnes-video-2.5': ['video'],
  // the bare "h3" token used to turn a chat model into a video model
  'minimax/h3': ['text'],
  // chat models that also read images (the vision pool used to be empty)
  'claude-opus-5': ['text', 'vision'],
  'claude-sonnet-5': ['text', 'vision'],
  'gpt-5.6-sol': ['text', 'vision'],
  'gpt-6.1-terra': ['text', 'vision'],
  'gemini-3.1-pro-preview': ['text', 'vision'],
  'kimi-k3.1-pro': ['text', 'vision'],
  // declared metadata must outrank the name
  'MiniMax-M3': ['text', 'vision'],
  'MiniMax-M2.7': ['text'],
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : ''
}

function locatePatchFile() {
  const explicit = arg('--patch')
  if (explicit) return explicit
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (fromEnv) {
    const candidate = join(fromEnv, 'cordis.patch.yml')
    if (existsSync(candidate)) return candidate
  }
  const profiles = join(homedir(), '.dsh', 'profiles')
  if (!existsSync(profiles)) return ''
  for (const name of readdirSync(profiles)) {
    const candidate = join(profiles, name, 'cordis.patch.yml')
    if (existsSync(candidate)) return candidate
  }
  return ''
}

const patchFile = locatePatchFile()
if (!patchFile) {
  console.error('no cordis.patch.yml found; pass --patch <path>')
  process.exit(2)
}

const parsed = YAML.parse(readFileSync(patchFile, 'utf8'))
const entries = Object.values(parsed ?? {})
const piAi = entries.find(
  (entry) => entry && (entry.name === '@deepseek-ai/dsh-llm-pi-ai' || entry.id === 'llm-pi-ai'),
)
if (!piAi?.config?.providers) {
  console.error(`no llm-pi-ai providers in ${patchFile}`)
  process.exit(2)
}

const raw = piAi.config.providers
const providers = Array.isArray(raw)
  ? raw.map((p) => ({ ...p, id: p.id || p.name }))
  : Object.entries(raw).map(([id, p]) => ({ ...(p ?? {}), id }))

console.log(`catalog: ${patchFile}`)
console.log(`providers: ${providers.map((p) => p.id).join(', ')}`)
console.log(`modalities: ${MODALITIES.join(', ')}\n`)

let pass = 0
let fail = 0
let total = 0
for (const provider of providers) {
  for (const model of provider.models ?? []) {
    const verdict = resolveCapabilities({
      id: model.id,
      name: model.name ?? model.id,
      meta: {
        input: model.input,
        output: model.output,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      },
      provider: provider.id,
    })
    const got = (verdict.modalities ?? []).slice().sort()
    total++
    const expected = EXPECT[model.id]
    if (expected) {
      const want = expected.slice().sort()
      const ok = JSON.stringify(got) === JSON.stringify(want)
      if (ok) pass++
      else {
        fail++
        const sources = (verdict.sources ?? []).map((s) => s.level).join(', ')
        console.log(`FAIL ${provider.id}:${model.id} — expected [${want}] got [${got}] (${sources})`)
      }
    } else if (process.argv.includes('--all')) {
      console.log(`info ${provider.id}:${model.id} -> [${got}] primary=${verdict.primary} conf=${verdict.confidence}`)
    }
  }
}

const checked = pass + fail
console.log(`\nmodels scanned: ${total}, expectations checked: ${checked}, pass: ${pass}, fail: ${fail}`)
process.exit(fail === 0 ? 0 : 1)
