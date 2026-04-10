# treb-llm-support

Library for connecting TREB spreadsheets to LLMs. Forked from the RiskAMP web library. Provides a unified interface for streaming LLM responses from multiple providers and executing spreadsheet tool calls.

## Build & Check

```bash
bun install          # install dependencies
bun run typecheck    # run TypeScript type checking (tsc --noEmit)
```

Uses **bun** as the package manager (not npm). There is no build step -- consumers import directly from `src/index.ts`. No test suite currently.

## Architecture

- **Multi-provider LLM streaming**: Supports Anthropic, OpenAI (+ compatible APIs: DeepSeek, Together, OpenRouter, Kimi), and Google Gemini
- **Web Worker model**: `llm-worker.ts` runs in a Web Worker, receives an `InitMessage` via `postMessage`, streams chunks back to the main thread
- **Unified message format**: All providers' chunks are parsed into a common `ChatMessage` format (Anthropic-style content blocks with `text` and `tool_use` parts). See `chat-message.ts`
- **Segment parsers** (`segment-parser.ts`): `ParseSegmentAnthropic`, `ParseSegmentGPT`, `ParseSegmentGemini` -- incrementally build `AssistantChatMessage` from provider-specific streaming chunks

### Key modules

| File | Purpose |
|------|---------|
| `llm.ts` | Provider-specific streaming functions (`StreamAnthropicResponse`, `StreamGPTResponse`, `StreamGeminiResponse`) |
| `llm-worker.ts` | Web Worker entry point, routes to correct provider |
| `stream.ts` | Main-thread orchestrator, posts init message to worker, collects chunks via `onmessage` |
| `segment-parser.ts` | Parses streaming chunks into unified `ChatMessage` format |
| `chat-message.ts` | Message type definitions (shared across providers) |
| `tool-schema.ts` | Tool definitions using Valibot schemas, with converters to OpenAI and Gemini formats |
| `tool-handlers.ts` | Executes tool calls against the TREB spreadsheet API. Supports partial (streaming) application |
| `support-functions.ts` | `SummarizeSpreadsheet` -- serializes spreadsheet state for LLM context |
| `models.ts` | Model/provider registry with per-model cost info |
| `md.ts` | Markdown rendering (markdown-it + highlight.js + KaTeX) for displaying LLM responses |
| `parse.ts` | Custom JSON parser that handles duplicate keys (ChatGPT quirk) and comments |
| `treb.d.ts` | Type declarations for the TREB spreadsheet API (external dependency) |

## Conventions

- Tool schemas are defined with **Valibot** and converted to JSON Schema for the APIs. The canonical format is Anthropic's `input_schema` shape
- Tool inputs use **comma** as the formula argument separator (not semicolon)
- The message format follows Anthropic's content block structure (`text`/`tool_use`/`tool_result`), other providers are adapted to match
- Gemini requires a `name` field on tool results and `thoughtSignature` on content blocks -- these are stripped before sending to Anthropic
- OpenAI-compatible providers (DeepSeek, Together, OpenRouter, Kimi) all use the OpenAI SDK with custom `baseURL`
- Layout operations use **1-based** indices in the tool schema, converted to 0-based internally
