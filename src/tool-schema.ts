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

// --- Schemas ---

const GetCellsSchema = v.object({
  reference: v.pipe(
    v.union([
      v.string(),
      v.array(v.string()),
    ]),
    v.description('Cell or range reference (e.g. "A1", "B2:D5", "Sheet1!A1"), or an array of references to fetch multiple ranges at once.'),
  ),
  values: v.optional(
    v.pipe(
      v.boolean(),
      v.description(
        'Include computed cell values in the result. Defaults to true.',
      ),
    ),
  ),
  formulas: v.optional(
    v.pipe(
      v.boolean(),
      v.description(
        'Include cell formulas in A1 notation (or the value if no formula). Defaults to false.',
      ),
    ),
  ),
  formatted: v.optional(
    v.pipe(
      v.boolean(),
      v.description(
        'Include display strings with number formatting applied (e.g. "$1,234.56", "Mar 9, 2026"). Defaults to false.',
      ),
    ),
  ),
});

const CellValue = v.union([v.string(), v.number(), v.boolean()]);

const ListSheetsSchema = v.object({});

const ActivateSheetSchema = v.object({
  name: v.pipe(
    v.string(),
    v.description('Name of the sheet to activate.'),
  ),
});

const AddSheetSchema = v.object({
  name: v.optional(
    v.pipe(
      v.string(),
      v.description(
        'Name for the new sheet. If omitted, uses a default name (e.g. "Sheet2").',
      ),
    ),
  ),
});

// --- Style helpers ---

const ColorString = v.optional(
  v.pipe(
    v.string(),
    v.description(
      'Color as a string: HTML color (e.g. "#ff0000", "red"), theme color prefixed with "theme:" (e.g. "theme:Accent", "theme:Text2"), or empty string to clear.',
    ),
  ),
);

const FontSizeString = v.optional(
  v.pipe(
    v.string(),
    v.description(
      'Font size using relative units only: e.g. "1.2em", "120%". Absolute units (pt, px) are not allowed.',
    ),
  ),
);

const StyleObject = v.object({
  bold: v.optional(v.pipe(v.boolean(), v.description('Bold text.'))),
  italic: v.optional(v.pipe(v.boolean(), v.description('Italic text.'))),
  underline: v.optional(v.pipe(v.boolean(), v.description('Underline text.'))),
  strike: v.optional(
    v.pipe(v.boolean(), v.description('Strikethrough text.')),
  ),
  font_size: FontSizeString,
  text_color: ColorString,
  fill_color: ColorString,
  horizontal_align: v.optional(
    v.pipe(
      v.picklist(['', 'left', 'center', 'right']),
      v.description(
        'Horizontal alignment. Empty string resets to default (left).',
      ),
    ),
  ),
  vertical_align: v.optional(
    v.pipe(
      v.picklist(['', 'top', 'bottom', 'middle']),
      v.description(
        'Vertical alignment. Empty string resets to default (bottom).',
      ),
    ),
  ),
  number_format: v.optional(
    v.pipe(
      v.string(),
      v.description(
        'Number format string, e.g. "General", "0.00", "#,##0", "0%", "yyyy-mm-dd".',
      ),
    ),
  ),
  wrap: v.optional(v.pipe(v.boolean(), v.description('Wrap text in cell.'))),
  indent: v.optional(
    v.pipe(v.number(), v.description('Text indent level.')),
  ),
  locked: v.optional(
    v.pipe(v.boolean(), v.description('Lock cell for editing.')),
  ),
});

const GetStyleSchema = v.object({
  reference: v.pipe(
    v.string(),
    v.description(
      'Cell or range reference (e.g. "A1", "B2:D5", "Sheet1!A1").',
    ),
  ),
});

const BorderOptions = v.object({
  borders: v.pipe(
    v.picklist(['none', 'all', 'outside', 'top', 'bottom', 'left', 'right']),
    v.description('Which borders to apply.'),
  ),
  width: v.optional(
    v.pipe(v.number(), v.description('Border width. Defaults to 1.')),
  ),
});

// --- SetCells schema (values + styles + borders) ---

const CellValueRecord = v.record(
  v.pipe(v.string(), v.description('Cell or range reference (e.g. "A1", "B2:D5", "Sheet1!A1")')),
  v.union([v.string(), v.number(), v.boolean(), v.array(v.array(CellValue))]),
);

const StyleRecord = v.record(
  v.pipe(v.string(), v.description('Cell or range reference (e.g. "A1", "B2:D5", "Sheet1!A1")')),
  StyleObject,
);

