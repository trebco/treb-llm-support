
import type { ToolCallContent, ToolResultContent } from './chat-message';
import type { ToolName } from './tool-schema';
import { tools_map } from './tool-schema';
import * as v from 'valibot';
import type { EmbeddedSpreadsheet, CellValue, Color, CellStyle, FontSize, BorderConstants, ConditionalFormatType } from '@trebco/treb';
import { ListAnnotations, SummarizeSpreadsheet } from './support-functions';
import { parse as pj_parse } from 'partial-json';
import { type ExternalUI, handlers, ToolHandlerResponseType } from './tool-handlers';


/**
 * OpenAI's strict mode requires every property to be in `required`, so
 * `prepareForStrictMode` (tool-schema.ts) advertises optional fields as nullable.
 * Models then send `null` to mean "not provided", but Valibot's `v.optional`
 * rejects `null`. Strip nulls from object values so the wire format and the
 * runtime validator agree. Array elements are preserved (don't shift indices).
 */
export function StripNullProperties(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) StripNullProperties(item);
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (obj[key] === null) delete obj[key];
      else StripNullProperties(obj[key]);
    }
  }
}

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
 * if this flag is set (1) we don't modify the message, and (2) we don't
 * validate. we just do a best-efforts evaluation. this is done to support
 * streaming updates in the UI, which (IMO) is a better experience
 * 
 */
export async function ExecuteToolCall(sheet: EmbeddedSpreadsheet, ui: ExternalUI, content: ToolCallContent, partial = false): Promise<ToolHandlerResponseType> {

  // partial application is basically an entirely different path,
  // we're keeping it in the same method for convenience

  const tool = tools_map.get(content.name as ToolName);

  if (partial) {

    // ensure this tool supports partial application

    if (tool?.options?.supports_partial_application && content.input) {

      // note that partial application doesn't need to return
      // anything -- we just drop the result

      try {
        // console.info("PARTIAL", {input: content.input});
        const input = pj_parse(content.input);
        const handler = handlers[content.name as ToolName];
        if (handler) {
          const result = handler(sheet, ui, input);
          if (result instanceof Promise) {
            await result;
          }
        }
      }
      catch (err) {
        console.info("partial error", {err});
      }
    }

    // return dummy

    return {
      type: 'object', content: '',
    }

  }
  
  // console.info("REGULAR APPLICATION");

  // before we do anything else, parse the input. we have to do this so the 
  // message shape is correct when we continue the conversation
  // 
  // we _should_ be prevented from doing this twice by the "processed" flag 
  // on the containing message.

  if (typeof content.input === 'string') {
    try {
      // special case for empty string, needs to echo back as empty object
      content.input = content.input === "" ? {} : JSON.parse(content.input);
    }
    catch (err) {
      console.error('error parsing JSON in ExecuteToolCall');
      console.info({err, input: content.input});
      throw err;
    }
  }

  // clone before scrubbing
  
  const content_input = JSON.parse(JSON.stringify(content.input));
  StripNullProperties(content_input);

  const handler = handlers[content.name as ToolName];
  if (!handler) {
    throw new Error('no handler registered for tool: ' + content.name);
  }

  const schema = tool?.schema;
  if (schema) {
    const validation = v.safeParse(schema, content_input);
    if (!validation.success) {
      return {
          type: 'error',
          content: {
            message: 'invalid tool input',
            detail: validation.issues.map(i => i.message),
          },
      };
    }
  }
  else {
    return {
      type: 'error',
      content: 'Missing schema validator',
    };
  }

  let result = handler(sheet, ui, content_input);

  if (result instanceof Promise) {
    result = await result;
  }

  return result;

} 
