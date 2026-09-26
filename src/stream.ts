/**
 * this is a new version of the Stream routine. this one is designed
 * to preserve the existing API message structure, whatever that is
 * (it will be one of OAI, Anthropic, or Gemini).
 * 
 * in 2026 we can't really keep rewriting messages. they're getting
 * too specific, and too divergent, for that to work. so in the new
 * scheme we'll preserve the raw message stream and do translation 
 * when displaying them.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import type { InitMessage, MessageType } from './llm-worker';
import type { Model } from './models';
import { ToolDefinition } from './tool-schema';
import { MessageParam, TextBlockParam, ThinkingBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
import { ToolHandlerImageResponseType, ToolHandlerResponseType } from './tool-handlers';

import type { Content as GeminiContent, GenerateContentResponse as GeminiResponseChunk } from '@google/genai';

export type ClientSideErrorMessage = {
  type: 'client-side-error';
  message?: string;
}

export function IsClientSideErrorMessage(candidate: unknown): candidate is ClientSideErrorMessage {
  if (candidate && typeof candidate === 'object') {
    return (candidate as ClientSideErrorMessage).type === 'client-side-error';
  }
  return false;
}

export function IsNotClientSideErrorMessage<T>(candidate: T|ClientSideErrorMessage): candidate is T {
  return !IsClientSideErrorMessage(candidate); // FIXME: inline
}

export type ChatMessageType<T, K = string> = {
  type: K;
  messages: (T|ClientSideErrorMessage)[];
};

export type AnthropicChatMessages = ChatMessageType<Anthropic.Messages.MessageParam, 'anthropic'>;
export type GeminiChatMessages = ChatMessageType<GeminiContent, 'gemini'>;
export type GPTResponsesChatMessages = 
  ChatMessageType<OpenAI.Responses.ResponseInputItem, 'openai-responses'>;

/** helper for OpenAI's questionable typing */
export function IsNotItemReference<T>(candidate: T|OpenAI.Responses.ResponseInputItem.ItemReference): candidate is T {
  return !(candidate && typeof candidate === 'object' && (candidate as OpenAI.Responses.ResponseInputItem.ItemReference).type === 'item_reference');
}

export type IndexedToolResult = ToolHandlerResponseType & { index: number };

export type TypedChatMessages
  = AnthropicChatMessages
  | GeminiChatMessages
  | GPTResponsesChatMessages
  | ChatMessageType<any, 'generic'>
  ;

export interface GenericToolCall {
  name: string;
  index: number;
  params?: unknown;
  complete?: boolean;
}

export type Parameters<T extends TypedChatMessages = TypedChatMessages> = 
{
  model: Model;
  system_prompt: string;
  api_key: string;
  
  // messages: (T|ClientSideErrorMessage)[];
  messages: T; // TypedChatMessages;

  /** worker is passed in because how it's created depends on platform and support */
  worker: Worker;

  tools?: ToolDefinition[];
  timeout?: number;

  /**
   * triggered by various conditions for different APIs. the deepseek 
   * anthropic interface sends this early, apparently incorrectly.
   */
  message_complete?: boolean;

  /** 
   * capture stop reason. this could indicate an error or refusal, or in
   * absence, could indicate a stream error. TODO: sort out the different 
   * provider API values
   */
  stop_reason?: string;

  /** insert index, so we can tell svelte to update */
  current_message_index?: number;

  /** current message, as type */
  active_message?: Exclude<T['messages'][number], ClientSideErrorMessage>;

  /** array type */
  active_messages?: Exclude<T['messages'][number], ClientSideErrorMessage>[];

  /** workspace */
  tool_calls?: GenericToolCall[];

  /** callback tool handler */
  tool_call_fn?: (args: GenericToolCall[], partial?: boolean) => Promise<IndexedToolResult[]>;

  /**
   * called after each batch of writes to `messages`, with that same object.
   *
   * Stream() edits `messages` in place, which is all a consumer holding a
   * plain object (or a proxy that accepts direct writes) needs. a consumer
   * whose state can't be written that way -- e.g. a store that only accepts
   * writes through a setter -- passes a plain working copy as `messages`
   * and copies it back into its own state here. the object keeps being
   * edited after this returns, so take a copy, don't keep a reference.
   *
   * (method syntax on purpose: it keeps Parameters<T> bivariant in T, which
   * the per-provider casts in StreamInternal rely on.)
   */
  changed?(messages: T): void;

};

