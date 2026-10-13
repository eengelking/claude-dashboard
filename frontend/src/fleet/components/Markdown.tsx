import type { ReactNode } from "react";

// A small markdown renderer for an agent's task prompt and final answer (issue #97). It builds React
// elements and never an HTML string, so raw HTML in the text is shown as text and nothing is injected
// (SPEC 7.7). Supported: headings, ordered and unordered lists, block quotes, fenced code, paragraphs,
// and inline code, bold, italic and links. Lists are flat; anything else shows as plain text.

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

// code span | bold | italic (* or _) | link
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|\*([^\s*][^*\n]*?)\*|(?<![A-Za-z0-9])_([^\s_][^_\n]*?)_(?![A-Za-z0-9])|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function inline(src: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(src.slice(last, at));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>);
    else if (m[2] !== undefined || m[3] !== undefined) out.push(<strong key={key}>{inline((m[2] ?? m[3])!, key)}</strong>);
    else if (m[4] !== undefined || m[5] !== undefined) out.push(<em key={key}>{inline((m[4] ?? m[5])!, key)}</em>);
    else if (m[6] !== undefined && m[7] !== undefined) {
      if (SAFE_HREF.test(m[7])) {
        out.push(
          <a key={key} href={m[7]} target="_blank" rel="noopener noreferrer">
            {inline(m[6], key)}
          </a>,
        );
      } else {
        out.push(m[6]);
      }
    }
    last = at + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: string[] | null = null;
  let k = 0;

  const flushPara = () => {
    if (para.length) blocks.push(<p key={k++}>{inline(para.join(" "), `p${k}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const id = k++;
      const items = list.items.map((t, i) => <li key={i}>{inline(t, `l${id}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={id}>{items}</ol> : <ul key={id}>{items}</ul>);
    }
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push(<blockquote key={k++}>{inline(quote.join(" "), `q${k}`)}</blockquote>);
    quote = [];
  };
  const flushFence = () => {
    if (fence) {
      blocks.push(
        <pre key={k++}>
          <code>{fence.join("\n")}</code>
        </pre>,
      );
    }
    fence = null;
  };
  const flushText = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence !== null) {
      if (/^\s*```/.test(line)) flushFence();
      else fence.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushText();
      fence = [];
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flushText();
      const Tag = `h${m[1]!.length}` as "h1";
      blocks.push(<Tag key={k++}>{inline(m[2]!.trim(), `h${k}`)}</Tag>);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      flushQuote();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(m[1]!);
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      flushPara();
      flushQuote();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(m[1]!);
    } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      flushPara();
      flushList();
      quote.push(m[1]!);
    } else if (!line.trim()) {
      flushText();
    } else {
      flushList();
      flushQuote();
      para.push(line.trim());
    }
  }
  flushFence();
  flushText();
  return <>{blocks}</>;
}
