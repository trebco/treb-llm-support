
import type { AnnotationChartData, AnnotationData, 
    AnnotationLayout, BaseCellData, CellValue, 
    EmbeddedSpreadsheet, NestedColumnData, NestedRowData, SerializedCellData } from '@trebco/treb';

import { type ExpressionUnit, type Parser } from '@trebco/treb/treb-parser';

/** type check for serialized data type */
function IsNestedRowData(test: SerializedCellData): test is NestedRowData[] {
  if (Array.isArray(test)) {
    return (typeof (test[0] as NestedRowData)?.row === 'number');
  }
  return false;
}

/** type check for serialized data type */
function IsNestedColumnData(test: SerializedCellData): test is NestedColumnData[] {
  if (Array.isArray(test)) {
    return (typeof (test[0] as NestedColumnData)?.column === 'number');
  }
  return false;
}
  
/** convert a column index (0-based) to a spreadsheet column letter(s) header */
function ColumnLabel(c: number): string {
  let s = String.fromCharCode(65 + c % 26);
  while (c > 25){
    c = Math.floor(c / 26) - 1;
    s = String.fromCharCode(65 + c % 26) + s;
  }
  return s;
}

/** convert row and column (both 0-based) to a spreadsheet address, e.g. B3 */
export function AddressLabel(address: {row: number, column: number}): string {
  return ColumnLabel(address.column) + (address.row + 1);
}

/** type for a formula including calculated result */
interface CellDataType {
  value: CellValue;
  array?: boolean;
  dynamic_array?: boolean;
  calculated?: CellValue|CellValue[][];
}

function IsCellDataType(value: CellDataType|CellValue): value is CellDataType {
  if (value && typeof value === 'object') {
    return (typeof (value as CellDataType).array !== 'undefined' || typeof (value as CellDataType).dynamic_array !== 'undefined');
  }
  return false;
}

/** summary type for a cell, includes only basic information  */
type CellSummary = {
  label: string;
  value: CellDataType|CellValue;
  row: number;
  column: number;
}


interface RenderedLayoutCorner {
  cell: string;
  offset_percent?: { x: number, y: number };
}

function RenderLayout(sheet: EmbeddedSpreadsheet, layout: AnnotationLayout) {

  const top_left: RenderedLayoutCorner = {
    cell: AddressLabel(layout.tl.address),
    offset_percent: layout.tl.offset,
  };

  const bottom_right: RenderedLayoutCorner = {
    cell: AddressLabel(layout.br.address),
    offset_percent: layout.br.offset,
  };

  return {
    top_left, bottom_right 
  };

}

interface SeriesType {
  values: string;
  labels?: string;
  y_values?: string; 
  title?: string;
}

function UnpackSeriesTail(type: string, parser: Parser, expr: ExpressionUnit): SeriesType {
  if (expr.type === 'call') {
    const name = expr.name.toLowerCase();
    if (name === 'series') {

      // series function:
      // =Series(title, X, Y, Z, index, subtype, labels, axis)

      const series: SeriesType = {
        values: parser.Render(expr.args[1]),
      };
      if (expr.args[0] && expr.args[0].type !== 'missing') {
        series.title = parser.Render(expr.args[0]);
      }
      if (type === 'scatter.plot') {
        if (expr.args[2] && expr.args[2].type !== 'missing') {
          series.y_values = parser.Render(expr.args[2]);
        }
      }
      else {
        if (expr.args[6] && expr.args[6].type !== 'missing') {
          series.labels = parser.Render(expr.args[6]);
        }
      }
      return series;
    }
  }
  return {
    values: parser.Render(expr),
  };
}

function UnpackSeries(type: string, parser: Parser, expr: ExpressionUnit): SeriesType|SeriesType[] {
  if (expr.type === 'call') {
    const name = expr.name.toLowerCase();
    if (name === 'group') {
      return expr.args.map(arg => UnpackSeriesTail(type, parser, arg));
    }
  }
  return UnpackSeriesTail(type, parser, expr);
}

interface UnpackedChart {
  type: string;
  title: string;
  labels: string;
  series: SeriesType|SeriesType[];
}

function UnpackChart(sheet: EmbeddedSpreadsheet, annotation: AnnotationChartData & {id: string}) {
  if (annotation.formula) {
    const parser = (sheet as any).parser as Parser;
    parser.Save();
    parser.SetLocaleSettings('.' as any);
    const data: Partial<UnpackedChart> = {};
    const parse_result = parser.Parse(annotation.formula);
    if (parse_result.expression && parse_result.expression.type === 'call') {
      const fn = parse_result.expression.name.toLowerCase();
      const args = parse_result.expression.args;

      data.series = UnpackSeries(fn, parser, args[0]);

      switch(fn) {

        case 'scatter.plot':
          data.title = args[1] ? parser.Render(args[1]) : undefined;
          break;

        default:
          if (args[1] && args[1].type !== 'missing') {
            data.labels = parser.Render(args[1]);
          }
          data.title = args[2] ? parser.Render(args[2]) : undefined;
          break;
      }

      data.type = fn;
    }
    parser.Restore();
    return data;
  }
  return {};
}

export function ListAnnotations(sheet: EmbeddedSpreadsheet, sheet_name?: string) {

  const annotations = sheet.ListAnnotations(sheet_name).filter((test): test is Exclude<AnnotationData, { type: 'external' }> & {id: string} => test.type !== 'external').map(item => {

    if (item.type === 'treb-chart') {
      const chart = UnpackChart(sheet, item);
      return {
        id: item.id,
        type: item.type,
        layout: item.layout ? RenderLayout(sheet, item.layout) : undefined,
        ...chart,
      }
    }

    return {
      id: item.id,
      type: item.type,
      layout: item.layout ? RenderLayout(sheet, item.layout) : undefined,
    }
  });

  return annotations;

}