/**
 * clear accumulated state. we have to do this between stream calls
 * if we're looping with tool calls/tool results.
 * 
 * @param params 
 */
function ClearState<T extends TypedChatMessages = TypedChatMessages>(params: Partial<Parameters<T>>) {

  // clear any state
  params.active_message = undefined;
  params.active_messages = undefined;
  params.tool_calls = undefined;
  params.current_message_index = undefined;
  params.message_complete = false;
  params.stop_reason = undefined;

}

/**
 * tell the consumer `messages` changed. guarded: this is consumer code, and
 * it's called from paths that must not throw (the stream promise's settle
 * paths, and Stream()'s finally).
 */
function Notify<T extends TypedChatMessages = TypedChatMessages>(params: Partial<Parameters<T>>) {
  if (params.changed && params.messages) {
    try {
      params.changed(params.messages);
    }
    catch (err) {
      console.error(err);
    }
  }
}

export function GenerateImageBlockContent(result: ToolHandlerImageResponseType): Anthropic.ToolResultBlockParam['content'] {
  const content: Anthropic.ToolResultBlockParam['content'] = [];

  const [header, data] = result.image_uri.split(",");
  const media_type = header.match(/:(.*?);/)?.[1];

  if (media_type !== 'image/jpeg' && media_type !== 'image/png' && media_type !== 'image/webp' && media_type !== 'image/gif') {
    throw new Error('invalid image type');
  }

  content.push({
    type: 'image', 
    source: { 
      type: 'base64', 
      media_type, 
      data,
    }
  });

  if (result.content) {
    content.push({
      type: 'text',
      text: JSON.stringify(result.content),
    });
  };

  return content;

}

function FormatGeminiToolResults(params: Parameters<GeminiChatMessages>, tool_call_results: IndexedToolResult[]) {

  const gemini_message: GeminiContent = {
    role: 'user',
    parts: [],
  };

  for (const result of tool_call_results) {
    if (result) {

      // find the source
      const source = params.active_message?.parts?.[result.index];
      if (source) {
        if (result.type === 'error') {
          gemini_message.parts?.push({
            functionResponse: {
              name: source.functionCall?.name || '',
              response: { error: result.content || 'unknown error' },
              id: source.functionCall?.id,
            }
          });
        }
        else if (result.type === 'image') {
          const [header, data] = result.image_uri.split(",");
          const mimeType = header.match(/:(.*?);/)?.[1];

          gemini_message.parts?.push({
            functionResponse: {
              name: source.functionCall?.name || '',
              response: { content: result.content || {}},
              id: source.functionCall?.id,
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data,
                  }
                }
              ]
            },
          });

        }
        else {
          gemini_message.parts?.push({
            functionResponse: {
              name: source.functionCall?.name || '',
              response: { content: result.content },
              id: source.functionCall?.id,
            },
          });
        }

      }

    }
  }

  if (gemini_message.parts?.length) {
    return gemini_message;
  }

  return undefined;

}

function FormatOpenAIResponsesToolResults(params: Parameters<GPTResponsesChatMessages>, tool_call_results: IndexedToolResult[]) {

  type M = Exclude<GPTResponsesChatMessages['messages'][number], ClientSideErrorMessage>;
  const messages: M[] = [];

  for (const result of tool_call_results) {
    if (result) {

      // find the source
      const source = params.active_messages?.[result.index];
      if (source?.type === 'function_call') {

        let output: string | OpenAI.Responses.ResponseFunctionCallOutputItemList = '';
        switch (result.type) {
          case 'object':
            output = JSON.stringify(result.content);
            break;
          
          case 'error':
            output = JSON.stringify(result);
            break;
          
          case 'image':
            output = [{
              type: 'input_image',
              image_url: result.image_uri,
            }];
            if (result.content) {
              output.push({
              type: 'input_text',
              text: JSON.stringify(result.content),
            });
          }
          break;
        }

        messages.push({
          type: 'function_call_output',
          call_id: source.call_id,
          // id: source.id,
          output,
        });

      }

    }
  }

  return messages;
}


