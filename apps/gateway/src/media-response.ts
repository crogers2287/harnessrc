import type { FastifyRequest, FastifyReply } from 'fastify';
/** Only passive media can render inline; HTML/SVG and all other files remain downloads. */
export function sendMedia(
  req: FastifyRequest,
  reply: FastifyReply,
  name: string,
  mime: string,
  bytes: Buffer,
) {
  const type = mime.split(';')[0].toLowerCase();
  const inline =
    /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|x-wav|ogg|flac|aac))$/.test(
      type,
    );
  reply
    .header('Cache-Control', 'private, no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "sandbox; default-src 'none'")
    .header('Accept-Ranges', 'bytes')
    .header(
      'Content-Disposition',
      `${inline && (req.query as { download?: string }).download !== '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    )
    .type(inline ? type : 'application/octet-stream');
  const range = req.headers.range;
  const size = bytes.length;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1]
      ? Number(match[1])
      : match?.[2]
        ? Math.max(0, size - Number(match[2]))
        : NaN;
    const end = match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || start < 0 || start >= size || end < start)
      return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    return reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', end - start + 1)
      .send(bytes.subarray(start, end + 1));
  }
  return reply.header('Content-Length', size).send(bytes);
}