if (typeof self !== 'undefined') {
  (self as any).ListAnnotations = ListAnnotations;
}

/** 
 * read cell data and return a summary 
 */
function ReadCell(cell: BaseCellData, row: number, column: number, array_cache: Map<string, CellValue[][]>): CellSummary|undefined {

  // for the purposes of this summarization, we only care about the 
  // source of an array. 

  const summary: CellSummary = {
    label: AddressLabel({row, column}),
    value: undefined,
    row, 
    column,
  };

  const is_formula = typeof cell.value === 'string' && cell.value[0] === '=';
  
  if (is_formula || cell.area || cell.spill) {

    let calculated_value = cell.calculated;

    // this is a special handler for fucntions that are really inline
    // arrays, like sparklines

    if (Array.isArray(cell.calculated)) {
      calculated_value = cell.calculated.toString();
    }

    if (cell.area) {

      const key = AddressLabel(cell.area.start);
      const cache: CellValue[][] = array_cache.get(key) || [];

      const array_row = row - cell.area.start.row;
      const array_column = column - cell.area.start.column;
      
      const segment = cache[array_row] || [];
      segment[array_column] = calculated_value;
      cache[array_row] = segment;
      
      array_cache.set(key, cache);

      // only include the array head for this summary
      if (cell.area.start.row !== row || cell.area.start.column !== column) {
        return undefined;
      }

      summary.value = {
        value: cell.value,
        array: true,
      };

      if (is_formula) {
        summary.value.calculated = calculated_value;
      }

      summary.label = AddressLabel(cell.area.start) + ':' + AddressLabel(cell.area.end);

    }
    else if (cell.spill) {

      const key = AddressLabel(cell.spill.start);
      const cache: CellValue[][] = array_cache.get(key) || [];

      const array_row = row - cell.spill.start.row;
      const array_column = column - cell.spill.start.column;
      
      const segment = cache[array_row] || [];
      segment[array_column] = calculated_value;
      cache[array_row] = segment;
      
      array_cache.set(key, cache);

      if (cell.spill.start.row !== row || cell.spill.start.column !== column) {
        return undefined;
      }

      summary.value = {
        value: cell.value,
        dynamic_array: true,
      };
      
      // pretty much has to be a formula

      if (is_formula) {
        summary.value.calculated = calculated_value;
      }

    }
    else {
      summary.value = {
        value: cell.value,
        calculated: calculated_value,
      };
    }

  }
  else {
    summary.value = cell.value; // simple
  }

  return summary;

}

/** 
 * create a summary of the spreadsheet. this is a simplified
 * view of all sheets and cells.
 */
export function SummarizeSpreadsheet(sheet: EmbeddedSpreadsheet, sheets?: string[]) {

  const serialized = sheet.SerializeDocument({
    rendered_values: true,
  });
  
  if (sheets) {
    sheets = sheets.map(name => name.toUpperCase()); // normalize
  }

  // console.info({serialized});

  let sheet_data = serialized.sheet_data;
  if (sheet_data && !Array.isArray(sheet_data)) {
    sheet_data = [sheet_data];
  }

  const summary: {
    [key: string]: {
      sheet_visibility?: 'hidden';
      cells: {
        [label: string]: CellValue|CellDataType;
      }
      annotations?: any; // type TODO
    }
  } = {};

  for (const [index, page] of (sheet_data || []).entries()) {
    const data = page.data;
    const name = page.name || `Index${index}`;

    if (sheets && !sheets.includes(name.toUpperCase())) {
      continue;
    }

    const array_cache: Map<string, CellValue[][]> = new Map();

    let cells: CellSummary[] = [];
    function AddSummary(summary: CellSummary|undefined) {
      if (summary) { 
        cells.push(summary); 
      }
    }

    if (IsNestedRowData(data)) {
      for (const entry of data) {
        for (const cell of entry.cells) {
          AddSummary(ReadCell(cell, entry.row, cell.column, array_cache));
        }
      }
    }
    else if (IsNestedColumnData(data)) {
      for (const entry of data) {
        for (const cell of entry.cells) {
          AddSummary(ReadCell(cell, cell.row, entry.column, array_cache));
        }
      }
    }
    else {
      for (const entry of data) {
        AddSummary(ReadCell(entry, entry.row, entry.column, array_cache));
      }
    }

    cells.sort((a, b) => {
      if (a.column === b.column) { 
        return a.row - b.row;
      }
      return a.column - b.column;
    });

    const sheet_summary: typeof summary[string] = {
      cells: {},
    }

    if (page.visible === false) {
      sheet_summary.sheet_visibility = 'hidden';
    }
    const annotations = ListAnnotations(sheet, name);
    if (annotations.length) {
      sheet_summary.annotations = annotations;
    }

    for (const cell of cells) {
      if (cell.value !== undefined) {
        if (IsCellDataType(cell.value)) {
          const key = AddressLabel(cell);
          const array = array_cache.get(key);
          if (array) {
            cell.value.calculated = array;
          }
        }
        sheet_summary.cells[cell.label] = cell.value;
      }
    }

    summary[name] = sheet_summary;

  }

  return summary;

}

export function transpose<T>(matrix: T[][]) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = [];
  for (let j = 0; j < cols; j++) {
    result[j] = Array(rows);
    for (let i = 0; i < rows; i++) {
      result[j][i] = matrix[i][j];
    }
  }
  return result;
}