function FormatAnthropicToolResults(params: Partial<Parameters<AnthropicChatMessages>>, tool_call_results: IndexedToolResult[]) {

  type M = Exclude<AnthropicChatMessages['messages'][number], ClientSideErrorMessage>;

  const response_content: Exclude<M['content'], string> = [];

  if (params.messages && params.active_message && typeof params.active_message.content !== 'string') {

    for (const result of tool_call_results) {
      if (result) {

        // find the source
        const source = params.active_message.content[result.index];
        if (source.type === 'tool_use') {

          if (result.type === 'object') {
            response_content.push({
              type: 'tool_result',
              tool_use_id: source.id,
              content: JSON.stringify(result.content),
            });
          }
          else if (result.type === 'error') {

            // flag it. without is_error the model just sees a tool_result
            // whose body happens to read like an error, which it's free to
            // treat as success -- and the UI has nothing to key off either.

            response_content.push({
              type: 'tool_result',
              tool_use_id: source.id,
              content: JSON.stringify(result.content),
              is_error: true,
            });
          }
          else {
            response_content.push({
              type: 'tool_result',
              tool_use_id: source.id,
              content: GenerateImageBlockContent(result),
            });
          }

        }

      }
    }
  }

  if (response_content.length) {
    const message: M = {
      role: 'user',
      content: response_content,
    };
    return message;
  }

}

function ProcessGeminiChunk(params: Partial<Parameters<GeminiChatMessages>>, chunk: GeminiResponseChunk) {

  const messages = params.messages;
  if (messages) {

    // console.info({chunk});

    // gemini has a "message" concept so use the active message

    if (!params.active_message) {

      // reverse order for proxy/solidjs

      params.current_message_index = messages.messages.length;
      params.message_complete = false;
      messages.messages[params.current_message_index] = {
        role: 'model',
        parts: [],

        // do we need an ID here? not sure

      };
      
      params.active_message = messages.messages[params.current_message_index] as GeminiContent;
      
    }

    const message = params.active_message;

    const candidate = chunk.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const [index, part] of candidate.content.parts.entries()) {

        if (!message.parts) {
          message.parts = [];
        }

        const target = message.parts[index];

        // if we have not seen this part before, just grab it
        if (!target) {
          message.parts[index] = part;

          if (part.functionCall) {

            if (!params.tool_calls) {
              params.tool_calls = [];
            }
            params.tool_calls[index] = { 
              name: part.functionCall.name || '',
              params: part.functionCall.args || '',
              index,
            };

            // should we call this function now? that only 
            // makes sense if we're going to ask the model
            // to split input multiple calls

            // TODO: call here 

          }

        }
        else {

          // otherwise it's a delta. there are no function call deltas

          if (part.text) {
            target.text = (target.text || '') + part.text;
          }

        }

      }
    }

    if (candidate?.finishReason) {

      // FIXME: if the reason is not "STOP" then we should probably
      // add a note

      // console.info("finish reason:", candidate.finishReason);
      // console.info(candidate.finishMessage);

      if (candidate.finishReason !== 'STOP') {
        console.warn('finish reason: ' + candidate.finishReason);
        console.info(candidate.finishMessage);
      }

      params.message_complete = true;
    }

  }

}

