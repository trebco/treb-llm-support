
import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, type GenerateContentParameters, type Content as GeminiContent } from '@google/genai';
import { ToolDefinition, toAnthropicTools, toGeminiFunctionDeclarations, toOpenAIChatCompletionTools, toOpenAIResponsesTools } from './tool-schema';
import { ToolHandlerImageResponseType, ToolHandlerResponseType } from './tool-handlers';
import { AnthropicChatMessages, ClientSideErrorMessage, GeminiChatMessages, GPTResponsesChatMessages, IsClientSideErrorMessage, IsNotClientSideErrorMessage } from './stream';
import { MessageParam } from '@anthropic-ai/sdk/resources';

/** helper function */
function GenerateImageBlockContent(result: ToolHandlerImageResponseType): Anthropic.ToolResultBlockParam['content'] {
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

/** 
 * Anthropic style stream 
 * 
 * needs to be decoded client-side.
 */
export async function* StreamAnthropicResponse(
    instance: Anthropic, 
    model: string, 
    // messages: ChatMessage[], 
    messages: AnthropicChatMessages,
    system: string, 
    temperature: number|undefined, 
    max_tokens: number, 
    tools?: ToolDefinition[]) {

  const filtered = messages.messages.filter(IsNotClientSideErrorMessage);

  const stream = await instance.messages.create({
    tools: tools ? toAnthropicTools(tools) : undefined,
    model,
    max_tokens,
    messages: filtered.map(message => ({
      content: message.content,
      role: message.role,
    })),
    system,
    temperature,
    stream: true,
    cache_control: {
      type: 'ephemeral',
    }
  });

  for await (const chunk of stream) {
    yield chunk;
  }

};

/**
 * for the time being, we'll use store:true (the default), although
 * I'm a little edgy about that
 */
export async function* StreamResponsesAPI(instance: OpenAI, model: string, messages: GPTResponsesChatMessages, system: string, temperature: number|undefined, max_tokens: number, tools?: ToolDefinition[]) {

  const filtered = messages.messages.filter(IsNotClientSideErrorMessage);
  // console.info({filtered});

  const response = await instance.responses.create({
    model,
    input: filtered,
    stream: true,
    instructions: system,
    tools: tools ? toOpenAIResponsesTools(tools) : undefined,
    // TODO: reasoning level
  });

  for await (const chunk of response) {
    yield chunk;
  }

}

/* *
 * this is the "legacy" OpenAI API, using the chat completions API.
 * it does not support tool calls returning images, so we need to 
 * filter out the screenshot tool.
 * /
export async function* StreamGPTResponse(instance: OpenAI, model: string, messages: ChatMessage[], system: string, temperature: number|undefined, max_tokens: number, tools?: ToolDefinition[]) {

  const openai_messages: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming['messages'] = [];

  // filter tools
  tools = tools?.filter(test => !test.options?.requires_image_support);
 
  if (system) {
    openai_messages.push({role: 'system', content: system});
  }

  for (const message of messages) {
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        openai_messages.push({
          role: 'user',
          content: message.content,
        });
      }
      else {
        for (const part of message.content) {

          if (part.content.type === 'error') {
            continue;
          }

          if (part.content.type === 'image') {
            console.warn('image type not supported in chat completions API');
            continue;
          }

          openai_messages.push({
            role: 'tool',
            tool_call_id: part.tool_use_id,
            content: JSON.stringify(part.content.content),
          });
        }
      }
    }
    else if (message.role === 'assistant') {

      const parts: OpenAI.ChatCompletionContentPartText[] = [];
      const tool_calls: OpenAI.ChatCompletionMessageToolCall[] = [];

      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({
            type: 'text', 
            text: part.text,
          });
        }
        else if (part.type === 'tool_use') {
          tool_calls.push({
            id: part.id,
            type: 'function',
            function: {
              name: part.name,
              arguments: JSON.stringify(part.input),
            },
          });
        }
      }

      if (parts.length || tool_calls.length) {
        openai_messages.push({
          role: 'assistant',
          content: parts.length ? parts : undefined,
          tool_calls: tool_calls.length ? tool_calls : undefined,
        });
      }

    }
  }

  // console.info({openai_messages});

  / *
  const filtered = messages.filter(test => test.role === 'assistant' || test.role === 'user');
  openai_messages.push(...filtered.map(message => ({ 
    role: message.role, 
    content: message.text,
  })));
  * /

  const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model,
    max_tokens,
    messages: openai_messages,
    temperature,
    stream: true,
    stream_options: {
      include_usage: true,
    },

    tools: tools ? toOpenAIChatCompletionTools(tools) : undefined,

    // ...extra_parameters,

  };

  const stream = await instance.chat.completions.create(options);

  for await (const chunk of stream) {
    // console.info({chunk});
    yield chunk;
  }


}
*/

export async function* StreamGeminiResponse(
    instance: GoogleGenAI, 
    model: string, 
    // messages: ChatMessage[], 
    messages: GeminiChatMessages,
    system: string, 
    temperature: number|undefined, 
    max_tokens: number, 
    tools?: ToolDefinition[]) {


  const filtered = messages.messages.filter(IsNotClientSideErrorMessage);

  // console.info("GM", {filtered});

  const params: GenerateContentParameters = {
    model,
    config: {
      temperature,
      maxOutputTokens: max_tokens,
      systemInstruction: {
        text: system,
      },
      toolConfig: {
        /*

        "in the vertex API but not in the genai API. because reasons."

        functionCallingConfig: {
          streamFunctionCallArguments: true 
        },
        */
      },
      tools: tools ? [{
        functionDeclarations: toGeminiFunctionDeclarations(tools),
      }] : undefined,
    },
    contents: filtered, 
  };

  // console.info({params});

  /*
  if (typeof thinking_budget === 'number') {
    if (params.config) {
      params.config.thinkingConfig = {
        thinkingBudget: thinking_budget,
      }
    }
  }
  */

  const stream = await instance.models.generateContentStream(params);

  for await (const chunk of stream) {
    yield chunk;
  }

};

