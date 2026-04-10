
import type { ToolHandlerResponseType } from './tool-handlers';

export interface GeminiOptionalContent {
  /** gemini-specific field */
  thoughtSignature?: string;
}

export interface TextContent extends GeminiOptionalContent {
  type: 'text';
  text: string;
}

export interface ToolCallContent extends GeminiOptionalContent {
  type: 'tool_use';
  input: any;
  name: string;
  id: string;

  // special for responses API
  call_id?: string;

}

export interface ToolResultContent {
  type: 'tool_result';

  /** gemini needs to echo the name back */
  name: string;

  tool_use_id: string;
  call_id?: string;
  content: ToolHandlerResponseType;
}

export type AssistantChatMessage = {
  uuid: string;
  role: 'assistant';
  content: (TextContent|ToolCallContent)[];
  complete?: boolean;
  tool_calls_processed?: boolean;
  generator: string;
}

export type UserChatMessage = {
  uuid: string;
  role: 'user';
  content: string|ToolResultContent[];
}

export type ErrorChatMessage = {
  uuid: string;
  role: 'error';
  message?: string;
};

export type ChatMessage = UserChatMessage | AssistantChatMessage | ErrorChatMessage;