const BorderRecord = v.record(
  v.pipe(v.string(), v.description('Cell or range reference (e.g. "A1", "B2:D5", "Sheet1!A1")')),
  BorderOptions,
);

const SetCellsSchema = v.object({
  values: v.optional(v.pipe(
    CellValueRecord,
    v.description('Cell values to set. Keys are references, values are strings, numbers, booleans, or 2D arrays. Strings starting with "=" are formulas.'),
  )),
  styles: v.optional(v.pipe(
    StyleRecord,
    v.description('Cell styles to apply (delta). Keys are references, values are style objects. Only included properties are changed.'),
  )),
  borders: v.optional(v.pipe(
    BorderRecord,
    v.description('Cell borders to apply. Keys are references, values are border options.'),
  )),
  auto_resize_columns: v.optional(v.pipe(
    v.array(v.string()),
    v.description('Column labels to auto-resize to fit content after applying changes (e.g. ["A", "B", "AA"]).'),
  )),
});

// --- Spreadsheet overview schema ---

const GetSpreadsheetSchema = v.object({
  sheets: v.optional(
    v.pipe(
      v.array(v.string()),
      v.description(
        'Sheet names to include. If omitted, returns all sheets.',
      ),
    ),
  ),
});

const SelectSchema = v.object({
  reference: v.pipe(
    v.string(),
    v.description('Sheet-qualified cell or range reference to select (e.g. "Sheet1!A1", "Sheet1!B2:D5"). Always include the sheet name to ensure the correct sheet is selected, as the user may change the active sheet at any time.'),
  ),
});

const GetSelectionSchema = v.object({});

const GetScreenshotSchema = v.object({});

const RenameSheetSchema = v.object({
  name: v.pipe(v.string(), v.description('Current name of the sheet to rename.')),
  new_name: v.pipe(v.string(), v.description('New name for the sheet.')),
});

const DeleteSheetSchema = v.object({
  name: v.pipe(v.string(), v.description('Name of the sheet to delete.')),
});

const MergeCellsSchema = v.object({
  reference: v.pipe(v.string(), v.description('Range reference to merge (e.g. "A1:C1", "Sheet1!A1:A5").')),
});

const UnmergeCellsSchema = v.object({
  reference: v.pipe(v.string(), v.description('Range reference to unmerge (e.g. "A1:C1", "Sheet1!A1:A5").')),
});

const ChartSeriesSchema = v.object({
  values: v.pipe(
    v.string(),
    v.description('Cell range reference for the data values (e.g. "B1:B10", "Sheet1!B1:B10").'),
  ),
  labels: v.optional(
    v.pipe(
      v.string(),
      v.description('Cell range reference for category/axis labels (e.g. "A1:A10"). If omitted in a multi-series chart, inherits the labels from the first series that defines them.'),
    ),
  ),
  title: v.optional(
    v.pipe(
      v.string(),
      v.description('Series name, shown in the chart legend.'),
    ),
  ),
});

const AddChartSchema = v.object({
  chart_type: v.pipe(
    v.picklist(['line', 'column', 'bar', 'scatter', 'donut', 'area']),
    v.description('The type of chart to create.'),
  ),
  series: v.pipe(
    v.union([
      ChartSeriesSchema,
      v.array(ChartSeriesSchema),
    ]),
    v.description('One or more data series. A single series object or an array of series objects.'),
  ),
  title: v.optional(
    v.pipe(
      v.string(),
      v.description('Chart title displayed above the chart.'),
    ),
  ),
  position: v.optional(
    v.pipe(
      v.string(),
      v.description('Range reference for chart placement (e.g. "E1:J15"). The chart fills the area from the top-left of the first cell to the bottom-right of the last cell. If omitted, the chart is auto-placed.'),
    ),
  ),
});

const EvaluateSchema = v.object({
  expression: v.pipe(
    v.string(),
    v.description('Spreadsheet formula to evaluate (e.g. "=SUM(A1:A10)", "=VLOOKUP(...)"). Use sheet names in cell references to avoid ambiguity.'),
  ),
});

