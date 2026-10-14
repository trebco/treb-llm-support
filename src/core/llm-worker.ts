
import { StreamAnthropicResponse, StreamGeminiResponse, /* StreamGPTResponse, */ StreamResponsesAPI } from './llm';

import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, GenerateContentResponse as GeminiChunk } from '@google/genai';

import { ResolveProvider, type Model, type Provider } from './models';
import { ToolDefinition } from './tool-definition';
import { TypedChatMessages } from './stream';

const DEFAULT_MAX_TOKENS = 8192;

type Client = Anthropic|OpenAI|GoogleGenAI;

/** 
 * clients are reused across requests while the api, endpoint and key 
 * stay the same 
 */
const clients = new Map<string, Client>();

/** 
 * create (or reuse) the client for a provider. the provider says which 
 * API it speaks and where; see Provider.api and Provider.base_url.
 */
function GetClient(provider: Provider, key: string): Client|undefined {

  const cache_key = JSON.stringify([provider.api, provider.base_url ?? '', key]);
  let client = clients.get(cache_key);
  if (client) {
    return client;
  }

  switch (provider.api) {
    case 'anthropic':
      client = new Anthropic({
        apiKey: key,
        baseURL: provider.base_url,
        dangerouslyAllowBrowser: true,
      });
      break;

    case 'openai-responses':
    case 'openai-chat-completion':
      client = new OpenAI({
        apiKey: key,
        baseURL: provider.base_url,
        dangerouslyAllowBrowser: true,
      });
      break;

    case 'gemini':
      client = new GoogleGenAI({
        apiKey: key,
        httpOptions: provider.base_url ? { baseUrl: provider.base_url } : undefined,
      });
      break;
  }

  if (client) {
    clients.set(cache_key, client);
  }
  return client;

}

export interface InitMessage {
  type: 'init2';
  model: Model;
  messages: TypedChatMessages,
  system_prompt: string;
  key: string;
  temperature?: number;
  thinking_budget?: number;
  tools?: ToolDefinition[];
}


export interface GeminiChunkMessage {
  type: 'gemini-chunk';
  chunk: GeminiChunk;
}

export interface OpenAIChunkMessage {
  type: 'openai-chunk';
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk;
}

export interface OpenAIResponsesChunkMessage {
  type: 'openai-responses-chunk';
  chunk: OpenAI.Responses.ResponseStreamEvent;
}

export interface AnthropicChunkMessage {
  type: 'anthropic-chunk';
  chunk: Anthropic.Messages.RawMessageStreamEvent;
}

export interface CompleteMessage {
  type: 'complete';
}

export interface ErrorMessage {
  type: 'error';
  text?: string;
}

export type MessageType = 
  InitMessage | 
  ErrorMessage | 
  OpenAIChunkMessage | 
  AnthropicChunkMessage | 
  GeminiChunkMessage |
  OpenAIResponsesChunkMessage |
  CompleteMessage ;

const Post = (message: MessageType) => {
  postMessage(message);  
}

const Init = async (message: InitMessage) => {

  const provider = ResolveProvider(message.model.provider);
  const instance = GetClient(provider, message.key);

  // the chat completions API is the "legacy" path, currently not implemented
  const openai_legacy_api = provider.api === 'openai-chat-completion';

  if (!instance) {
    Post({
      type: 'error',
      text: 'invalid instance',
    });
    return;
  }

  try {
    if (instance instanceof OpenAI) {
      if (openai_legacy_api) {

        throw new Error('ENOTIMPL');

        /*
        for await (const chunk of StreamGPTResponse(instance, message.model.name, message.messages, message.system_prompt, message.temperature, DEFAULT_MAX_TOKENS, message.tools)) {
          Post({
            type: 'openai-chunk',
            chunk,
          });
        }
        */
      }
      else {
        if (message.messages.type !== 'openai-responses') {
          throw new Error('invalid message type');
        }
        for await (const chunk of StreamResponsesAPI(instance, message.model.name, message.messages, message.system_prompt, message.temperature, DEFAULT_MAX_TOKENS, message.tools)) {
          Post({
            type: 'openai-responses-chunk',
            chunk,
          });
        }
      }
    }
    else if (instance instanceof GoogleGenAI) {
      if (message.messages.type !== 'gemini') {
        throw new Error('invalid message type');
      }
      for await (const chunk of StreamGeminiResponse(instance, message.model.name, message.messages, message.system_prompt, message.temperature, DEFAULT_MAX_TOKENS, message.tools)) {
        Post({
          type: 'gemini-chunk',
          chunk,
        });
      }
    }
    else {
      if (message.messages.type !== 'anthropic') {
        throw new Error('invalid message type');
      }
      for await (const chunk of StreamAnthropicResponse(instance, message.model.name, message.messages, message.system_prompt, message.temperature, DEFAULT_MAX_TOKENS, message.tools)) {
        Post({
          type: 'anthropic-chunk',
          chunk,
        });
      }
    }
  }
  catch (err) {
    Post({
      type: 'error',
      text: (err instanceof Error) ? err.message : 'Unknown error',
    });
    return;
  }

  Post({
    type: 'complete'
  });

};

onmessage = (event: MessageEvent) => {
  const message = event.data as MessageType;
  switch (message.type) {
    case 'init2':
      Init(message);
      break;
  }
};


