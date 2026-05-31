
import type { ToolCallContent, ToolResultContent } from './chat-message';
import type { ToolInputMap, ToolName } from './tool-schema';
import { tools_map } from './tool-schema';
import * as v from 'valibot';
import type { EmbeddedSpreadsheet, CellValue, Color, CellStyle, FontSize, BorderConstants, ConditionalFormatType } from '@trebco/treb';
import { ListAnnotations, SummarizeSpreadsheet, transpose } from './support-functions';
import { parse as pj_parse } from 'partial-json';

/** placeholder */
export interface ExternalUI {

  /** returns screenshot of current view, as b64-encoded data URI */
  Screenshot: (sheet: EmbeddedSpreadsheet) => Promise<string>;

}

export type ToolHandlerImageResponseType = {
  type: 'image',
  image_uri: string;
  content?: unknown;
};

export type ToolHandlerGenericResposneType = {
  type: 'object',
  content: unknown,
};

export type ToolHandlerErrorType = {
  type: 'error',
  content: unknown,
};

export type ToolHandlerResponseType = 
  ToolHandlerGenericResposneType | 
  ToolHandlerImageResponseType |
  ToolHandlerErrorType ;

type ToolHandler = {
  [K in ToolName]: (sheet: EmbeddedSpreadsheet, ui: ExternalUI, input: ToolInputMap[K]) => ToolHandlerResponseType|Promise<ToolHandlerResponseType>;
};

// --- Color conversion ---

function parseColor(value: string): Color {
  if (!value) return {};
  if (value.startsWith('theme:')) {
    const theme = value.slice(6);
    const asNumber = Number(theme);
    return { theme: Number.isNaN(asNumber) ? theme : asNumber } as Color;
  }
  return { text: value };
}

function serializeColor(color: Color | undefined): string | undefined {
  if (!color) return undefined;
  if ('text' in color) return color.text;
  if ('theme' in color) return `theme:${color.theme}`;
  return '';
}

// --- FontSize conversion ---

function parseFontSize(value: string): FontSize {
  const match = value.match(/^([0-9]*\.?[0-9]+)(em|%)$/);
  if (!match) {
    throw new Error(
      `Invalid font size "${value}". Use relative units only: e.g. "1.2em", "120%".`,
    );
  }
  return { value: parseFloat(match[1]), unit: match[2] as 'em' | '%' };
}

function serializeFontSize(fs: FontSize | undefined): string | undefined {
  if (!fs) return undefined;
  return `${fs.value}${fs.unit}`;
}

// --- Style conversion ---

function serializeStyle(style: CellStyle): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (style.bold !== undefined) result.bold = style.bold;
  if (style.italic !== undefined) result.italic = style.italic;
  if (style.underline !== undefined) result.underline = style.underline;
  if (style.strike !== undefined) result.strike = style.strike;
  if (style.font_size !== undefined) result.font_size = serializeFontSize(style.font_size);
  if (style.font_face !== undefined) result.font_face = style.font_face;
  if (style.text !== undefined) result.text_color = serializeColor(style.text);
  if (style.fill !== undefined) result.fill_color = serializeColor(style.fill);
  if (style.horizontal_align !== undefined) result.horizontal_align = style.horizontal_align;
  if (style.vertical_align !== undefined) result.vertical_align = style.vertical_align;
  if (style.number_format !== undefined) result.number_format = style.number_format;
  if (style.wrap !== undefined) result.wrap = style.wrap;
  if (style.indent !== undefined) result.indent = style.indent;
  if (style.locked !== undefined) result.locked = style.locked;
  return result;
}

