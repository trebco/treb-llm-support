
import type { ToolCallContent } from '../core/chat-message';
import type { ToolHandlerResponseType } from '../core/tool-result';
import { CreateToolExecutor, type ToolHandlerMap } from '../core/tool-executor';
import type { EmbeddedSpreadsheet } from '@trebco/treb';
import { tools } from './tools';
import { type ExternalUI, handlers } from './tool-handlers';

/** what TREB tool handlers act on */
export interface TREBToolContext {
  sheet: EmbeddedSpreadsheet;
  ui: ExternalUI;
}

/**
 * TREB handlers, adapted to the generic (context, input) signature.
 * exported so apps can compose these with their own tools in a
 * single executor.
 */
export const treb_tool_handlers: ToolHandlerMap<TREBToolContext> = {};
for (const [name, handler] of Object.entries(handlers)) {
  treb_tool_handlers[name] = (context, input) => (handler as (sheet: EmbeddedSpreadsheet, ui: ExternalUI, input: unknown) => ReturnType<typeof handler>)(context.sheet, context.ui, input);
}

const executor = CreateToolExecutor(tools, treb_tool_handlers);

/**
 * execute a tool call. some calls may be asynchronous.
 *
 * we have some special methods we need to manage outside of the
 * spreadsheet to work with the web app UI, those will get
 * passed in via the external UI object
 *
 * @param sheet - the active spreadsheet
 * @param ui - supplied function interface for ui interactions
 * @param content - the content block
 * @param partial - content is not complete, but apply partial evaluation.
 * see CreateToolExecutor
 */
export async function ExecuteToolCall(sheet: EmbeddedSpreadsheet, ui: ExternalUI, content: ToolCallContent, partial = false): Promise<ToolHandlerResponseType> {
  return executor({ sheet, ui }, content, partial);
}
