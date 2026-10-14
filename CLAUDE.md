# treb-llm-support

Library for connecting TREB spreadsheets to LLMs. Forked from the RiskAMP web library. The LLM chat machinery (streaming, worker, tool-call loop, tool definitions, models, markdown) lives in **llm-support-core** (`../llm-support-core`, see its CLAUDE.md); this package adds the TREB spreadsheet tools on top:

- **`src/treb/`** -- the TREB tool catalogue, handlers, `ExecuteToolCall`, `SummarizeSpreadsheet`
- **`src/index.ts`** -- the facade existing consumers import: re-exports llm-support-core and `./treb`, and turns `formatConfig.collapsibleCodeBlocks` back on (core defaults it off)
- **`src/llm-worker.ts`**, **`src/support-functions.ts`** -- shims kept at their old paths because consumers deep-import them (`treb-llm-support/src/llm-worker.ts?worker`); `src/system-prompt.md` stays at the root for the same reason (`?raw` import)

## Build & Check

```bash
npm install          # install dependencies
npm run typecheck    # tsc --noEmit
npm run audit        # fails on moderate+ advisories in runtime deps
```

Uses **npm** (the project moved off bun; don't use bun here). There is no build step -- consumers import directly from `src/index.ts`. No test suite currently.

`llm-support-core` and `@trebco/treb` are `file:` dependencies, which npm symlinks (`install-links` is false), so edits in `../llm-support-core` and `../TREB` show up here directly. Both must be checked out next to this repo (llm-support-core: `git@github.com:trebco/llm-support-core.git`) before `npm install`.

**Consumers' dev servers can miss edits here or in llm-support-core** (stale modules from linked packages). If an edit seems to have no effect, restart the consumer's dev server.

**valibot must stay at 1.5.0 or later** (`^1.5.0`): 1.4.1 and earlier have a moderate advisory (GHSA-5qjj-4xww-7phc, `flatten()` can throw on `record()` issue paths with inherited property names). Don't lower the range when adjusting dependencies, and run `npm run audit` after dependency changes.

## Architecture

The TREB tools are `ToolDefinition`s (`defineTool` from llm-support-core). `ExecuteToolCall(sheet, ui, content, partial)` is llm-support-core's `CreateToolExecutor` with context `{ sheet, ui }`; `treb_tool_handlers` exports the handlers in the generic `(context, input)` form so apps can combine TREB tools with their own in one executor.

### Key modules

| File | Purpose |
|------|---------|
| `treb/tools.ts` | TREB tool catalogue: `tools`, `tools_map`, `ToolName`, `ToolInputMap` |
| `treb/tool-handlers.ts` | Handlers that run tool calls against the TREB spreadsheet API; `ExternalUI` |
| `treb/tool-call.ts` | `ExecuteToolCall`, `treb_tool_handlers`, `TREBToolContext` |
| `treb/support-functions.ts` | `SummarizeSpreadsheet`, `ListAnnotations` -- serialize spreadsheet state for the LLM |

## Conventions

- Tool schemas are defined with **Valibot** and converted to JSON Schema for the APIs. The canonical format is Anthropic's `input_schema` shape
- Tool inputs use **comma** as the formula argument separator (not semicolon)
- Layout operations use **1-based** indices in the tool schema, converted to 0-based internally
- Streaming, models and provider conventions are in llm-support-core's CLAUDE.md