function inputToCellStyle(input: NonNullable<ToolInputMap['set_cells']['styles']>[string]): CellStyle {
  const style: CellStyle = {};
  if (input.bold !== undefined) style.bold = input.bold;
  if (input.italic !== undefined) style.italic = input.italic;
  if (input.underline !== undefined) style.underline = input.underline;
  if (input.strike !== undefined) style.strike = input.strike;
  if (input.font_size !== undefined) style.font_size = parseFontSize(input.font_size);
  if (input.text_color !== undefined) style.text = parseColor(input.text_color);
  if (input.fill_color !== undefined) style.fill = parseColor(input.fill_color);
  if (input.horizontal_align !== undefined) style.horizontal_align = input.horizontal_align;
  if (input.vertical_align !== undefined) style.vertical_align = input.vertical_align;
  if (input.number_format !== undefined) style.number_format = input.number_format;
  if (input.wrap !== undefined) style.wrap = input.wrap;
  if (input.indent !== undefined) style.indent = input.indent;
  if (input.locked !== undefined) style.locked = input.locked;
  return style;
}

// --- Conditional format serialization ---

function serializeConditionalFormat(sheet: EmbeddedSpreadsheet, format: ConditionalFormatType): Record<string, unknown> {
  const reference = sheet.Unresolve(format.area, true);
  switch (format.type) {
    case 'gradient': {
      const out: Record<string, unknown> = {
        type: 'color_scale',
        reference,
        stops: format.stops?.map((s) => ({ value: s.value, color: serializeColor(s.color) })),
      };
      if (format.property !== undefined) out.property = format.property;
      if (format.min !== undefined) out.min = format.min;
      if (format.max !== undefined) out.max = format.max;
      return out;
    }
    case 'data-bar': {
      const out: Record<string, unknown> = {
        type: 'data_bars',
        reference,
        color: serializeColor(format.fill),
      };
      if (format.negative !== undefined) out.negative_color = serializeColor(format.negative);
      if (format.hide_values !== undefined) out.hide_values = format.hide_values;
      if (format.min !== undefined) out.min = format.min;
      if (format.max !== undefined) out.max = format.max;
      return out;
    }
    case 'cell-match':
      return {
        type: 'highlight_cells',
        reference,
        expression: format.expression,
        style: serializeStyle(format.style),
      };
    case 'duplicate-values': {
      const out: Record<string, unknown> = {
        type: 'duplicate_values',
        reference,
        style: serializeStyle(format.style),
      };
      if (format.unique !== undefined) out.unique = format.unique;
      return out;
    }
    case 'expression':
      return {
        type: 'expression',
        reference,
        expression: format.expression,
        style: serializeStyle(format.style),
      };
  }
}

/** Convert a column label (e.g. "A"→0, "B"→1, "AA"→26) to a 0-based index. */
function columnLabelToIndex(label: string): number {
  let index = 0;
  for (let i = 0; i < label.length; i++) {
    index = index * 26 + (label.charCodeAt(i) - 64);
  }
  return index - 1;
}

function GetCellHandler(sheet: EmbeddedSpreadsheet, ui: ExternalUI, input: ToolInputMap['get_cells']): ToolHandlerGenericResposneType {

  let references = input.reference;

  if (!Array.isArray(references)) {
    references = [references];
  }

  let composite: Record<string, Partial<Record<'values'|'formulas'|'formatted', CellValue|CellValue[][]>>> = {};

  for (const entry of references) {

    const content: Partial<Record<'values'|'formulas'|'formatted', CellValue|CellValue[][]>> = {};

    if (input.values !== false) {
      content.values = sheet.GetRange(entry);
    }
    if (input.formatted) {
      content.formatted = sheet.GetRange(entry, { type: 'formatted' });
    }
    if (input.formulas) {
      content.formulas = sheet.GetRange(entry, { type: 'formula' });
    }

    composite[entry] = content;

  }

  return {
    type: 'object', 
    content: composite
  };

}

const ToolResult = (content: unknown): ToolHandlerGenericResposneType => ({
  type: 'object',
  content,
});

/** support function for charts */
function ComposeSeries(series: { values: string, labels?: string, title?: string}) {

  // series function:
  // =Series(title, X, Y, Z, index, subtype, labels, axis)

  if (!series.labels && !series.title) {
    return series.values;
  }
  return `Series(${series.title ? `"${series.title}"` : ''},, ${series.values},,,, ${series.labels || ''})`;
}

/**
 * handler for add_chart tool
 */
