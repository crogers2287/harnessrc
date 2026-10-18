import type { SourceEvent } from './index.ts';
export type NativeFile = { path: string; description: string };
export function mediaKind(path: string): 'image' | 'video' | 'audio' | 'file' {
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(path)) return 'image';
  if (/\.(mp4|m4v|webm|mov)$/i.test(path)) return 'video';
  if (/\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(path)) return 'audio';
  return 'file';
}
const downloadable =
  /\.(png|jpe?g|webp|gif|avif|mp4|m4v|webm|mov|mp3|m4a|wav|ogg|flac|aac|json|csv|tsv|txt|md|pdf|zip|tar|gz|yaml|yml|html|svg|docx|xlsx|pptx|py|js|ts)$/i;
const validPath = (path: string) =>
  path.startsWith('/') && !path.startsWith('//') && !path.includes('\0');
/** Only explicit native publications or named assistant file references grant reads. */
export function nativeFiles(event: Pick<SourceEvent, 'kind' | 'data'>): NativeFile[] {
  if (event.kind === 'artifact.created' && Array.isArray(event.data.nativeFiles))
    return event.data.nativeFiles
      .filter(
        (f): f is NativeFile =>
          typeof f?.path === 'string' && validPath(f.path) && typeof f.description === 'string',
      )
      .slice(0, 32);
  if (event.kind !== 'assistant.message') return [];
  const result: NativeFile[] = [];
  const text = String(event.data.text ?? '').replace(/```[^\n]*\n[\s\S]*?```/g, '');
  // Keep historic image indices stable for older installed clients.
  const add = (raw: string, description: string, imageOnly: boolean) => {
    let path: string;
    try {
      path = decodeURIComponent(raw);
    } catch {
      return;
    }
    if (!validPath(path) || !downloadable.test(path) || (imageOnly && mediaKind(path) !== 'image'))
      return;
    if (!imageOnly && result.some((f) => f.path === path)) return;
    if (result.length < 32) result.push({ path, description });
  };
  for (const m of text.matchAll(/!\[([^\]]*)\]\(<?(\/[^\s<>]+?)>?(?:\s+"[^"]*")?\)/g))
    add(m[2], m[1], true);
  for (const m of text.matchAll(/!?\[([^\]]*)\]\(<?(\/[^\s<>]+?)>?(?:\s+"[^"]*")?\)/g))
    add(m[2], m[1], false);
  return result;
}
