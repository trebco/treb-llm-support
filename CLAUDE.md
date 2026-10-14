# treb-llm-support

Library for connecting TREB spreadsheets to LLMs. Forked from the RiskAMP web library. It is split into two layers:

- **`src/core/`** -- browser LLM chat with no spreadsheet dependency: multi-provider streaming, the tool-call loop, tool definitions, a generic tool executor, models, markdown rendering. Meant to be usable by apps with no spreadsheet, and to be lifted out into its own package later.
- **`src/treb/`** -- the TREB spreadsheet tools (schemas, handlers, `ExecuteToolCall`, `SummarizeSpreadsheet`) and the system prompt, built on core.

`src/index.ts` is the facade existing consumers import: it re-exports core and treb, and turns `formatConfig.collapsibleCodeBlocks` back on (core defaults it off). `src/llm-worker.ts` and `src/support-functions.ts` are shims kept at their old paths because consumers deep-import them (`treb-llm-support/src/llm-worker.ts?worker`); `src/system-prompt.md` stays at the root for the same reason (`?raw` import).

## Build & Check

```bash
bun install          # install dependencies
bun run typecheck    # tsc --noEmit, then check:core
bun run check:core   # fail if src/core imports from ../treb, the package root, or @trebco
```

Uses **bun** as the package manager (not npm). There is no build step -- consumers import directly from `src/index.ts`. No test suite currently.

**Layering rule**: nothing in `src/core/` may import from outside `src/core/` (other than npm packages) or from `@trebco/*`. `scripts/check-core.ts` enforces it.

## Architecture

- **Multi-provider LLM streaming**: Anthropic (and Anthropic-API-compatible: DeepSeek, Localhost), OpenAI Responses API, and Google Gemini. The older chat-completions path (Together, OpenRouter, Kimi) is currently disabled in the worker (`ENOTIMPL`)
- **Web Worker model**: `core/llm-worker.ts` runs in a Web Worker, receives an `InitMessage` via `postMessage`, streams raw provider chunks back to the main thread. Browser only (`window.setTimeout`, `dangerouslyAllowBrowser`)
- **Provider-native transcripts**: messages are kept in each provider's own format (`TypedChatMessages`: `anthropic` / `gemini` / `openai-responses`), not translated to a common one. `core/stream.ts` has a chunk processor and a tool-result formatter per provider
- **Tools**: a tool is a `ToolDefinition` (Valibot schema + JSON Schema, via `defineTool`). `CreateToolExecutor(tools, handlers)` gives a function that parses, null-strips, validates and dispatches a tool call to a `(context, input)` handler, with best-effort partial application while streaming. TREB's `ExecuteToolCall(sheet, ui, ...)` is that executor with context `{ sheet, ui }`

### Key modules

| File | Purpose |
|------|---------|
| `core/stream.ts` | Main-thread orchestrator: `Stream()`, per-provider chunk processing, tool-call loop, `AbortStream`, `AddUserChatMessage` |
| `core/llm-worker.ts` | Web Worker entry point, routes to the right provider client |
| `core/llm.ts` | Provider streaming calls (`StreamAnthropicResponse`, `StreamResponsesAPI`, `StreamGeminiResponse`) |
| `core/tool-definition.ts` | `ToolDefinition`, `defineTool`, converters to Anthropic / OpenAI / Gemini formats, OpenAI strict mode |
| `core/tool-result.ts` | `ToolHandlerResponseType` (object / image / error) |
| `core/tool-executor.ts` | `CreateToolExecutor`, `StripNullProperties` |
| `core/chat-message.ts` | `ToolCallContent` / `ToolResultContent` |
| `core/models.ts` | Model/provider registry with per-model cost info |
| `core/md.ts` | Markdown rendering (markdown-it + highlight.js + KaTeX), `formatConfig` |
| `treb/tools.ts` | TREB tool catalogue: `tools`, `tools_map`, `ToolName`, `ToolInputMap` |
| `treb/tool-handlers.ts` | Handlers that run tool calls against the TREB spreadsheet API; `ExternalUI` |
| `treb/tool-call.ts` | `ExecuteToolCall`, `treb_tool_handlers` (handlers adapted to the generic signature, for composing with other tools) |
| `treb/support-functions.ts` | `SummarizeSpreadsheet`, `ListAnnotations` -- serialize spreadsheet state for the LLM |

## Conventions

- Tool schemas are defined with **Valibot** and converted to JSON Schema for the APIs. The canonical format is Anthropic's `input_schema` shape
- Tool inputs use **comma** as the formula argument separator (not semicolon)
- Gemini requires a `name` field on tool results and `thoughtSignature` on content blocks -- these are stripped before sending to Anthropic
- OpenAI-compatible providers (DeepSeek, Together, OpenRouter, Kimi) all use the OpenAI SDK with custom `baseURL`
- Layout operations use **1-based** indices in the tool schema, converted to 0-based internally
- `Stream()` edits `params.messages` **in place**, and calls the optional `params.changed(messages)` hook after each batch of writes (chunk drain, tool-result push, error report, exit cleanup). Consumers whose state only accepts writes through a setter (e.g. a Solid store) pass a plain working copy and copy it back in `changed`. Any new write to `messages` in `core/stream.ts` must be followed by `Notify(params)`, or those consumers won't see it