function AddChart(sheet: EmbeddedSpreadsheet, _ui: ExternalUI, input: Parameters<ToolHandler['add_chart']>[2]) {

  let fn = '';
  if (input.chart_type === 'scatter') {

    // special handling for scatter plot

    const series = Array.isArray(input.series) ? input.series[0] : input.series;
    const title = input.title || series.title || '';
    const data = `Series(${series.title ? `"${series.title}"` : ''}, ${series.labels || ''}, ${series.values})`;

    fn = `=Scatter.Plot(${data}, ${input.title ? `"${input.title}"` : ''})`;
    
  }
  else if (input.chart_type === 'donut') {

    // special handling for donut chart

    const series = Array.isArray(input.series) ? input.series[0] : input.series;
    const title = input.title || series.title || '';
    fn = `=Donut.Chart(${series.values},${series.labels || ''}, ${title ? `"${title}"` : ''})`;
  }
  else {

    // multiple series must be enclosed in a Group() function
    const data = (Array.isArray(input.series)) ? 
      `Group(` + input.series.map(ComposeSeries).join(', ') + `)` : ComposeSeries(input.series);

    // for labels, use first series
    let labels = '';
    if (Array.isArray(input.series)) {
      labels = input.series[0].labels || '';
    }
    else {
      labels = input.series.labels || '';
    }

    fn = `=${input.chart_type}.chart(${data},${labels},${input.title ? `"${input.title}"` : ''})`;
  }

  // console.info('fn', fn);

  if (fn) {
    sheet.InsertAnnotation(fn, 'treb-chart', input.position, { argument_separator: ','});
    return ToolResult({});
  }

  return ToolResult({ error: 'unknown error' });

}

