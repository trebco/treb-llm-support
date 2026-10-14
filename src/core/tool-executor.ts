
import type { ToolCallContent } from './chat-message';
import type { ToolDefinition } from './tool-definition';
import type { ToolHandlerResponseType } from './tool-result';
import * as v from 'valibot';
import { parse as pj_parse } from 'partial-json';

/**
 * a tool handler. `context` is whatever the consuming app needs to act on
 * (for TREB, the spreadsheet and the external UI); `input` has already been
 * validated against the tool's schema, except in partial application.
 */
export type ToolHandlerFn<C, I = any> =
  (context: C, input: I) => ToolHandlerResponseType|Promise<ToolHandlerResponseType>;

/** handlers keyed by tool name */
export type ToolHandlerMap<C> = Record<string, ToolHandlerFn<C>>;

/** signature of the function returned by CreateToolExecutor */
export type ToolExecutor<C> =
  (context: C, content: ToolCallContent, partial?: boolean) => Promise<ToolHandlerResponseType>;

/**
 * OpenAI's strict mode requires every property to be in `required`, so
 * `prepareForStrictMode` (tool-definition.ts) advertises optional fields as nullable.
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
 * create a function that executes tool calls against a set of tools and
 * their handlers. some calls may be asynchronous.
 *
 * the returned executor takes:
 *
 * @param context - passed through to the handler
 * @param content - the content block
 * @param partial - content is not complete, but apply partial evaluation.
 * if this flag is set (1) we don't modify the message, and (2) we don't
 * validate. we just do a best-efforts evaluation. this is done to support
 * streaming updates in the UI, which (IMO) is a better experience
 */
export function CreateToolExecutor<C>(tools: readonly ToolDefinition[], handlers: ToolHandlerMap<C>): ToolExecutor<C> {

  const tools_map = new Map<string, ToolDefinition>();
  for (const entry of tools) {
    tools_map.set(entry.name, entry);
  }

  return async (context: C, content: ToolCallContent, partial = false): Promise<ToolHandlerResponseType> => {

    // partial application is basically an entirely different path,
    // we're keeping it in the same method for convenience

    const tool = tools_map.get(content.name);

    if (partial) {

      // ensure this tool supports partial application

      if (tool?.options?.supports_partial_application && content.input) {

        // note that partial application doesn't need to return
        // anything -- we just drop the result

        try {
          const input = pj_parse(content.input);
          const handler = handlers[content.name];
          if (handler) {
            const result = handler(context, input);
            if (result instanceof Promise) {
              await result;
            }
          }
        }
        catch (err) {
          // expected, and not necessarily a real problem: partial input is
          // parsed from incomplete JSON, so handlers routinely see truncated
          // values mid-stream. the result is discarded either way. converters
          // that can be handed a truncated value should skip it rather than
          // throw -- this stays as a backstop, and deliberately does not
          // rethrow: we're on the stream's call stack.
          console.info("partial application error (may be a truncated value)", {err});
        }
      }

      // return dummy

      return {
        type: 'object', content: '',
      }

    }

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
        console.error('error parsing JSON in tool executor');
        console.info({err, input: content.input});

        // throwing here is a problem
        // throw err;

        return {
          type: 'error',
          content: {
            message: 'invalid JSON',
            detail: (err as any)?.message || undefined,
          },
        };

      }
    }

    // clone before scrubbing

    const content_input = JSON.parse(JSON.stringify(content.input));
    StripNullProperties(content_input);

    const handler = handlers[content.name];
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

    let result = handler(context, content_input);

    if (result instanceof Promise) {
      result = await result;
    }

    return result;

  };

}
