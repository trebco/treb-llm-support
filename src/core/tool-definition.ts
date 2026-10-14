import * as v from 'valibot';
import { toJsonSchema } from '@valibot/to-json-schema';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { FunctionDeclaration } from '@google/genai';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { FunctionTool, ToolSearchTool } from 'openai/resources/responses/responses';

export type ToolDefinitionOptions = {

  /** 
   * tool requires image support. this is not supported in the legacy 
   * openAI API (chat completions). 
   * 
   * it's apparently not supported by deepseek either, even if you use the 
   * Anthropic API. that's a disappointment.
   */
  requires_image_support: boolean;

  /** tool supports partial application, so we can run while streaming */
  supports_partial_application: boolean;

  /** 
   * priority is used for deferred loading and tool search; we might also
   * use it to limit the toolset for models that don't support tool search
   */
  priority: 'high' | 'low';

};

export type ToolDefinition = {
  name: string;
  schema: v.GenericSchema,
  description: string;
  options?: Partial<ToolDefinitionOptions>;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
};

export function defineTool<
  N extends string,
  S extends v.GenericSchema,
>(
  name: N,
  description: string,
  schema: S,
  options?: Partial<ToolDefinitionOptions>,
): ToolDefinition & { name: N, schema: S } {
  const { $schema, ...jsonSchema } = toJsonSchema(schema);
  return {
    name,
    schema,
    description,
    options,
    input_schema: jsonSchema as ToolDefinition['input_schema'],
  };
}

export function toAnthropicTools(tools: ToolDefinition[], defer = false): Array<Anthropic.Messages.Tool | Anthropic.Messages.ToolSearchToolBm25_20251119> {
  const result: Array<Anthropic.Messages.Tool | Anthropic.Messages.ToolSearchToolBm25_20251119> = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
    ...((defer && tool.options?.priority === 'low') ? { defer_loading: true } : {}),
  }));
  if (defer) {
    result.push({
      type: 'tool_search_tool_bm25_20251119',
      name: 'tool_search_tool_bm25',
    });
  }
  return result;
}

export function toGeminiFunctionDeclarations(tools: ToolDefinition[]): FunctionDeclaration[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.input_schema,
  }));
}

export function toOpenAIChatCompletionTools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools
    .filter(tool => tool.options?.priority !== 'low')
    .map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
}

export function toOpenAIResponsesTools(tools: ToolDefinition[], defer = false): Array<FunctionTool | ToolSearchTool> {
  const result: Array<FunctionTool | ToolSearchTool> = tools.map(tool => {
    const { schema, strict } = prepareForStrictMode(tool.input_schema);
    return {
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: schema,
      strict,
      ...((defer && tool.options?.priority === 'low') ? { defer_loading: true } : {}),
    };
  });
  if (defer) {
    result.push({ type: 'tool_search' });
  }
  return result;
}

/**
 * Prepares a JSON schema for OpenAI strict mode by adding
 * `additionalProperties: false` to all objects and making all properties
 * required (optional ones become nullable). Falls back to strict: false
 * for schemas containing record/map types.
 */
function prepareForStrictMode(
  inputSchema: ToolDefinition['input_schema'],
): { schema: ToolDefinition['input_schema']; strict: boolean } {
  const schema = structuredClone(inputSchema);
  const strict = applyStrictConstraints(schema);
  return { schema, strict };
}

type JsonSchemaNode = Record<string, unknown>;

function isObj(x: unknown): x is JsonSchemaNode {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Mutates `node` in place. Returns false if strict mode is impossible. */
function applyStrictConstraints(node: JsonSchemaNode): boolean {
  // Recurse into anyOf variants
  if (Array.isArray(node.anyOf)) {
    for (const variant of node.anyOf) {
      if (isObj(variant) && !applyStrictConstraints(variant)) return false;
    }
  }

  // Recurse into array items
  if (node.type === 'array' && isObj(node.items)) {
    if (!applyStrictConstraints(node.items)) return false;
  }

  if (node.type !== 'object') return true;

  const props = node.properties;
  if (isObj(props)) {
    // Fixed-shape object: lock down and make all properties required
    const origRequired = new Set(
      Array.isArray(node.required) ? (node.required as string[]) : [],
    );
    node.additionalProperties = false;
    delete node.propertyNames;
    node.required = Object.keys(props);

    for (const [key, propSchema] of Object.entries(props) as [string, JsonSchemaNode][]) {
      if (!origRequired.has(key)) {
        // Wrap optional property as nullable
        const { description, ...rest } = propSchema;
        const wrapped: JsonSchemaNode = {
          anyOf: [rest, { type: 'null' }],
        };
        if (description !== undefined) wrapped.description = description;
        props[key] = wrapped;
        if (!applyStrictConstraints(wrapped)) return false;
      } else {
        if (!applyStrictConstraints(propSchema)) return false;
      }
    }
  } else if (isObj(node.additionalProperties)) {
    // Record/map type — incompatible with strict mode
    return false;
  } else {
    // Object with no properties (e.g. empty object)
    node.additionalProperties = false;
    if (!node.required) node.required = [];
  }

  return true;
}
