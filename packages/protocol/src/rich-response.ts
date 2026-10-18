/** OpenUI is an explicit assistant output format, never inferred from ordinary prose. */
export type ResponsePart = { kind: 'text' | 'openui'; text: string };
export function responseParts(text: string): ResponsePart[] {
  const parts: ResponsePart[] = [];
  const pattern = /(?:^|\n)```openui[^\S\n]*\n([\s\S]*?)(?:\n```(?=\n|$)|$)/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > start) parts.push({ kind: 'text', text: text.slice(start, match.index) });
    parts.push({ kind: 'openui', text: match[1].slice(0, 100000) });
    start = match.index! + match[0].length;
  }
  if (start < text.length) parts.push({ kind: 'text', text: text.slice(start) });
  return parts;
}