function ProcessGPTResponsesChunk(params: Partial<Parameters<GPTResponsesChatMessages>>, chunk: OpenAI.Responses.ResponseStreamEvent) {

  // unlike anthropic for OAI responses there's no overarching message;
  // we're going to get multiple "items", each of which get pushed on the 
  // stack. that somewhat breaks our generic construct where we assume 
  // there's a current "message"

  const messages = params.messages;
  if (messages) {

    // console.info({chunk});

    switch (chunk.type) {

      case 'response.created':
        params.active_messages = [];

        // in this case this is the index of the _first_ message
        params.current_message_index = messages.messages.length;
        break;

      case 'response.output_item.done':
        // store the original
        messages.messages[(params.current_message_index||0) + chunk.output_index] = chunk.item as OpenAI.Responses.ResponseInputItem;
        break;

      case 'response.content_part.added':
        {
          const message = params.active_messages?.[chunk.output_index];
          if (message?.type === 'message' && Array.isArray(message.content)) {
            if (chunk.part.type === 'output_text') {
              message.content[chunk.content_index] = chunk.part;
              messages.messages[(params.current_message_index||0) + chunk.output_index] = message;
            }
            else {
              console.info("invalid chunk type for part.added");
            }
          }
          else {
            console.info("invalid message type for part.added", params.active_message);
          }
        }
        break;

      case 'response.content_part.done':
        break;

      case 'response.output_item.added':
        // for text and tool calls, add an item now
        if (params.active_messages) {
          switch (chunk.item.type) {
            case 'computer_call':
            case 'computer_call_output':
              break;
            case 'function_call':

              // create a placeholder for the tool call
              if (!params.tool_calls) {
                params.tool_calls = [];
              }
              params.tool_calls[chunk.output_index] = { 
                name: chunk.item.name || '',
                params: chunk.item.arguments || '',
                index: chunk.output_index,
              };

              // fall through

            default:
              /*
              params.active_messages[chunk.output_index] = 
                messages.messages[(params.current_message_index||0) + chunk.output_index] = 
                {
                  ...chunk.item
                };
              */
              {
                const idx = (params.current_message_index || 0) + chunk.output_index;
                messages.messages[idx] = { ...chunk.item };
                params.active_messages[chunk.output_index] = messages.messages[idx];   // read back the proxy
              }
              break;
          }
        }
        break;

      case 'error':
        // ??
        break;

      case 'response.completed':
        // messages.messages.push(...TransformResponses(chunk.response.output));
        params.message_complete = true;
        break;

      case 'response.function_call_arguments.delta':
        {
          const item = params.active_messages?.[chunk.output_index];
          if (item?.type === 'function_call' && typeof item.arguments === 'string') {
            item.arguments += chunk.delta;
            messages.messages[(params.current_message_index||0) + chunk.output_index] = item;

            const tool_call = params.tool_calls?.[chunk.output_index];
            if (tool_call) {
              tool_call.params = item.arguments;
              params.tool_call_fn?.([tool_call], true);
            }

          }
          else {
            console.info("Item mismatch (1)?", item, chunk);
          }
        }
        break;

      case 'response.output_text.delta':
        {
          const item = params.active_messages?.[chunk.output_index];
          if (item?.type === 'message' && typeof item.content === 'string') {
            item.content += chunk.delta;
            messages.messages[(params.current_message_index||0) + chunk.output_index] = item;
          }
          else if (item?.type === 'message' && Array.isArray(item.content)) {
            let item_content = item.content[chunk.content_index];
            if (item_content?.type === 'output_text') {
              item_content.text += chunk.delta;
              messages.messages[(params.current_message_index||0) + chunk.output_index] = item;
            }
            else {
              console.info("Item mismatch (3)?", item, chunk);
            }
          }
          else {
            console.info("Item mismatch (2)?", item, chunk);
          }
        }
        break;


    }

  }

}

