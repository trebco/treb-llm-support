
import markdownit from 'markdown-it';
import katex from '@vscode/markdown-it-katex';
import hljs from 'highlight.js';
import markdownItLinkAttributes from 'markdown-it-link-attributes';

const md = markdownit({
  typographer: false,
  linkify: true,
  highlight: function (str: string, lang: string) {

    let use_lang = lang;

    if (/json.*/.test(lang)) {
      use_lang = 'json';
    }

    if (use_lang && hljs.getLanguage(use_lang)) {
      try {

        const highlighted = hljs.highlight(str, { language: use_lang, ignoreIllegals: true }).value;

        // we're applying the `hljs` class to the button to ensure 
        // it's visible over the styled content background
        
        return [
          `<div class="code-container">`,
            `<details class="hljs">`,
              `<summary><span>Code: ${lang}</span></summary>`,
              highlighted,
            `</details>`,
          `</div>`   
        ].join('');

      } catch {
        // ...
      }
    }

    return ''; // use external default escaping
  }
});

if (typeof window !== 'undefined') {

  const abstract = katex as any;
  if (typeof abstract === 'object' && 'default' in abstract) {
    md.use((katex as any).default);
  }
  else {
    md.use(katex);    
  }
  md.use(markdownItLinkAttributes, {
  attrs: {
    target: "_blank",
    rel: "noopener", // It is a best practice to add rel="noopener" for security
  },
});
  md.enable('linkify');
}

export const Format = (text: string) => md.render(text);

