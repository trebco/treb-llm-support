
import type { AssistantChatMessage, ChatMessage } from './chat-message';
import type { SegmentParser, SegmentOpts, SegmentMetadata } from './types';
import { Anthropic } from '@anthropic-ai/sdk';
import { GenerateContentResponse as GeminiResponseChunk } from '@google/genai';
import OpenAI from 'openai';


export interface NewSegmentOpts {
  model_name: string;
  messages: ChatMessage[];
  current_message_index?: number;
}

export type NewSegmentParser = (opts: NewSegmentOpts, json: string[]) => boolean; // SegmentMetadata|void;

export const ParseSegmentResponses: NewSegmentParser = (opts: NewSegmentOpts, json: string[]) => {

  let complete = false;

  if (json.length) {
    const chunk = JSON.parse(json.join('')) as OpenAI.Responses.ResponseStreamEvent;

    // console.info({chunk});

    switch (chunk.type) {
      case 'response.created':
        opts.current_message_index = opts.messages.length;
        opts.messages[opts.current_message_index] = {
          uuid: crypto.randomUUID(),
          role: 'assistant',
          content: [],
          generator: chunk.response.model,
        };
        break;

      // here we're only using the last message, containing the 
      // full data. for some tools (specifically set_cells) we 
      // could support intermediate/partial processing. TODO.

      case 'response.output_item.done':
        if (typeof opts.current_message_index === 'number') {
          const message = opts.messages[opts.current_message_index] as AssistantChatMessage;
          if (chunk.item.type === 'function_call') {
            message.content.push({
              type: 'tool_use',
              id: chunk.item.id || '',
              call_id: chunk.item.call_id,
              name: chunk.item.name || '',
              input: chunk.item.arguments || '',
            });
          }
        }

        break;

      /*
      case 'response.function_call_arguments.done':
        break;

      case 'response.function_call_arguments.delta':
        break;

      case 'response.output_item.added':
        if (typeof opts.current_message_index === 'number') {
          const message = opts.messages[opts.current_message_index] as AssistantChatMessage;
          if (chunk.item.type === 'function_call') {

            // create a new tool call entry
            message.content.push({
              type: 'tool_use',
              id: chunk.item.id || '',
              call_id: chunk.item.call_id,
              name: chunk.item.name || '',
              input: chunk.item.arguments || '',
            })

          }
          else {
            console.info("OTHER TYPE", chunk.item.type);
          }
        }
        break;
      */

      case 'error':
        if (typeof opts.current_message_index === 'number') {
          const message = opts.messages[opts.current_message_index] as AssistantChatMessage;
          message.complete = true;
        }
        else {
          opts.messages.push({
            uuid: crypto.randomUUID(),
            role: 'error',
            message: chunk.message,
          });
        }
        complete = true;
        break;

      case 'response.completed':
        if (typeof opts.current_message_index === 'number') {
          const message = opts.messages[opts.current_message_index] as AssistantChatMessage;
          message.complete = true;
          complete = true;
        }
        break;

      case 'response.output_text.delta':
        if (typeof opts.current_message_index === 'number') {
          const message = opts.messages[opts.current_message_index] as AssistantChatMessage;
          let inserted = false;
          for (const part of message.content) {
            if (part.type === 'text') {
              part.text += chunk.delta;
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            message.content.push({
              type: 'text',
              text: chunk.delta,
            });
          }
        }
        break;
    }

  }

  return complete;

};

export const ParseSegmentGPT: NewSegmentParser = (opts: NewSegmentOpts, json: string[]) => {

  let complete = false;

  if (json.length) {
    const chunk = JSON.parse(json.join('')) as OpenAI.Chat.Completions.ChatCompletionChunk; 
    //console.info("GPT CHUNK ID", chunk.id);
    
    // for now let's just use choice[0]
    const choice = chunk.choices[0];

    if (typeof opts.current_message_index !== 'number') {
      opts.current_message_index = opts.messages.length;
      opts.messages[opts.current_message_index] = {
        uuid: crypto.randomUUID(),
        role: 'assistant',
        content: [],
        generator: chunk.model,
      };
    }

    const message = opts.messages[opts.current_message_index] as AssistantChatMessage;

    /*
    if (choice.delta.tool_calls) {
      console.info('tool calls, role?', choice.delta.role, {choice})
    }
    else if (choice.delta.content) {
      console.info('content, role?', choice.delta.role, {choice})
    }
    else if ((choice.delta as any).reasoning) {
      console.info('reasoning, role?', choice.delta.role, {choice})
    }
    */
    if ((choice.delta as any).reasoning) {
      console.info('reasoning, role?', choice.delta.role, {choice})
    }

    // if there is content and tool calling, then content probably 
    // comes first, but not necessarily... and there's only ever one
    // (text) content block

    if (choice.delta.content) {
      let inserted = false;
      for (const part of message.content) {
        if (part.type === 'text') {
          part.text += choice.delta.content;
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        message.content.push({
          type: 'text',
          text: choice.delta.content,
        });
      }
    }
    else if (choice.delta.tool_calls) {
      for (const entry of choice.delta.tool_calls) {

        // append to the nth tool call (create if necessary)
        let found = false;
        let tool_call_index = 0;
        for (const compare of message.content) {
          if (compare.type === 'tool_use') {
            if (tool_call_index === entry.index) {
              compare.input += (entry.function?.arguments || '');
              found = true;
              break;
            }
            tool_call_index++;
          }
        }

        if (!found) {
          // create new one (hopefully index matches up!)
          message.content.push({
            type: 'tool_use',
            name: entry.function?.name || '',
            input: entry.function?.arguments || '',
            id: entry.id || '',
          });
        }

      }
    }
    
    if (choice.finish_reason) {
      message.complete = true;
      complete = true;
    }

  }

  return complete;

};

export const ParseSegmentGemini: NewSegmentParser = (opts: NewSegmentOpts, json: string[]) => {

  let complete = false;

  if (json.length) {
    const chunk = JSON.parse(json.join('')) as GeminiResponseChunk;

    if (typeof opts.current_message_index !== 'number') {

      // create message
      opts.current_message_index = opts.messages.length;
      opts.messages[opts.current_message_index] = {
        uuid: crypto.randomUUID(),
        role: 'assistant',
        content: [],  
        generator: opts.model_name,
      };

    }

    const message = opts.messages[opts.current_message_index] as AssistantChatMessage;

    // console.info("Gemini chunk", chunk);

    // OK for now let's just use candidate 0

    const candidate = chunk.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const [index, part] of candidate.content.parts.entries()) {
        if (part.text) {

          if (message.content[index]) {

            // concatenate
            if (message.content[index].type !== 'text') {
              console.warn(`incorrect content type @ index ${index}: message.content[index].type`);
            }
            else {
              message.content[index].text += part.text;
            }
          }
          else {

            // new text part

            message.content[index] = {
              type: 'text', 
              text: part.text,
              thoughtSignature: part.thoughtSignature,
            };
          }
          
        }
        if (part.functionCall) {

          if (message.content[index]) {
            if (message.content[index].type !== 'tool_use') {
              console.warn(`incorrect content type @ index ${index}: message.content[index].type`);
            }
            else {
              if (part.functionCall.willContinue) {

                // apparently this accumulates? 

                // message.content[index].input += (part.functionCall.partialArgs || '');
                message.content[index].input = (part.functionCall.partialArgs || '');
              }
              else {
                message.content[index].input = part.functionCall.args;
              }
            }
          }
          else {

            // new function call part

            message.content[index] = {
              type: 'tool_use',
              name: part.functionCall.name || '', 
              id: part.functionCall.id || '', // FIXME: this is not going to work if you switch to claude
              input: part.functionCall.willContinue ? part.functionCall.partialArgs : (part.functionCall.args || ''),
              thoughtSignature: part.thoughtSignature,
            }
          }

        }
      }
    }

    if (candidate?.finishReason === 'STOP') {
      // console.info("GEMINI MESSAGE COMPLETE");
      message.complete = true;
      complete = true;
    }
    
  }

  return complete;

};

