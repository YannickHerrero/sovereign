/**
 * Minimal, safe markdown for agent replies: paragraphs, headings, bullet lists, fenced code,
 * inline code, bold, and auto-linked URLs. Everything is HTML-escaped first.
 */

export interface Block {
  kind: 'heading' | 'paragraph' | 'list' | 'code';
  html: string;
  items?: string[];
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const URL_RE = /\b((?:https?:\/\/|localhost:)[^\s<)]+[^\s<).,;:!?])/g;

export function inline(text: string): string {
  let html = escape(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(URL_RE, (url) => {
    const href = url.startsWith('http') ? url : `http://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener">${url}</a>`;
  });
  return html;
}

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push({ kind: 'code', html: escape(code.join('\n')) });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: 'heading', html: inline(heading[1]) });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*[-*]\s+/, '')));
        i++;
      }
      out.push({ kind: 'list', html: '', items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !/^#{1,6}\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push({ kind: 'paragraph', html: inline(para.join(' ')) });
  }
  return out;
}
