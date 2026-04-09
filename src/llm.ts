
import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI, type GenerateContentParameters, type Content as GeminiContent } from '@google/genai';
import type { AssistantChatMessage, ChatMessage, UserChatMessage } from './chat-message';
import { ToolDefinition, toGeminiFunctionDeclarations, toOpenAIChatCompletionTools } from './tool-schema';

/** 
 * Anthropic style stream 
 * 
 * needs to be decoded client-side.
 */
export async function* StreamAnthropicResponse(instance: Anthropic, model: string, messages: ChatMessage[], system: string, temperature: number|undefined, max_tokens: number, tools?: ToolDefinition[]) {

  // remove system and error messages. we added a "name" field to
  // tool responses for gemini, claude will complain if it sees that
  // so remove if before sending

  const filtered = messages.filter(test => test.role === 'assistant' || test.role === 'user').map(message => {
    if (message.role === 'user') {  
      let content = message.content as Anthropic.ToolResultBlockParam[];
      if (Array.isArray(content)) {
        content = content.map(entry => ({
          tool_use_id: entry.tool_use_id,
          type: entry.type,
          content: entry.content,
        }));
      }
      return {
        role: message.role,
        content,
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });

  const stream = await instance.messages.create({
    tools,
    model,
    max_tokens,
    messages: filtered,
    system,
    temperature,
    stream: true,
    cache_control: {
      type: 'ephemeral',
    }
  });

  // let counter = 0;

  for await (const chunk of stream) {
    // console.info("anthropic-chunk", counter++, JSON.stringify(chunk, undefined, 2));
    yield chunk;
  }

};

export async function* StreamGPTResponse(instance: OpenAI, model: string, messages: ChatMessage[], system: string, temperature: number|undefined, max_tokens: number, tools?: ToolDefinition[]) {

  const openai_messages: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming['messages'] = [];

  // const openai_messages: { role: 'system'|'user'|'assistant', content: string }[] = [];
  
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
          openai_messages.push({
            role: 'tool',
            tool_call_id: part.tool_use_id,
            content: part.content,
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

  /*
  const filtered = messages.filter(test => test.role === 'assistant' || test.role === 'user');
  openai_messages.push(...filtered.map(message => ({ 
    role: message.role, 
    content: message.text,
  })));
  */

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


export async function* StreamGeminiResponse(instance: GoogleGenAI, model: string, messages: ChatMessage[], system: string, temperature: number|undefined, max_tokens: number, tools?: ToolDefinition[]) {

  const filtered = messages.filter(test => test.role === 'assistant' || test.role === 'user');

  const gemini_messages: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        gemini_messages.push({
          role: 'user',
          parts: [{
            text: message.content,
          }],
        });
      }
      else {
        const gemini_message: GeminiContent = {
          role: 'user',
          parts: [],
        };
        for (const part of message.content) {

          // tbis is backwards, but TOOD: stop stringifying content,
          // we can stringify for claude when we send it

          let structured_content: any = part.content;
          try {
            structured_content = JSON.parse(part.content);
          }
          catch {
            // ...
          }

          gemini_message.parts?.push({
            functionResponse: {
              name: part.name,
              response: { content: structured_content },
            }
          })
        }
        gemini_messages.push(gemini_message);
      }
    }
    else if (message.role === 'assistant') {
      gemini_messages.push({
        role: 'model',
        parts: message.content.map(part => {
          if (part.type === 'tool_use') {
            return {
              functionCall: {
                name: part.name,
                args: part.input,
              },
              thoughtSignature: part.thoughtSignature,
            }
          }
          else { // if (part.type === 'text') {
            return {
              text: part.text,
              thoughtSignature: part.thoughtSignature,
            };
          }
        }),
      });
    }
  }

  // console.info("GM", {gemini_messages});

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
    contents: gemini_messages, 
  };

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
    // console.info("GEMINI CHUNK", JSON.stringify(chunk, undefined, 2));
    yield chunk; // JSON.stringify(chunk);
  }

};

