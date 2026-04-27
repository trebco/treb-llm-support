
import type { ToolHandlerResponseType } from './tool-handlers';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolCallContent {
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
