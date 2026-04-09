
/**
 * Why on earth would you write your own JSON parser?
 * 
 * A: to handle objects with duplicate keys (I'm looking at you, ChatGPT).
 * UPDATE: also to allow comments, although there are libs that will do that.
 * 
 * one thing we are expressly _not_ handling is string concatenation. 
 * o1-mini does that from time to time. we could in theory parse as javascript,
 * but that's not a road I want to take right now
 */

export interface Options {
  merge_duplicates?: boolean;
  allow_comments?: boolean;
}

export interface Context {
  text: string;
  len: number;
  position: number;
  options?: Options;
}

const ParseString = (context: Context) => {
  let result: string = '';
  for (++context.position; context.position < context.len; context.position++) {
    const char = context.text[context.position];
    switch (char) {
      case '"':
        context.position++;
        return result;

      // FIXME: -> method        
      case '\\':
        {
          const next_char = context.text[++context.position];
          switch (next_char) {
            case '"':
            case '\\':
              result += next_char;
              break;
            case 'b':
              result += '\b';
              break;
            case 'f':
              result += '\f';
              break;
            case 'n':
              result += '\n';
              break;
            case 'r':
              result += '\r';
              break;
            case 't':
              result += '\t';
              break;
            default:
              console.warn("Unhandled escape sequence in JSON string", next_char);
          }
        }
        // result += char;
        // result += context.text[++context.position];
        break;

      default:
        result += char;
     }
  }
  throw new Error('unterminated string');
};

const ConsumeWhitespace = (context: Context) => {
  while (/[\s\r\n]/.test(context.text[context.position])) {
    context.position++;
  }
};

const ConsumeCPPComment = (context: Context) => {
  while (!/[\r\n]/.test(context.text[context.position])) {
    context.position++;
  }
};

const ParseLiteral = (context: Context) => {

  let text = '';

  for (; context.position < context.len; context.position++) {
    const char = context.text[context.position];
    if (/[\s\r\n,}\]]/.test(char)) {
      if (text === 'true') { return true; }
      if (text === 'false') { return false; }
      if (text === 'null') { return null; }
      if (/^-{0,1}[0-9.]+$/.test(text)) {
        return Number(text);
      }
      if (/^-{0,1}[0-9.]+e[+-]\d+$/.test(text)) {
        return Number(text);
      }
      throw new Error('invalid literal: ' + text);
    }
    else if (/[truefalsenull0-9-.]/.test(char)) {
      text += char;
    }
    else {
      throw new Error('invalid character in literal: ' + char + ` (text: ${text})`);
    }
  }

};

const ParseArray = (context: Context) => {

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const array: any[] = [];

  context.position++;

  while (true) {
    
    ConsumeWhitespace(context);
    let char = context.text[context.position];
    switch (char) {
      case '"':
        array.push(ParseString(context));
        break;

      case '[':
        array.push(ParseArray(context));
        break;

      case '{':
        array.push(ParseObject(context));
        break;
  
      case ']':
        context.position++;
        return array;
  
      default:
        array.push(ParseLiteral(context));
        break;
    }
    
    ConsumeWhitespace(context);
    char = context.text[context.position];

    switch (char) {
      case ']':
        context.position++;
        return array;

      case ',':
        context.position++;
        break;

      default:
        throw new Error('invalid character in stream: ' + char);
    }

  }

};



const ParseObject = (context: Context) => {

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const object: any = {};

  context.position++;

  while (true) {

    let identifier: string|undefined;

    // parse key

    let char = '';

    while (!identifier) {
      ConsumeWhitespace(context);
      char = context.text[context.position];
      switch (char) {
        case '"':
          identifier = ParseString(context);
          break;

        case '}':
          context.position++;
          return object;

        case '/':
          if (context.options?.allow_comments && context.text[++context.position] === '/') {
            ConsumeCPPComment(context);
            break;
          }

        // eslint-disable-next-line no-fallthrough
        default:
          throw new Error('invalid character: ' + char);
      }
    }

    if (!identifier) {
      throw new Error('missing identifier');
    }

    // look for assignment

    ConsumeWhitespace(context);
    char = context.text[context.position];
    if (char !== ':') {
      throw new Error('expected assignment');
    }
    context.position++;

    // parse value

    ConsumeWhitespace(context);
    char = context.text[context.position];

    // console.info("identifier", identifier, "pos", context.position, "next", char)

    switch (char) {
      case '"':
        object[identifier] = ParseString(context);
        break;

      case '[':

        if (object[identifier] && context.options?.merge_duplicates) {
          const array = ParseArray(context);
          const current = object[identifier];
          if (Array.isArray(current)) {
            current.push(...array);
          }
          else {
            console.warn("can't merge values, original is not an array");
            object[identifier] = array;
          }
        }
        else {
          object[identifier] = ParseArray(context);
        }
        break;

      case '{':
        if (object[identifier] && context.options?.merge_duplicates) {
          const update = ParseObject(context);
          const current = object[identifier];
          if (typeof current === 'object') {
            object[identifier] = { ...current, ...update };
          }
          else {
            console.warn("can't merge values, original is not an object");
            object[identifier] = update;
          }
        }
        else {
          object[identifier] = ParseObject(context);
        }
        break;

      default:
        object[identifier] = ParseLiteral(context);

    }

    // what's next?

    ConsumeWhitespace(context);
    char = context.text[context.position];
    switch (char) {
      case '}':
        context.position++;
        return object;

      case ',':
        context.position++;
        break;

      default: 
        throw new Error('invalid character in stream: ' + char);
    }

  }

};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Parse = (text: string, options?: Options): any => {

  const context: Context = { text, len: text.length, position: 0, options };

  ConsumeWhitespace(context);
  const char = context.text[context.position];

  switch (char) {
    case '"':
      return ParseString(context);

    case '[':
      return ParseArray(context);

    case '{':
      return ParseObject(context);

  }

  throw new Error('unexpected character @ root: ' + char);

}