const UpdateLayoutSchema = v.object({
  action: v.pipe(
    v.picklist([
      'insert_rows', 'insert_columns', 'delete_rows', 'delete_columns',
      'set_column_width', 'set_row_height',
    ]),
    v.description('The operation to perform.'),
  ),
  index: v.pipe(
    v.union([v.number(), v.array(v.number())]),
    v.description(
      '1-based row or column index, or an array of indices. '
      + 'For inserts, new rows/columns are inserted before this index. '
      + 'For deletes, deletion starts at this index. '
      + 'For set_column_width/set_row_height, the column(s) or row(s) to resize.',
    ),
  ),
  count: v.optional(
    v.pipe(
      v.number(),
      v.description('Number of rows or columns to insert or delete. Defaults to 1. Only used with insert/delete actions.'),
    ),
  ),
  width: v.optional(
    v.pipe(
      v.number(),
      v.description('Column width for set_column_width. Omit to auto-size columns to fit content.'),
    ),
  ),
  height: v.optional(
    v.pipe(
      v.number(),
      v.description('Row height for set_row_height. Omit to auto-size rows to fit content.'),
    ),
  ),
});

const ConditionalFormatSchema = v.object({
  type: v.pipe(
    v.picklist(['color_scale', 'data_bars', 'highlight_cells', 'duplicate_values', 'clear']),
    v.description('The type of conditional format to apply.'),
  ),
  reference: v.pipe(
    v.string(),
    v.description('Range reference to apply conditional formatting to (e.g. "A1:A20", "Sheet1!B2:D10").'),
  ),
  preset: v.optional(
    v.pipe(
      v.picklist(['red-green', 'green-red', 'red-yellow-green', 'green-yellow-red']),
      v.description('Color scale preset. Only for type "color_scale". Defaults to "green-red".'),
    ),
  ),
  color: v.optional(
    v.pipe(
      v.string(),
      v.description('Bar fill color (e.g. "#4472C4", "steelblue", "theme:Accent"). Only for type "data_bars". Defaults to "#4472C4".'),
    ),
  ),
  expression: v.optional(
    v.pipe(
      v.string(),
      v.description('Condition applied per-cell in the range (e.g. "> 100", "= 0", "< 0"). Only for type "highlight_cells".'),
    ),
  ),
  style: v.optional(
    v.pipe(
      StyleObject,
      v.description('Style to apply when the condition is met. Only for types "highlight_cells" and "duplicate_values". Defaults to light-red fill with dark-red text.'),
    ),
  ),
  unique: v.optional(
    v.pipe(
      v.boolean(),
      v.description('Highlight unique values instead of duplicates. Only for type "duplicate_values". Defaults to false.'),
    ),
  ),
  hide_values: v.optional(
    v.pipe(
      v.boolean(),
      v.description('Hide cell values and show only the data bars. Only for type "data_bars". Defaults to false.'),
    ),
  ),
});

const ListConditionalFormatsSchema = v.object({
  sheet: v.optional(
    v.pipe(
      v.string(),
      v.description('Sheet name. If omitted, uses the active sheet.'),
    ),
  ),
});

const ListAnnotationsSchema = v.object({
  sheet: v.optional(
    v.pipe(
      v.string(),
      v.description('Sheet name. If omitted, uses the active sheet.'),
    ),
  ),
});

const MoveAnnotationSchema = v.object({
  id: v.pipe(
    v.string(),
    v.description('Annotation id (from list_annotations).'),
  ),
  position: v.pipe(
    v.string(),
    v.description('Range reference for the new placement (e.g. "E1:J15"). The annotation fills the area from the top-left of the first cell to the bottom-right of the last cell.'),
  ),
});

const DeleteAnnotationSchema = v.object({
  id: v.pipe(
    v.string(),
    v.description('Annotation id (from list_annotations).'),
  ),
});

const ReorderAnnotationSchema = v.object({
  id: v.pipe(
    v.string(),
    v.description('Annotation id (from list_annotations).'),
  ),
  action: v.pipe(
    v.picklist(['to_front', 'to_back']),
    v.description('Move the annotation to the front (top) or back (bottom) of the z-order.'),
  ),
});

// --- Tools array ---

