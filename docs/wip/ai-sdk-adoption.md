# Adopt AI SDK as the LLM layer in lib-factory

## Status: IN PROGRESS (~25%) — Phase 1 proof-of-concept complete

Replace hand-rolled LLM integrations (`runClaude` via CLI spawn, `runLLM` via raw fetch) with the Vercel AI SDK. Provides a unified interface for text generation, structured object extraction, and agentic tool use across any provider (OpenRouter, Anthropic, OpenAI, etc.).

---

## Problem Statement

Factories currently call LLMs in two ways, both with limitations:

1. **`runClaude`** — spawns the Claude CLI. Gets full agentic capabilities (file I/O, bash, multi-step) for free, but requires CLI installed, has process overhead, and is locked to one provider.
2. **`runLLM`** (planned) — direct HTTP to OpenRouter. Fast and portable, but limited to single-turn text in/text out. Can't produce multiple files or do multi-step reasoning without manual plumbing.

The AI SDK solves both:
- `generateText()` — simple prompt → text, replaces raw-prompt `runClaude` callers
- `generateText()` + `Output.object()` — prompt → typed Zod object, perfect for extraction steps that produce structured JSON
- `generateText()` + tools — agentic loop with file/bash tools, replaces slash-command `runClaude` callers

## Learnings from Phase 1

### What works well
- **`generateText()` + `Output.object()` + Zod schema** — clean structured extraction. 5s per invoice vs ~30s with Claude CLI spawn. Schema validation built-in.
- **`extractJsonMiddleware()`** — essential when using OpenRouter. Models (especially Claude) wrap JSON responses in markdown code fences; this middleware strips them automatically. Must be applied via `wrapLanguageModel()`.
- **`createModel()` wrapper** — thin factory that creates OpenRouter model + applies middleware. All callers get code fence handling for free.

### Gotchas discovered
- **`generateObject` deprecated** — PR #10754 (merged Dec 2025) deprecates it in favor of `generateText` + `Output.object()`. We use the new pattern exclusively.
- **`.nullable()` vs `.nullish()` in Zod schemas** — models frequently omit keys instead of sending `null`. Zod's `.nullable()` rejects `undefined` (missing key), `.nullish()` accepts both. Schemas used with `Output.object()` should prefer `.nullish()` for optional-like fields.
- **`stopWhen` replaces `maxSteps`** — AI SDK 6.0 uses `stopWhen: stepCountIs(N)` for multi-step tool loops. Default for `generateText` is `stepCountIs(1)` (single step only!), must be set explicitly.
- **Tool calling double-escaping** — models sometimes double-escape `\n` and `\t` in tool call arguments. writeFile tools should clean `\\n` → `\n`. Do NOT clean `\\"` → `"` as that breaks valid JSON.
- **Token usage** — OpenRouter doesn't always return usage data via the provider; `usage.promptTokens` may be `undefined`.

### API pattern (proven)

```javascript
import { createModel, generateText, Output } from '../src/utils/ai.js';
import MySchema from '../src/schemas/my-schema.js';

const { experimental_output: object } = await generateText({
  model: createModel(),   // defaults to anthropic/claude-sonnet-4
  system: systemPrompt,
  prompt: userPrompt,
  experimental_output: Output.object({ schema: MySchema }),  // Zod schema — enforced by SDK
});
// object is typed and validated
```

## Current LLM Call Sites (factory-acme)

| Pattern | Count | Example | AI SDK replacement |
|---------|-------|---------|--------------------|
| Slash command (file I/O) | 8 | `/extract-msa input.txt output.txt` | `generateText()` + `Output.object()` |
| Raw prompt → stdout | 7 | `runClaude(prompt)` → parse stdout | `generateText()` |
| Raw prompt → file write | 4 | `Read prompt_path and write JSON to output_path` | `generateText()` + `Output.object()` |
| Multi-file agentic | 1 | `/cp-reverse-engineer-billing` | `generateText()` + tools |

## Implementation Phases

### Phase 1: Install and prove out in factory-acme ✅
- [x] Add `ai`, `@openrouter/ai-sdk-provider` to factory-acme
- [x] Create `src/utils/ai.js` — `createModel()` with `extractJsonMiddleware`
- [x] Test `generateText()` + `Output.object()` with Acme invoice extraction — schema validation works, 5s per invoice
- [x] Test `generateText()` + custom tools (readFile/writeFile) — agentic multi-file output works
- [x] Identified key gotchas: code fences, nullable vs nullish, stopWhen vs maxSteps, double-escaping

### Phase 2: Build lib-factory helpers ❌
- [ ] Add `ai`, `@openrouter/ai-sdk-provider` as dependencies in lib-factory
- [ ] Create `src/utils/ai.js` in lib-factory:
  - `createModel(modelId?)` — returns configured provider model with `extractJsonMiddleware`
  - Re-export `generateText`, `Output`, `tool`, `stepCountIs` from `ai`
- [ ] Export from `src/index.js`
- [ ] Bump version, `/bump-dependents`

### Phase 3: Migrate factory-acme callers ❌
- [ ] Migrate extraction slash-command callers (8 sites) → `generateText()` + `Output.object()` with existing Zod schemas
- [ ] Migrate raw-prompt callers (7 sites) → `generateText()`
- [ ] Migrate agentic callers → `generateText()` + tools
- [ ] Delete `src/utils/claude-cli.js`
- [ ] Remove `execa` dependency

### Phase 4: Migrate factory-hooli ❌
- [ ] Same migration pattern as Phase 3
- [ ] Delete local `src/utils/claude-cli.js`

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENROUTER_API_KEY` | When using LLM | OpenRouter API key |

Not validated at factory startup — only checked when `createModel()` is called.

## Files created in Phase 1 (factory-acme)

- `src/utils/ai.js` — Model factory with middleware (the pattern to move to lib-factory)
- `scripts/test-ai-sdk-extract.js` — `generateText()` + `Output.object()` proof-of-concept for invoice extraction
- `scripts/cp-reverse-engineer-billing-ai.js` — `generateText()` + tools proof-of-concept for agentic tasks

## Related Files

- `factories/factory-acme/src/utils/claude-cli.js` — Current implementation being replaced
- `lib/lib-factory/docs/wip/consolidate-claude-cli.md` — Superseded by this WIP
- `lib/lib-factory/docs/wip/openrouter-llm-client.md` — Superseded by this WIP

## Open Questions

- [x] ~~Should we vendor `bash-tool` or use it as a direct dependency?~~ → Custom tools (readFile/writeFile) are simpler for our use case. No sandbox needed.
- [x] ~~Do we need sandboxing for tool execution in production?~~ → No, local filesystem is fine. Tools constrained via path validation.
- [ ] Should `createModel()` support multiple providers (Anthropic direct, OpenAI) or just OpenRouter?
- [x] ~~When `generateObject` is fully deprecated, migrate all callers to `generateText` + `Output.object()`?~~ → Done. Using `generateText` + `Output.object()` exclusively.
