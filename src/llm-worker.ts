
import type { ChatMessage } from './chat-message';
import { StreamAnthropicResponse, StreamGeminiResponse, StreamGPTResponse } from './llm';

import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, GenerateContentResponse as GeminiChunk } from '@google/genai';

import type { Model } from './models';
import { ToolDefinition } from './tool-schema';

const DEFAULT_MAX_TOKENS = 8192;

let kimi: OpenAI|undefined;
let deepseek: OpenAI|undefined;
let openai: OpenAI|undefined;
let anthropic: Anthropic|undefined;
let together: OpenAI|undefined;
let openrouter: OpenAI|undefined;
let gemini: GoogleGenAI|undefined;

export interface InitMessage {
  type: 'init';
  model: Model;
  messages: ChatMessage[];
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
  CompleteMessage ;

const Post = (message: MessageType) => {
  postMessage(message);  
}

const Init = async (message: InitMessage) => {

  let instance: Anthropic|OpenAI|GoogleGenAI|undefined;

  switch (message.model.provider.name) {
    case 'Anthropic':
      if (!anthropic || anthropic.apiKey !== message.key) {
        anthropic = new Anthropic({
          apiKey: message.key,
          dangerouslyAllowBrowser: true,
        });
      }
      instance = anthropic;
      break;

    case 'Together':
      if (!together || together.apiKey !== message.key) {
        together = new OpenAI({
          apiKey: message.key,
          baseURL: "https://api.together.xyz/v1",
          dangerouslyAllowBrowser: true,
        });
      }
      instance = together;
      break;

    case 'OpenRouter':
      if (!openrouter || openrouter.apiKey !== message.key) {
        openrouter = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: message.key,
          dangerouslyAllowBrowser: true,
        });
      }
      instance = openrouter;
      break;

    case 'Kimi':
      if (!kimi || kimi.apiKey !== message.key) {
        kimi = new OpenAI({
          apiKey: message.key,
          baseURL: 'https://api.moonshot.ai',
          dangerouslyAllowBrowser: true,
        });
      }
      instance = kimi;
      break;

    case 'Deepseek':
      if (!deepseek || deepseek.apiKey !== message.key) {
        deepseek = new OpenAI({
          apiKey: message.key,
          baseURL: 'https://api.deepseek.com',
          dangerouslyAllowBrowser: true,
        });
      }
      instance = deepseek;
      break;

    case 'OpenAI':
      if (!openai || openai.apiKey !== message.key) {
        openai = new OpenAI({
          apiKey: message.key,
          dangerouslyAllowBrowser: true,
        });
      }
      instance = openai;
      break;

    case 'Gemini': // old name
    case 'Google':
      if (!gemini) {
        gemini = new GoogleGenAI({
          apiKey: message.key,
        });
      }
      instance = gemini;
      break;


  }

  if (!instance) {
    Post({
      type: 'error',
      text: 'invalid instance',
    });
    return;
  }

  try {
    if (instance instanceof OpenAI) {
      for await (const chunk of StreamGPTResponse(instance, message.model.name, message.messages, message.system_prompt, message.temperature, DEFAULT_MAX_TOKENS, message.tools)) {
        Post({
          type: 'openai-chunk',
          chunk,
        });
      }
    }
    else if (instance instanceof GoogleGenAI) {
      for await (const chunk of StreamGeminiResponse(instance, message.model.name, message.messages, message.system_prompt, message.temperature, DEFAULT_MAX_TOKENS, message.tools)) {
        Post({
          type: 'gemini-chunk',
          chunk,
        });
      }
    }
    else {
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
    case 'init':
      Init(message);
      break;
  }
};