export const tools = [
  defineTool(
    'get_cells',
    'Read values from spreadsheet cells. Accepts a cell reference like "A1" for a single cell, a range like "A1:C3" for multiple cells, or an array of references to fetch multiple ranges at once. Prefix with sheet name for multi-sheet docs (e.g. "Sheet2!A1:B5").',
    GetCellsSchema,
  ),
  defineTool(
    'set_cells',
    'Write values, apply formatting, and/or set borders on spreadsheet cells. Input has three optional blocks: "values" maps references to cell values (strings, numbers, booleans, or 2D arrays — strings starting with "=" are formulas, always use comma as the argument separator), "styles" maps references to style objects (delta apply), and "borders" maps references to border options. At least one block is required. Optionally include "auto_resize_columns" with an array of column labels (e.g. ["A", "B"]) to auto-fit column widths after changes. Examples: {"values": {"A1": 100}}, {"values": {"A1": "=SUM(B1, B2)"}, "styles": {"A1": {"bold": true}}}, {"borders": {"A1:C3": {"borders": "all"}}}.',
    SetCellsSchema,
    {
      supports_partial_application: true,
    }
  ),
  defineTool(
    'list_sheets',
    'List all sheets (tabs) in the workbook, including hidden sheets.',
    ListSheetsSchema,
    { priority: 'low' },
  ),
  defineTool(
    'activate_sheet',
    'Activates a sheet (tab) in the workbook, bringing it to the front of the user interface.',
    ActivateSheetSchema,
    { priority: 'low' },
  ),
  defineTool(
    'add_sheet',
    'Add a new sheet to the workbook.',
    AddSheetSchema,
    { priority: 'low' },
  ),
  defineTool(
    'get_style',
    'Read cell formatting/style from a cell or range. Returns properties like bold, italic, font size, colors, alignment, number format, etc.',
    GetStyleSchema,
    { priority: 'low' },
  ),
  defineTool(
    'get_spreadsheet',
    'Get a full overview of the spreadsheet. Returns formulas and values for every cell across all sheets (or a subset of sheets). Use this to understand spreadsheet structure and logic before making targeted queries.',
    GetSpreadsheetSchema,
  ),
  defineTool(
    'evaluate',
    'Evaluate a spreadsheet formula and return the result. The formula is evaluated in the context of the current spreadsheet. Use sheet-qualified references (e.g. "Sheet1!A1") to avoid ambiguity. Always use comma as the argument separator (e.g. "=SUM(A1, A2)", not "=SUM(A1; A2)").',
    EvaluateSchema,
  ),
  defineTool(
    'update_layout',
    'Insert or delete rows or columns, or set column widths or row heights in the active sheet. For resize actions, omit width/height to auto-size to fit content.',
    UpdateLayoutSchema,
    { priority: 'low' },
  ),
  defineTool(
    'select',
    'Select a cell or range in the spreadsheet, highlighting it for the user. Use this to direct the user\'s attention to specific cells when explaining something. Always use a sheet-qualified address (e.g. "Sheet1!A1", "Sheet1!B2:D5").',
    SelectSchema,
  ),
  defineTool(
    'get_selection',
    "Get the user's current spreadsheet selection. Returns the selection address/range along with cell values, formulas, and formatted display strings for the selected cells. Use this to understand what the user is looking at or referring to.",
    GetSelectionSchema,
  ),
  defineTool(
    'get_screenshot',
    'Capture a screenshot of the current spreadsheet view as the user sees it. Returns an image of the spreadsheet in its current state, including visible cells, formatting, and charts.',
    GetScreenshotSchema,
    {
      requires_image_support: true,
    }
  ),
  defineTool(
    'rename_sheet',
    'Rename a sheet (tab) in the workbook.',
    RenameSheetSchema,
    { priority: 'low' },
  ),
  defineTool(
    'delete_sheet',
    'Delete a sheet (tab) from the workbook.',
    DeleteSheetSchema,
    { priority: 'low' },
  ),
  defineTool(
    'merge_cells',
    'Merge a range of cells into a single cell. The value of the top-left cell is preserved.',
    MergeCellsSchema,
    { priority: 'low' },
  ),
  defineTool(
    'unmerge_cells',
    'Unmerge a previously merged range of cells.',
    UnmergeCellsSchema,
    { priority: 'low' },
  ),
  defineTool(
    'add_chart',
    'Insert a chart into the spreadsheet. Specify the chart type, one or more data series with cell range references, and an optional title. For multiple series sharing the same category labels, only the first series needs to specify labels -- subsequent series inherit them.',
    AddChartSchema,
    { priority: 'low' },
  ),
  defineTool(
    'conditional_format',
    'Apply conditional formatting to a range of cells. Supported types: "color_scale" (gradient fill based on cell values, with presets like "red-green"), "data_bars" (in-cell bar visualization), "highlight_cells" (apply a style when a per-cell condition like "> 100" matches), "duplicate_values" (highlight duplicate or unique values), "clear" (remove conditional formats — note: this removes entire format objects that overlap the range, not just the intersection).',
    ConditionalFormatSchema,
    { priority: 'low' },
  ),
  defineTool(
    'list_conditional_formats',
    'List conditional formats on a sheet (defaults to the active sheet). Returns an array of format objects that mirror the "conditional_format" tool input shape, so you can see how existing formats are configured and reproduce or modify them. Notes: (1) conditional formats cannot be updated in place — to modify, use "clear" and recreate; (2) "color_scale" formats are returned with raw gradient stops even when created from a preset (the preset name cannot be recovered from the stored format); (3) the "expression" type may appear in output but is not currently creatable via the "conditional_format" tool.',
    ListConditionalFormatsSchema,
    { priority: 'low' },
  ),
  defineTool(
    'list_annotations',
    'List annotations (charts, images, textboxes) on a sheet (defaults to the active sheet). Returns each annotation with an "id" that identifies it for later operations such as delete or move. The id is stable for the current spreadsheet session only — it will not survive closing and reopening the file.',
    ListAnnotationsSchema,
    { priority: 'low' },
  ),
  defineTool(
    'move_annotation',
    'Move or resize an annotation (chart, image, textbox) by setting a new position. Use list_annotations to get the annotation id.',
    MoveAnnotationSchema,
    { priority: 'low' },
  ),
  defineTool(
    'delete_annotation',
    'Delete an annotation (chart, image, textbox). Use list_annotations to get the annotation id.',
    DeleteAnnotationSchema,
    { priority: 'low' },
  ),
  defineTool(
    'reorder_annotation',
    'Change the z-order of an annotation (chart, image, textbox). Move it to the front or back of the stacking order. Use list_annotations to get the annotation id.',
    ReorderAnnotationSchema,
    { priority: 'low' },
  ),
] as const satisfies ToolDefinition[];

