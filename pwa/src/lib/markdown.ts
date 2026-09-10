import DOMPurify from 'dompurify';
import { Marked, Renderer } from 'marked';

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const markdown = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // Agent output is not trusted HTML. Show it literally, including during streaming.
    html: ({ text }) => escape(text),
    // Don't fetch remote images/tracking pixels automatically; keep their alt text.
    image: ({ text }) => escape(text),
    table(token) {
      return `<div class="table-scroll" role="region" aria-label="Table" tabindex="0">${Renderer.prototype.table.call(this, token)}</div>`;
    },
  },
});

/** The only HTML boundary for agent replies, both live and persisted. */
export function renderMarkdown(text: string): string {
  const fragment = DOMPurify.sanitize(markdown.parse(text, { async: false }), {
    ALLOWED_TAGS: [
      'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del',
      'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'code', 'a',
      'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'class', 'align', 'start', 'type', 'checked', 'disabled',
      'role', 'aria-label', 'tabindex',
    ],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });

  for (const link of fragment.querySelectorAll('a')) {
    const href = link.getAttribute('href');
    // Also reject relative/file links: they cannot resolve against an agent's repo here.
    if (!href || !/^(https?:\/\/|mailto:)/i.test(href)) {
      link.removeAttribute('href');
      continue;
    }
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }

  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}
