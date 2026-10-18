import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 20 * 1024 * 1024;
const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
};

/** Caller must authorize the exact transcript reference and a configured local-files host. */
export async function readNativeFile(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw Object.assign(new Error('Not a regular file'), { statusCode: 404 });
    if (stat.size > MAX_BYTES)
      throw Object.assign(new Error('File exceeds 20 MB'), { statusCode: 413 });
    // Bound reads even if another process grows the file after stat().
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, MAX_BYTES + 1 - size));
      const { bytesRead } = await handle.read(buffer);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_BYTES)
        throw Object.assign(new Error('File exceeds 20 MB'), { statusCode: 413 });
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return {
      bytes: Buffer.concat(chunks),
      mime: mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
    };
  } finally {
    await handle.close();
  }
}