/**
 * OK so we only ever create one message, but it can have
 * multiple content parts.
 */
export const ParseSegmentAnthropic: NewSegmentParser = (opts: NewSegmentOpts, json: string[]) => {

  let complete = false;

  // console.info("PSA");

  if (json.length) {

    // console.info(JSON.stringify(json, undefined, 2));

    // try {
      const chunk = JSON.parse(json.join('')) as Anthropic.Messages.RawMessageStreamEvent;
      let message = typeof opts.current_message_index === 'number' ? opts.messages[opts.current_message_index] as AssistantChatMessage : undefined;

      switch (chunk.type) {

        case 'message_stop':

          if (!message) {
            throw new Error('message stop with no current message');
          }

          message.complete = true;
          complete = true;
          message = undefined;
          opts.current_message_index = undefined;

          break;

        case 'content_block_start':
          // console.info(`(content block start #${chunk.index})`);

          if (!message) {
            throw new Error('content block start with no current message');
          }

          switch (chunk.content_block.type) {
            case 'text':
              message.content[chunk.index] = {
                type: 'text',
                text: '',
              };
              break;

            case 'tool_use':
              message.content[chunk.index] = {
                type: 'tool_use',
                input: '',
                name: chunk.content_block.name,
                id: chunk.content_block.id,
              };
              break;

            default:
              console.info("unexpected content block type", chunk.content_block.type);
              break;
          }

          break;

        case 'content_block_stop':
          // console.info(`(content block stop #${chunk.index})`);
          break;

        case 'message_start':
          // console.info(`(message start #${chunk.message.id})`);
          // AddTokens(config.model, chunk.message.usage.input_tokens || 0, chunk.message.usage.output_tokens || 0);

          message = {
            uuid: crypto.randomUUID(),
            role: 'assistant',
            content: [],
            generator: opts.model_name || 'unknown model',
          };

          opts.current_message_index = opts.messages.length;
          opts.messages[opts.current_message_index] = message;

          break;

        case 'message_delta':
          // console.info('(message delta)');
          // AddTokens(config.model, 0, chunk.usage.output_tokens || 0);
          break;

        case 'content_block_delta':
          //console.info(`(content block delta block ${chunk.index})`);
          if (!message) {
            throw new Error('content block delta without message');
          }

          if (chunk.delta.type === 'text_delta') {

            const text = (chunk.delta.text || '');
            const block = message.content[chunk.index];

            if (block?.type === 'text') {
              block.text += text;
            }
            else {
              console.info("Incorrect block type [1]?", {message, block, chunk});
            }

          }
          else if (chunk.delta.type === 'input_json_delta') {

            const json = (chunk.delta.partial_json || '');
            const block = message.content[chunk.index];

            if (block?.type === 'tool_use') {
              block.input += json;
            }
            else {
              console.info("Incorrect block type [2]?", {message, block, chunk});
            }

            // console.info("(CBD)", block.type === 'tool_use' ? block.input : '...');

          }
          break;

      }

    //}
    //catch (err) {
    //  console.error(err);
    //}
    
  }

  return complete;

};