export const handlers: ToolHandler = {
  get_cells: GetCellHandler,
  list_sheets(sheet, _ui, _input) {
    return ToolResult({ sheets: sheet.ListSheets() });
  },
  activate_sheet(sheet, ui, input) {
    sheet.ActivateSheet(input.name);
    return ToolResult({});
  },
  add_sheet(sheet, ui, input) {
    sheet.AddSheet(input.name);
    return ToolResult({});
  },
  set_cells(sheet, ui, input) {
    if (input.values) {
      for (const [reference, value] of Object.entries(input.values)) {
        sheet.SetRange(reference, value, { argument_separator: ',' });
      }
    }
    if (input.styles) {
      for (const [reference, styleInput] of Object.entries(input.styles)) {
        const style = inputToCellStyle(styleInput);
        sheet.ApplyStyle(reference, style, true);
      }
    }
    if (input.borders) {
      for (const [reference, opts] of Object.entries(input.borders)) {
        sheet.ApplyBorders(reference, opts.borders as BorderConstants, opts.width);
      }
    }
    if (input.auto_resize_columns) {
      const indices = input.auto_resize_columns.map(columnLabelToIndex);
      sheet.SetColumnWidth(indices, undefined, false);
    }
    return ToolResult({});
  },
  get_style(sheet, ui, input) {
    const result = sheet.GetStyle(input.reference, true);
    if (!result) return ToolResult({});
    if (Array.isArray(result)) {
      return ToolResult({ style: result.map((row) => row.map(serializeStyle)) });
    }
    return ToolResult({ style: serializeStyle(result) });
  },
  async get_spreadsheet(sheet, _ui, input) {
    return ToolResult(SummarizeSpreadsheet(sheet, input.sheets));
  },
  evaluate(sheet, _ui, input) {
    try {

      // sheet.evaluate returns arrays in column-major order, matching the
      // internal representation. I don't want to "fix" that because some
      // code might be relying on it. For the time being we'll fix it here
      // in the tool, and we can think about changing at the source down 
      // the road.

      let result = sheet.Evaluate(input.expression, { argument_separator: ',' });

      if (Array.isArray(result)) {
        result = transpose(result);
      }

      return ToolResult(result);

    }
    catch {
      return ToolResult({ error: 'calculation error' });
    }
  },
  select(sheet, _ui, input) {
    sheet.Select(input.reference, input.scroll_into_view ? 'smooth' : undefined);
    return ToolResult({});
  },
  get_selection(sheet, _ui, _input) {
    const selection = sheet.GetSelection(true);
    if (!selection) return ToolResult({ selection: '' });
    return ToolResult({
      selection,
      values: sheet.GetRange(selection),
      formulas: sheet.GetRange(selection, { type: 'formula' }),
      formatted: sheet.GetRange(selection, { type: 'formatted' }),
    });
  },
  async get_screenshot(_sheet, ui, _input) {
    const image = await ui.Screenshot(_sheet);
    return { type: 'image', 
      image_uri: image || '',
      content: {
        active_sheet: _sheet.active_sheet,
        user_selection: _sheet.GetSelection(true),
      },
    };
  },
  rename_sheet(sheet, _ui, input) {
    sheet.RenameSheet(input.name, input.new_name);
    return ToolResult({});
  },
  delete_sheet(sheet, _ui, input) {
    sheet.DeleteSheet(input.name);
    return ToolResult({});
  },
  merge_cells(sheet, _ui, input) {
    sheet.MergeCells(input.reference);
    return ToolResult({});
  },
  unmerge_cells(sheet, _ui, input) {
    sheet.UnmergeCells(input.reference);
    return ToolResult({});
  },
  add_chart: AddChart,
  update_layout(sheet, _ui, input) {
    const count = input.count ?? 1;
    // Schema declares 1-based indices; the spreadsheet API uses 0-based.
    const index0 = Array.isArray(input.index)
      ? input.index.map(i => i - 1)
      : input.index - 1;
    switch (input.action) {
      case 'insert_rows':      sheet.InsertRows(index0 as number, count); break;
      case 'insert_columns':   sheet.InsertColumns(index0 as number, count); break;
      case 'delete_rows':      sheet.DeleteRows(index0 as number, count); break;
      case 'delete_columns':   sheet.DeleteColumns(index0 as number, count); break;
      case 'set_column_width': sheet.SetColumnWidth(index0, input.width); break;
      case 'set_row_height':   sheet.SetRowHeight(index0, input.height); break;
    }
    return ToolResult({});
  },
  conditional_format(sheet, _ui, input) {
    const defaultStyle: CellStyle = {
      fill: parseColor('#FFC7CE'),
      text: parseColor('#9C0006'),
    };
    switch (input.type) {
      case 'color_scale':
        sheet.ConditionalFormatGradient(input.reference, input.preset ?? 'green-red');
        break;
      case 'data_bars':
        sheet.ConditionalFormatDataBars(input.reference, { fill: parseColor(input.color ?? '#4472C4'), hide_values: input.hide_values });
        break;
      case 'highlight_cells': {
        const style = input.style ? inputToCellStyle(input.style) : defaultStyle;
        sheet.ConditionalFormatCellMatch(input.reference, {
          style,
          expression: input.expression ?? '',
          options: { argument_separator: ',' },
        });
        break;
      }
      case 'duplicate_values': {
        const style = input.style ? inputToCellStyle(input.style) : defaultStyle;
        sheet.ConditionalFormatDuplicateValues(input.reference, { style, unique: input.unique });
        break;
      }
      case 'clear':
        sheet.RemoveConditionalFormats(input.reference);
        break;
    }
    return ToolResult({});
  },
  list_conditional_formats(sheet, _ui, input) {
    const formats = sheet.ListConditionalFormats(input.sheet);
    return ToolResult({ formats: formats.map((f) => serializeConditionalFormat(sheet, f)) });
  },
  list_annotations(sheet, _ui, input) {
    return ToolResult(ListAnnotations(sheet, input.sheet));
  },
  move_annotation(sheet, _ui, input) {
    sheet.MoveAnnotation(input.id, input.position);
    return ToolResult({});
  },
  delete_annotation(sheet, _ui, input) {
    sheet.DeleteAnnotation(input.id);
    return ToolResult({});
  },
  reorder_annotation(sheet, _ui, input) {
    const translated = input.action === 'to_back' ? 'bottom' : 'top';
    sheet.AnnotationZOrder(input.id, translated);
    return ToolResult({});
  },
};