export type ToolName = (typeof tools)[number]['name'];

export const tools_map = new Map<ToolName, ToolDefinition>();
for (const entry of tools) {
  tools_map.set(entry.name, entry);
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

/*

moved into tool definition

export const toolSchemas: { [K in ToolName]: v.GenericSchema } = {
  get_cells: GetCellsSchema,
  set_cells: SetCellsSchema,
  list_sheets: ListSheetsSchema,
  activate_sheet: ActivateSheetSchema,
  add_sheet: AddSheetSchema,
  get_style: GetStyleSchema,
  get_spreadsheet: GetSpreadsheetSchema,
  evaluate: EvaluateSchema,
  update_layout: UpdateLayoutSchema,
  select: SelectSchema,
  get_selection: GetSelectionSchema,
  get_screenshot: GetScreenshotSchema,
  rename_sheet: RenameSheetSchema,
  delete_sheet: DeleteSheetSchema,
  merge_cells: MergeCellsSchema,
  unmerge_cells: UnmergeCellsSchema,
  add_chart: AddChartSchema,
  conditional_format: ConditionalFormatSchema,
  list_conditional_formats: ListConditionalFormatsSchema,
  list_annotations: ListAnnotationsSchema,
  move_annotation: MoveAnnotationSchema,
  delete_annotation: DeleteAnnotationSchema,
  reorder_annotation: ReorderAnnotationSchema,
};
*/

export type ToolInputMap = {
  get_cells: v.InferInput<typeof GetCellsSchema>;
  set_cells: v.InferInput<typeof SetCellsSchema>;
  list_sheets: v.InferInput<typeof ListSheetsSchema>;
  activate_sheet: v.InferInput<typeof ActivateSheetSchema>;
  add_sheet: v.InferInput<typeof AddSheetSchema>;
  get_style: v.InferInput<typeof GetStyleSchema>;
  get_spreadsheet: v.InferInput<typeof GetSpreadsheetSchema>;
  evaluate: v.InferInput<typeof EvaluateSchema>;
  update_layout: v.InferInput<typeof UpdateLayoutSchema>;
  select: v.InferInput<typeof SelectSchema>;
  get_selection: v.InferInput<typeof GetSelectionSchema>;
  get_screenshot: v.InferInput<typeof GetScreenshotSchema>;
  rename_sheet: v.InferInput<typeof RenameSheetSchema>;
  delete_sheet: v.InferInput<typeof DeleteSheetSchema>;
  merge_cells: v.InferInput<typeof MergeCellsSchema>;
  unmerge_cells: v.InferInput<typeof UnmergeCellsSchema>;
  add_chart: v.InferInput<typeof AddChartSchema>;
  conditional_format: v.InferInput<typeof ConditionalFormatSchema>;
  list_conditional_formats: v.InferInput<typeof ListConditionalFormatsSchema>;
  list_annotations: v.InferInput<typeof ListAnnotationsSchema>;
  move_annotation: v.InferInput<typeof MoveAnnotationSchema>;
  delete_annotation: v.InferInput<typeof DeleteAnnotationSchema>;
  reorder_annotation: v.InferInput<typeof ReorderAnnotationSchema>;
};