function ProcessAnthropicChunk(params: Partial<Parameters<AnthropicChatMessages>>, chunk: Anthropic.Messages.RawMessageStreamEvent) {

  const messages = params.messages;

  if (messages) {

    // console.info({chunk});

    switch (chunk.type) {
      case 'message_start':

        // {"type": "message_start", "message": 
        //  {"id": "msg_1nZdL29xx5MUA1yADyHTEsnR8uuvGzszyY", 
        //    "type": "message", "role": "assistant", "content": [], 
        //    "model": "claude-opus-4-7", "stop_reason": null, "stop_sequence": null, 
        //    "usage": {"input_tokens": 25, "output_tokens": 1}}}

        // fix for proxy: make sure to set the array element first, then we'll
        // set _that_ as active message so it if is a proxy, that will survive

        params.message_complete = false;
        params.current_message_index = messages.messages.length;
        messages.messages[params.current_message_index] = chunk.message;
        params.active_message = messages.messages[params.current_message_index] as MessageParam;

        break;

      case 'content_block_start':

        // {"type": "content_block_start", "index": 0, "content_block": 
        //  {"type": "text", "text": ""}}

        if (params.active_message) {
          const content = params.active_message.content;
          if (Array.isArray(content)) {

            // create tool call placeholder, but don't call it yet

            if (chunk.content_block.type === 'tool_use') {

              // for the first message, anthropic apparently sends
              // {} here (a literal empty object). that breaks the 
              // application of partial json in subsequent messages.
              // not sure what the correct thing is here.
              //
              // for now we'll patch to an empty string, which should
              // at least allow it to work

              chunk.content_block.input = '';

              if (!params.tool_calls) {
                params.tool_calls = [];
              }
              params.tool_calls[chunk.index] = { name: '', index: chunk.index };
            }

            content[chunk.index] = chunk.content_block;

          }

          if (typeof params.current_message_index === 'number') {
            messages.messages[params.current_message_index] = params.active_message;
          }

        }
        break;

      case 'content_block_delta':

        // {"type": "content_block_delta", "index": 0, "delta": 
        //    {"type": "text_delta", "text": "!"}}

        if (params.active_message) {
          const content = params.active_message.content;
          const target = content?.[chunk.index];
          if (target && typeof target !== 'string') {
            switch (chunk.delta.type) {

              // ATM skipping citations_delta

              // instead of switching the two types, we could just
              // trust the delta type

              case 'thinking_delta':
                (target as ThinkingBlockParam).thinking += chunk.delta.thinking;
                break;

              // capture the thinking block signature so we can echo the block
              // back unchanged. without this, newer models (which stream a
              // signed thinking block) get rejected on replay with
              // "each thinking block must contain thinking".
              case 'signature_delta':
                (target as ThinkingBlockParam).signature += chunk.delta.signature;
                break;

              case 'input_json_delta':
                (target as ToolUseBlockParam).input += chunk.delta.partial_json;
                break;

              case 'text_delta':
                (target as TextBlockParam).text += chunk.delta.text;
                break;

              default:
                console.info("unexpected delta type", chunk.delta.type);
                break;
            }

            if (target.type === 'tool_use') {
              const tool_call = params.tool_calls?.[chunk.index];
              if (tool_call) {
                tool_call.name = target.name;
                tool_call.params = target.input; // is this structured or a string? [FIXME/TODO]
                params.tool_call_fn?.([tool_call], true);
              }
            }

          }

          if (typeof params.current_message_index === 'number') {
            messages.messages[params.current_message_index] = params.active_message;
          }

          // maybe process any partial tool calls

        }


        break;

      case 'content_block_stop':
        if (params.active_message) {
          const content = params.active_message.content;
          const target = content?.[chunk.index];

          // we need to fix this message before we echo it back -- the 
          // input is json text, but when we return it it wants an object

          if (typeof target !== 'string' && target?.type === 'tool_use') {
            if (!target.input) {
              target.input = {};
            }
            else if (typeof target.input === 'string') {
              try {
                target.input = JSON.parse(target.input);
              }
              catch (err) {
                console.info("Parse tool_use input failed", target.input);
              }
            }
          }

        }
        break;

      case 'message_delta':

        // {"type": "message_delta", 
        //  "delta": {"stop_reason": "end_turn", "stop_sequence":null}, 
        //    "usage": {"output_tokens": 15}}

        if (chunk.delta.stop_reason) {
          params.stop_reason = chunk.delta.stop_reason;
        }

        break;

      case 'message_stop':

        // {"type": "message_stop"}
        // console.info("RX message stop -- stop reason (from prior delta):", params.stop_reason);

        params.message_complete = true;
        if (params.active_message) {
          if (typeof params.current_message_index === 'number') {
            messages.messages[params.current_message_index] = params.active_message;
          }
        }
        break;

      default:

        // this type does not seem to include ping messages

        console.info("Unexpected chunk type:", (chunk as any).type);
        break;
    }
  }

  return false;
}

/** 
 * flag allows us to interrupt streaming. this won't actually 
 * stop the stream (I think) -- we need to terminate the worker.
 * but to handle this in the UI we need to do both
 */
let interrupted = false;

