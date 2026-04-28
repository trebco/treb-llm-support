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
import { TextBlockParam, ThinkingBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources';
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
  tool_call_fn?: (args: GenericToolCall[], partial?: boolean) => Promise<({
    index: number;
    content: ToolHandlerResponseType;
   }|undefined)[]|undefined>;

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

function FormatGeminiToolCalls(params: Parameters<GeminiChatMessages>, tool_call_results: ({
    index: number;
    content: ToolHandlerResponseType;
   }|undefined)[]) {

  const gemini_message: GeminiContent = {
    role: 'user',
    parts: [],
  };

  for (const result of tool_call_results) {
    if (result) {

      // find the source
      const source = params.active_message?.parts?.[result.index];
      if (source) {
        if (result.content.type === 'error') {
          gemini_message.parts?.push({
            functionResponse: {
              name: source.functionCall?.name || '',
              response: { error: result.content.content || 'unknown error' },
              id: source.functionCall?.id,
            }
          });
        }
        else if (result.content.type === 'image') {
          const [header, data] = result.content.image_uri.split(",");
          const mimeType = header.match(/:(.*?);/)?.[1];

          gemini_message.parts?.push({
            functionResponse: {
              name: source.functionCall?.name || '',
              response: { content: result.content.content || {}},
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
              response: { content: result.content.content },
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

function FormatOpenAIResponsesToolCalls(params: Parameters<GPTResponsesChatMessages>, tool_call_results: ({
    index: number;
    content: ToolHandlerResponseType;
   }|undefined)[]) {

  type M = Exclude<GPTResponsesChatMessages['messages'][number], ClientSideErrorMessage>;
  const messages: M[] = [];

  for (const result of tool_call_results) {
    if (result) {

      // find the source
      const source = params.active_messages?.[result.index];
      if (source?.type === 'function_call') {

        let output: string | OpenAI.Responses.ResponseFunctionCallOutputItemList = '';
        switch (result.content.type) {
          case 'object':
            output = JSON.stringify(result.content.content);
            break;
          
          case 'error':
            output = JSON.stringify(result.content);
            break;
          
          case 'image':
            output = [{
              type: 'input_image',
              image_url: result.content.image_uri,
            }];
            if (result.content.content) {
              output.push({
              type: 'input_text',
              text: JSON.stringify(result.content.content),
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


function FormatAnthropicToolCalls(params: Partial<Parameters<AnthropicChatMessages>>, tool_call_results: ({
    index: number;
    content: ToolHandlerResponseType;
   }|undefined)[]) {

  type M = Exclude<AnthropicChatMessages['messages'][number], ClientSideErrorMessage>;

  const response_content: Exclude<M['content'], string> = [];

  if (params.messages && params.active_message && typeof params.active_message.content !== 'string') {

    for (const result of tool_call_results) {
      if (result) {

        // find the source
        const source = params.active_message.content[result.index];
        if (source.type === 'tool_use') {

          if (result.content.type === 'object') {
            response_content.push({
              type: 'tool_result',
              tool_use_id: source.id,
              content: JSON.stringify(result.content.content),
            });
          }
          else if (result.content.type === 'error') {
            response_content.push({
              type: 'tool_result',
              tool_use_id: source.id,
              content: JSON.stringify(result.content),
            });
          }
          else {
            response_content.push({
              type: 'tool_result',
              tool_use_id: source.id,
              content: GenerateImageBlockContent(result.content),
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
      params.active_message = {
        role: 'model',
        parts: [],

        // do we need an ID here? not sure

      };
      params.current_message_index = messages.messages.length;
      params.message_complete = false;
      messages.messages[params.current_message_index] = params.active_message;
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
              params.active_messages[chunk.output_index] = 
                messages.messages[(params.current_message_index||0) + chunk.output_index] = 
                {
                  ...chunk.item
                };
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

    switch (chunk.type) {
      case 'message_start':

        // {"type": "message_start", "message": 
        //  {"id": "msg_1nZdL29xx5MUA1yADyHTEsnR8uuvGzszyY", 
        //    "type": "message", "role": "assistant", "content": [], 
        //    "model": "claude-opus-4-7", "stop_reason": null, "stop_sequence": null, 
        //    "usage": {"input_tokens": 25, "output_tokens": 1}}}

        params.message_complete = false;
        params.active_message = chunk.message;
        params.current_message_index = messages.messages.length;
        messages.messages[params.current_message_index] = params.active_message;

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

              // ATM skipping citations_delta and signature_delta

              // instead of switching the two types, we could just
              // trust the delta type

              case 'thinking_delta':
                (target as ThinkingBlockParam).thinking += chunk.delta.thinking;
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

        console.info("RX message stop -- stop reason (from prior delta):", params.stop_reason);

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

export function AbortStream() {
  interrupted = true;
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

  for (;;) {

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
            const next_message = FormatGeminiToolCalls(params as Parameters<GeminiChatMessages>, content);
            if (next_message) {
              params.messages.messages.push(next_message);
              continue;
            }
          }
          if (params.messages?.type === 'openai-responses') {
            const responses = FormatOpenAIResponsesToolCalls(params as Parameters<GPTResponsesChatMessages>, content);
            if (responses.length) {
              params.messages.messages.push(...responses);
              continue;
            }
          }
          else if (params.messages?.type === 'anthropic') {
            const next_message = FormatAnthropicToolCalls(params as Parameters<AnthropicChatMessages>, content);
            if (next_message) {
              params.messages.messages.push(next_message);
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
        })
      }
    }
    else {
      console.info("returning on no pending tool calls");
    }

    console.info("reached end of loop");

    return;

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

    let interval_id = 0;
    await new Promise<void>(resolve => {

      interval_id = window.setInterval(() => {
        if (interrupted) {
          messages.messages.push({
            type: 'client-side-error',
            message: 'interrupted',
          });
          resolve();
        }
      }, 250);

      worker.onmessageerror = (event: MessageEvent) => {
        messages.messages.push({
          type: 'client-side-error',
          message: event.data || 'worker error',
        });
        resolve();
      };

      worker.onerror = (event: ErrorEvent) => {
        messages.messages.push({
          type: 'client-side-error',
          message: event.error || 'worker error',
        });
        resolve();
      };

      worker.onmessage = (event: MessageEvent) => {
    
        /*
        // console.info(event);
  
        if (timeout) {

          // we're clearing the timeout when it starts to respond,
          // but is it guaranteed to finish? not sure. at least the 
          // problem we were trying to solve at the time was the service
          // never responding (was deepseek)

          console.info("clearing timeout on first rx");
          window.clearTimeout(timeout);
          timeout = 0;
        }
        */

        const message = event.data as MessageType;
        if (message.type === 'error') {
          messages.messages.push({
            type: 'client-side-error',
            message: message.text || 'unknown error',
          });
          console.info("Calling resolve (1)");
          resolve();
          return;
        }
        else if (message.type === 'complete') {
          console.info("Calling resolve on stream end");
          resolve();
          return;
        }

        message_stack.push(message);
        // current_chunks.push(JSON.parse(JSON.stringify(message)));

        if (!process_timeout) {
          process_timeout = window.setTimeout(() => {
            process_timeout = 0;
            ProcessStack();
            /*
            if (params.message_complete) {
              console.info("Calling resolve (2)");
              resolve();
            }
            */
          }, 100);
        }
    
      };

      worker.postMessage(JSON.parse(JSON.stringify(init_message))); // remove any svelte wrappers

    });

    if (interval_id) {
      window.clearInterval(interval_id);
    }

  }

};



