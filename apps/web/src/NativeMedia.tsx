import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image } from '@openuidev/react-ui/Image';
import { Button } from '@harnessrc/ui';
import { Download, X } from 'lucide-react';
import { nativeFiles, type Event } from '@harnessrc/protocol';
import { downloadNativeFile } from '@harnessrc/client-sdk';

export function NativeMedia({ event, index }: { event: Event; index: number }) {
  const file = nativeFiles(event)[index];
  const [url, setUrl] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const image = /\.(png|jpe?g|webp|gif|avif)$/i.test(file?.path ?? '');
  const query = useQuery({
    queryKey: ['native-media', event.sessionId, event.id, index],
    queryFn: () => downloadNativeFile(event.sessionId, event.id, index),
    enabled: !!file && image,
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (!query.data) return;
    const value = URL.createObjectURL(query.data);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [query.data]);
  if (!file) return null;
  const name = file.path.split('/').pop() || 'Generated file';
  const title = file.description || name;
  const download = async () => {
    const result = query.data ? query.data : (await query.refetch()).data;
    if (!result) return;
    const value = URL.createObjectURL(result);
    const link = document.createElement('a');
    link.href = value;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(value), 1000);
  };
  return (
    <section className="native-media" aria-label={title}>
      {image &&
        (url ? (
          <button
            type="button"
            className="native-media-preview"
            aria-label={`View ${title}`}
            onClick={() => dialog.current?.showModal()}
          >
            <Image src={url} alt={title} scale="fit" aspectRatio="4:3" />
          </button>
        ) : (
          <div className="native-media-placeholder" role="status">
            {query.isError ? 'Image unavailable' : 'Loading image…'}
          </div>
        ))}
      <div className="native-media-caption">
        <strong>{title}</strong>
        <span>{name}</span>
      </div>
      {query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry file
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => void download()} disabled={query.isFetching}>
          <Download size={18} /> Download
        </Button>
      )}
      {url && image && (
        <dialog ref={dialog} className="image-preview" aria-label={`Preview ${title}`}>
          <header>
            <strong>{title}</strong>
            <button
              className="icon-button"
              aria-label="Close image preview"
              onClick={() => dialog.current?.close()}
            >
              <X size={22} />
            </button>
          </header>
          <img src={url} alt={title} />
          <Button variant="primary" onClick={() => void download()}>
            Download image
          </Button>
        </dialog>
      )}
    </section>
  );
}
export function NativeMediaGallery({ event }: { event: Event }) {
  return (
    <div className="native-media-gallery">
      {nativeFiles(event).map((file, index) => (
        <NativeMedia key={`${index}:${file.path}`} event={event} index={index} />
      ))}
    </div>
  );
}