/**
 * hard cap on tool-call rounds. the loop in Stream() is otherwise unbounded:
 * a model that keeps calling a tool that keeps failing spins forever, and
 * that looks exactly like a hang from the UI -- a turn that is only a tool
 * call renders nothing, so the transcript sits empty behind the spinner.
 *
 * note a round is one request/response, not one tool call -- a turn that
 * calls four tools is still one round. this is a runaway guard, set well
 * above what real work needs, not a budget.
 */
const MAX_TOOL_CALL_ROUNDS = 40;

/**
 * how long we'll wait for *any* message from the worker before giving up.
 * this is an idle timer, reset on every message, so it never truncates a
 * stream that's still producing -- it only catches a worker that has stopped
 * talking to us without posting `complete` or `error`.
 */
const WATCHDOG_IDLE_MS = 120 * 1000;

/** readable text for a caught value of unknown type */
function ErrorMessageText(err: unknown): string {
  if (err instanceof Error) { return err.message; }
  if (typeof err === 'string') { return err; }
  return String(err ?? 'unknown error');
}

export function AbortStream() {
  interrupted = true;
}

/**
 * remove any assistant/model turn that holds a tool call with no matching
 * result later in the transcript.
 *
 * an interrupted or errored stream leaves the assistant message -- with its
 * tool_use / function_call blocks -- in the list, but never runs the tools, so
 * the next request would carry a dangling call the provider rejects (Anthropic:
 * every tool_use must be answered by a tool_result). dropping the offending
 * turn keeps the transcript re-usable.
 *
 * in practice only the tail turn is ever affected -- earlier rounds resolved
 * their calls before the loop continued -- and a turn without tool calls, or
 * one whose calls are all matched, is left untouched. so this is a no-op on a
 * clean stream, which is why Stream() can call it unconditionally on exit.
 *
 * 'generic' has no tool-result path in Stream()'s loop, so nothing can dangle
 * there; it is intentionally not handled.
 */
export function DropDanglingToolCalls(messages?: TypedChatMessages) {

  if (!messages) { return; }

  switch (messages.type) {

    case 'anthropic': {
      const resolved = new Set<string>();
      for (const message of messages.messages) {
        if (IsClientSideErrorMessage(message)) { continue; }
        if (Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              resolved.add(block.tool_use_id);
            }
          }
        }
      }
      messages.messages = messages.messages.filter(message => {
        if (IsClientSideErrorMessage(message)) { return true; }
        if (Array.isArray(message.content)) {
          return !message.content.some(
            block => block.type === 'tool_use' && !resolved.has(block.id));
        }
        return true;
      });
      break;
    }

    case 'openai-responses': {
      const resolved = new Set<string>();
      for (const item of messages.messages) {
        if (IsClientSideErrorMessage(item)) { continue; }
        if (item.type === 'function_call_output' && item.call_id) {
          resolved.add(item.call_id);
        }
      }
      messages.messages = messages.messages.filter(item => {
        if (IsClientSideErrorMessage(item)) { return true; }
        return !(item.type === 'function_call' && !resolved.has(item.call_id));
      });
      break;
    }

    case 'gemini': {
      const resolved = new Set<string>();
      for (const message of messages.messages) {
        if (IsClientSideErrorMessage(message)) { continue; }
        for (const part of message.parts ?? []) {
          const id = part.functionResponse?.id || part.functionResponse?.name;
          if (part.functionResponse && id) { resolved.add(id); }
        }
      }
      messages.messages = messages.messages.filter(message => {
        if (IsClientSideErrorMessage(message)) { return true; }
        return !(message.parts ?? []).some(part => {
          if (!part.functionCall) { return false; }
          const id = part.functionCall.id || part.functionCall.name;
          return !id || !resolved.has(id);
        });
      });
      break;
    }

  }

}

/**
 * splitting the stream method in two so we can loop if there are tool calls
 */
