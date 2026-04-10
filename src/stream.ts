

import type { Model } from './models';
import type { ChatMessage } from './chat-message';
import type { InitMessage, MessageType } from './llm-worker';
import { ParseSegmentAnthropic, ParseSegmentGemini, ParseSegmentGPT, ParseSegmentResponses, type NewSegmentOpts } from './segment-parser';
import { ToolDefinition } from './tool-schema';

interface Params {
  model: Model;
  messages: ChatMessage[];
  system_prompt: string;
  api_key: string;
  worker: Worker;
  tools?: ToolDefinition[];
  timeout?: number;
}

// dev [todo: flag]
const chunks: unknown[][] = [];
let current_chunk: unknown[] = [];
if (typeof self !== 'undefined') {
  (self as any).chunks = chunks;
}

export const Stream = async (params: Params) => {

  if (!params.api_key) {
    throw new Error('Missing API key');
  }

  if (!params.model) {
    throw new Error('Invalid model');
  }
        
  const message: InitMessage = {
    type: 'init',
    key: params.api_key,
    // temperature,
    // thinking_budget,
    messages: params.messages,
    system_prompt: params.system_prompt,
    model: params.model,
    tools: params.tools,
  };
  
  if (params.worker) {

    current_chunk = [];
    chunks.push(current_chunk);

    /*
    const Timeout = () => {
      Promise.resolve().then(() => {
        throw new Error('Model service timed out');
      });
    };
    */
    
    const opts: NewSegmentOpts = {
      model_name: params.model.name,
      messages: params.messages,
    };

    const worker_instance = params.worker;
     
    let message_stack: MessageType[] = [];
    let process_timeout = 0;
    let complete = false;

    const ProcessStack = () => {
      const temp = [...message_stack];
      message_stack = [];
      for (const message of temp) {
        switch (message?.type) {
          case 'openai-responses-chunk':
            complete = complete || ParseSegmentResponses(opts, [JSON.stringify(message.chunk)]);
            break;

          case 'openai-chunk':
            complete = complete || ParseSegmentGPT(opts, [JSON.stringify(message.chunk)]);
            break;

          case 'gemini-chunk':
            complete = complete || ParseSegmentGemini(opts, [JSON.stringify(message.chunk)]);
            break;

          case 'anthropic-chunk':
            complete = complete || ParseSegmentAnthropic(opts, [JSON.stringify(message.chunk)]);
            break;
          }
        }
      };

      await new Promise<void>(resolve => {

        worker_instance.onmessage = (event: MessageEvent) => {
      
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
            params.messages.push({
              uuid: crypto.randomUUID(),
              role: 'error',
              message: message.text || 'Unknown error',
            });
            resolve();
            return;
          }
          
          message_stack.push(message);
          current_chunk.push(JSON.parse(JSON.stringify(message)));

          if (!process_timeout) {
            process_timeout = window.setTimeout(() => {
              process_timeout = 0;
              ProcessStack();
              if (complete) {
                resolve();
              }
            }, 100);
          }
      
        };

        worker_instance.postMessage(JSON.parse(JSON.stringify(message))); // remove any svelte wrappers

      });
    }
    else {
      throw new Error('worker not initialized');
    }

};
    
