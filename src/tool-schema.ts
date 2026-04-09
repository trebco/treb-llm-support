import * as v from 'valibot';
import { toJsonSchema } from '@valibot/to-json-schema';
import type { FunctionDeclaration } from '@google/genai';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
};

function defineTool<
  N extends string,
  S extends v.GenericSchema,
>(
  name: N,
  description: string,
  schema: S,
): ToolDefinition & { name: N } {
  const { $schema, ...jsonSchema } = toJsonSchema(schema);
  return {
    name,
    description,
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
  ),
  defineTool(
    'list_sheets',
    'List all sheets (tabs) in the workbook, including hidden sheets.',
    ListSheetsSchema,
  ),
  defineTool(
    'activate_sheet',
    'Activates a sheet (tab) in the workbook, bringing it to the front of the user interface.',
    ActivateSheetSchema,
  ),
  defineTool(
    'add_sheet',
    'Add a new sheet to the workbook.',
    AddSheetSchema,
  ),
  defineTool(
    'get_style',
    'Read cell formatting/style from a cell or range. Returns properties like bold, italic, font size, colors, alignment, number format, etc.',
    GetStyleSchema,
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
] as const satisfies ToolDefinition[];

export type ToolName = (typeof tools)[number]['name'];

export function toGeminiFunctionDeclarations(tools: ToolDefinition[]): FunctionDeclaration[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.input_schema,
  }));
}

export function toOpenAIChatCompletionTools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

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
};

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
};