export async function Stream<T extends TypedChatMessages = TypedChatMessages>(
    params: Partial<Parameters<T>>) {

  // clear flag
  interrupted = false;

  if (!params.api_key) {
    throw new Error('Missing API key');
  }

  if (!params.model) {
    throw new Error('Invalid model');
  }

  if (!params.messages || !params.messages.messages.length) {
    throw new Error('no messages');
  }

  // whatever path we leave the loop by -- a normal finish, an interrupt, a
  // watchdog/worker error, or the round cap -- make sure we don't strand a
  // tool call with no result, which would poison the next request. a clean
  // turn has nothing unmatched, so this is a no-op there. `continue` (between
  // tool rounds) stays inside the loop, so this fires exactly once, on exit.
  try {

    for (let round = 0; ; round++) {

      if (round >= MAX_TOOL_CALL_ROUNDS) {
        params.messages?.messages.push({
          type: 'client-side-error',
          message: `stopped after ${MAX_TOOL_CALL_ROUNDS} tool-call rounds without a final response`,
        });
        Notify(params);
        return;
      }

      ClearState(params);

      await StreamInternal(params as Parameters<T>);

      if (interrupted) {
        console.info("interrupted, returning");
        return;
      }

      if (params.tool_calls && params.tool_call_fn) {
        try {
          const content = await params.tool_call_fn(params.tool_calls, false);
          if (content?.length) {
            if (params.messages?.type === 'gemini') {
              const next_message = FormatGeminiToolResults(params as Parameters<GeminiChatMessages>, content);
              if (next_message) {
                params.messages.messages.push(next_message);
                Notify(params);
                continue;
              }
            }
            if (params.messages?.type === 'openai-responses') {
              const responses = FormatOpenAIResponsesToolResults(params as Parameters<GPTResponsesChatMessages>, content);
              if (responses.length) {
                params.messages.messages.push(...responses);
                Notify(params);
                continue;
              }
            }
            else if (params.messages?.type === 'anthropic') {
              const next_message = FormatAnthropicToolResults(params as Parameters<AnthropicChatMessages>, content);
              if (next_message) {
                params.messages.messages.push(next_message);
                Notify(params);
                continue;
              }
            }
          }
          else {
            console.info("content length is 0?");
          }
        }
        catch (err) {
          params.messages?.messages.push({
            type: 'client-side-error',
            message: err?.toString() || 'unknown error (client-side)',
          });
          Notify(params);
        }
      }
      else {
        // console.info("returning on no pending tool calls");
      }

      // console.info("reached end of loop");

      return;

    }

  }
  finally {
    DropDanglingToolCalls(params.messages);
    Notify(params);
  }

}

/** add a user chat message, in the approrpriate API style */
export function AddUserChatMessage(messages: TypedChatMessages, text: string) {

  switch (messages.type) {
    case 'anthropic':
    case 'openai-responses':

      // anthropic and OAI are the same here

      messages.messages.push({
        role: 'user',
        content: text,
      });
      break;

    case 'gemini':
      messages.messages.push({
        role: 'user',
        parts: [
          {
            text,
          }
        ],
      })
      break;
  }
}

