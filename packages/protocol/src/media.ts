import type { SourceEvent } from './index.ts';
export type NativeFile = { path: string; description: string };
/** Only explicit native publications or image references in assistant messages grant reads. */
export function nativeFiles(event: Pick<SourceEvent, 'kind' | 'data'>): NativeFile[] {
  if (event.kind === 'artifact.created' && Array.isArray(event.data.nativeFiles))
    return event.data.nativeFiles
      .filter(
        (f): f is NativeFile =>
          typeof f?.path === 'string' &&
          f.path.startsWith('/') &&
          !f.path.startsWith('//') &&
          !f.path.includes('\0') &&
          typeof f.description === 'string',
      )
      .slice(0, 32);
  if (event.kind !== 'assistant.message') return [];
  const result: NativeFile[] = [];
  const text = String(event.data.text ?? '');
  for (const m of text.matchAll(/!\[([^\]]*)\]\(<?(\/[^\s<>]+?)>?(?:\s+"[^"]*")?\)/g)) {
    let path = m[2];
    try {
      path = decodeURI(path);
    } catch {
      continue;
    }
    if (path.startsWith('//') || path.includes('\0') || !/\.(png|jpe?g|webp|gif|avif)$/i.test(path))
      continue;
    result.push({ path, description: m[1] });
    if (result.length === 32) break;
  }
  return result;
}
