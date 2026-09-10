import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

function render(text: string): HTMLDivElement {
  const element = document.createElement('div');
  element.innerHTML = renderMarkdown(text);
  return element;
}

const table = '| Chemin | Branche | Rôle |\n|:---|:---:|---:|\n| `~/dev/projet` | `main` | Actuel |\n| `~/worktree` | `fix/bug` | Correction |';

describe('agent Markdown', () => {
  it('renders the worktree table rather than collapsing its rows into a paragraph', () => {
    const root = render(table);
    expect(root.querySelectorAll('thead th')).toHaveLength(3);
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(root.querySelector('td code')?.textContent).toBe('~/dev/projet');
    expect(root.querySelectorAll('th')[1].getAttribute('align')).toBe('center');
    expect(root.querySelectorAll('th')[2].getAttribute('align')).toBe('right');
    expect(root.querySelector('.table-scroll')?.getAttribute('tabindex')).toBe('0');
  });

  it('handles escaped pipes and CRLF in tables', () => {
    const root = render('| A | B |\r\n|---|---|\r\n| a\\|b | `x\\|y` |');
    expect([...root.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['a|b', 'x|y']);
  });

  it('preserves heading levels, nested and multiline numbered lists', () => {
    const root = render('# Title\n\n### Subtitle\n\n3. First\n   continuation\n   - Child\n4. Second');
    expect(root.querySelector('h1')?.textContent).toBe('Title');
    expect(root.querySelector('h3')?.textContent).toBe('Subtitle');
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(root.querySelectorAll('ol > li')).toHaveLength(2);
    expect(root.querySelector('ol > li > ul > li')?.textContent).toBe('Child');
    expect(root.querySelector('ol > li')?.textContent).toContain('continuation');
  });

  it('renders emphasis, quotes, separators, hard breaks and disabled tasks', () => {
    const root = render('> *Italic* **Bold** ~~Deleted~~\n\n---\n\nLine 1  \nLine 2\nsoft break\n\n- [x] Done\n- [ ] Pending');
    expect(root.querySelector('blockquote em')?.textContent).toBe('Italic');
    expect(root.querySelector('strong')?.textContent).toBe('Bold');
    expect(root.querySelector('del')?.textContent).toBe('Deleted');
    expect(root.querySelectorAll('hr')).toHaveLength(1);
    expect(root.querySelectorAll('br')).toHaveLength(1);
    const tasks = [...root.querySelectorAll('input')];
    expect(tasks.map((input) => [input.type, input.checked, input.disabled])).toEqual([
      ['checkbox', true, true], ['checkbox', false, true],
    ]);
  });

  it('keeps code literal and preserves fences, language and whitespace', () => {
    const root = render('`**literal** https://example.com`\n\n``a `backtick` here``\n\n~~~ts\n  <tag>\n\n**not bold**\n~~~');
    expect(root.querySelectorAll('strong, a, tag')).toHaveLength(0);
    expect(root.querySelector('code')?.textContent).toBe('**literal** https://example.com');
    expect(root.querySelectorAll('code')[1].textContent).toBe('a `backtick` here');
    expect(root.querySelector('pre > code.language-ts')?.textContent).toBe('  <tag>\n\n**not bold**\n');
  });

  it('renders explicit links, autolinks and reference links with safe new tabs', () => {
    const root = render('[Docs](https://example.com "Documentation") https://example.org\n\n[Reference][ref]\n\n[ref]: http://localhost:3000');
    const links = [...root.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual(['Docs', 'https://example.org', 'Reference']);
    for (const link of links) {
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
    }
    expect(links[0].title).toBe('Documentation');
  });

  it('shows raw HTML literally and never loads remote images', () => {
    const source = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<svg onload=alert(1)>\n\n![Diagram](https://example.com/tracker.png)\n\n<input type="checkbox">';
    const root = render(source);
    expect(root.querySelectorAll('script, img, svg, input')).toHaveLength(0);
    expect(root.textContent).toContain('<script>alert(1)</script>');
    expect(root.textContent).toContain('Diagram');
  });

  it.each([
    'javascript:alert%281%29', 'JaVaScRiPt:alert%281%29', 'javascript&#58;alert%281%29',
    'java&#x09;script:alert%281%29', 'data:text/html,evil', 'vbscript:evil',
    'file:///etc/passwd', '/api/tasks', '//example.com',
  ])('neutralizes unsafe or unresolvable link %s', (href) => {
    const root = render(`[Click](${href})`);
    expect(root.querySelectorAll('a[href]')).toHaveLength(0);
    expect(root.textContent).toContain('Click');
  });

  it('does not let quotes in links or fence info inject attributes', () => {
    const root = render('[Click](https://example.com/"onmouseover="evil)\n\n```ts" onclick="evil\n<tag>\n```');
    expect(root.querySelectorAll('[onclick], [onmouseover], tag')).toHaveLength(0);
  });

  it('handles every streaming prefix safely and converges to the complete document', () => {
    const source = `${table}\n\n[Docs](https://example.com)\n\n\`\`\`ts\n<script>alert(1)</script>\n\`\`\``;
    let streamed = '';
    for (const char of source) {
      streamed += char;
      const root = render(streamed);
      expect(root.querySelectorAll('script, img, [onerror]')).toHaveLength(0);
    }
    expect(renderMarkdown(streamed)).toBe(renderMarkdown(source));
    const partialCode = render('```js\nconst x = "<tag>";');
    expect(partialCode.querySelector('pre code')?.textContent).toContain('const x = "<tag>";');
  });
});