async function StreamInternal<T extends TypedChatMessages = TypedChatMessages>(
    params: Parameters<T>) {


  const init_message: InitMessage = {
    type: 'init2',
    key: params.api_key,
    // temperature,
    // thinking_budget,
    // messages: params.messages,
    messages: params.messages,
    system_prompt: params.system_prompt || '',
    model: params.model,
    tools: params.tools,
  };

  const messages = params.messages;

  if (params.worker) {

    let message_stack: MessageType[] = [];
    let process_timeout = 0;

    const ProcessStack = () => {
      const temp = [...message_stack];
      message_stack = [];
      try {
        ProcessChunks(temp);
      }
      finally {
        // notify even if a chunk threw part-way: whatever was applied before
        // the throw is in `messages`, and the consumer should see it.
        if (temp.length) {
          Notify(params);
        }
      }
    };

    const ProcessChunks = (temp: MessageType[]) => {
      for (const message of temp) {
        switch (message?.type) {

          case 'anthropic-chunk':
            if (params.messages?.type === 'anthropic') {
              ProcessAnthropicChunk(params as Parameters<AnthropicChatMessages>, message.chunk);
            }
            break;

          case 'gemini-chunk':
            if (params.messages?.type === 'gemini') {
              ProcessGeminiChunk(params as Parameters<GeminiChatMessages>, message.chunk);
            }
            break;

          case 'openai-responses-chunk':
            if (params.messages?.type === 'openai-responses') {
              ProcessGPTResponsesChunk(params as Parameters<GPTResponsesChatMessages>, message.chunk);
            }
            break;


          /*

          case 'openai-chunk':
            complete = complete || ParseSegmentGPT(opts, [JSON.stringify(message.chunk)]);
            break;

          */

        }
      }
    };

    const worker = params.worker;

    //
    // this promise is the whole stream: the caller awaits it, and in the app
    // the modal spinner lives exactly as long as that await. everything that
    // settles it runs in a callback, and a throw in a callback does *not*
    // reject the enclosing promise -- it escapes into the event loop and
    // leaves the promise pending forever. so every path here settles first
    // and does anything that might throw afterwards, and the whole message
    // handler is wrapped. there is no way out of this block except Settle().
    //

    let settled = false;
    let reported = false;
    let interval_id = 0;
    let watchdog_id = 0;

    await new Promise<void>(resolve => {

      /** settle the stream promise. idempotent. */
      const Settle = () => {
        if (settled) { return; }
        settled = true;
        resolve();
      };

      /**
       * report a client-side failure in the transcript, at most once per
       * stream. guarded, because this may be a store write in the consuming
       * app and can run reactive effects that throw -- and it's called from
       * the paths that exist precisely because something already threw.
       * (Notify is guarded on its own.)
       */
      const Report = (message: string) => {
        if (reported) { return; }
        reported = true;

        // we didn't reach a clean end of stream, so anything we accumulated
        // may be half-built -- don't hand it to the tool-call loop.

        params.tool_calls = undefined;

        try {
          messages.messages.push({
            type: 'client-side-error',
            message,
          });
        }
        catch (err) {
          console.error(err);
        }
        Notify(params);
      };

      /** (re)arm the idle watchdog -- see WATCHDOG_IDLE_MS */
      const ResetWatchdog = () => {
        window.clearTimeout(watchdog_id);
        watchdog_id = window.setTimeout(() => {
          Settle();
          Report('the model stopped responding');
        }, WATCHDOG_IDLE_MS);
      };

      interval_id = window.setInterval(() => {
        if (interrupted) {
          Settle();
          Report('interrupted');
        }
      }, 250);

      worker.onmessageerror = (event: MessageEvent) => {
        Settle();
        Report(ErrorMessageText(event.data ?? 'worker error'));
      };

      worker.onerror = (event: ErrorEvent) => {
        Settle();
        Report(ErrorMessageText(event.error ?? (event.message || 'worker error')));
      };

      worker.onmessage = (event: MessageEvent) => {

        ResetWatchdog();

        try {

          const message = event.data as MessageType;
          if (message.type === 'error') {
            Settle();
            Report(message.text || 'unknown error');
            return;
          }
          else if (message.type === 'complete') {

            // settle *before* draining the stack. ProcessStack() runs
            // consumer code -- reactive renders, and partial tool
            // application, which calls into the spreadsheet synchronously --
            // so it can throw, and a throw used to mean we never reached
            // resolve(). resolve() only queues the awaiting continuation,
            // so the drain below still runs to completion first; we just
            // can't be stranded by it any more.

            Settle();

            // if there's something on the stack we need to 
            // handle it first (this was causing dropped packets)

            if (process_timeout) {
              window.clearTimeout(process_timeout);
              process_timeout = 0;
              ProcessStack();
            }

            return;
          }

          message_stack.push(message);
          // current_chunks.push(JSON.parse(JSON.stringify(message)));

          if (!process_timeout) {
            process_timeout = window.setTimeout(() => {
              process_timeout = 0;
              try {
                ProcessStack();
              }
              catch (err) {
                // same reasoning: uncaught, this would silently drop the
                // rest of the stream and leave the transcript half-built.
                console.error(err);
                Settle();
                Report(ErrorMessageText(err));
              }
            }, 100);
          }

        }
        catch (err) {
          console.error(err);
          Settle();
          Report(ErrorMessageText(err));
        }

      };

      ResetWatchdog();

      try {
        worker.postMessage(JSON.parse(JSON.stringify(init_message))); // remove any svelte wrappers
      }
      catch (err) {
        console.error(err);
        Settle();
        Report(ErrorMessageText(err));
      }

    });

    window.clearTimeout(watchdog_id);
    if (interval_id) {
      window.clearInterval(interval_id);
    }

  }

};



