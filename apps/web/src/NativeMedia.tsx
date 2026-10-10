import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image } from '@openuidev/react-ui/Image';
import { Button } from '@harnessrc/ui';
import { Download, X } from 'lucide-react';
import { nativeFiles, type Event } from '@harnessrc/protocol';
import { downloadNativeFile } from '@harnessrc/client-sdk';

type Preview = { blob: Blob; title: string; name: string };
const PreviewContext = createContext<(preview: Preview) => void>(() => {});
/** The viewer outlives virtualized message rows and owns its own object URL. */
export function MediaPreviewProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Preview & { url: string }>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!selected) return;
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(selected.url);
  }, [selected]);
  return (
    <PreviewContext.Provider
      value={(value) => setSelected({ ...value, url: URL.createObjectURL(value.blob) })}
    >
      {children}
      {selected && (
        <dialog
          ref={dialog}
          className="image-preview"
          aria-label={`Preview ${selected.title}`}
          onClose={() => setSelected(undefined)}
        >
          <header>
            <strong>{selected.title}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Close image preview"
              onClick={() => dialog.current?.close()}
            >
              <X size={22} />
            </button>
          </header>
          <img src={selected.url} alt={selected.title} />
          <Button
            variant="primary"
            onClick={() => {
              const link = document.createElement('a');
              link.href = selected.url;
              link.download = selected.name;
              link.click();
            }}
          >
            Download image
          </Button>
        </dialog>
      )}
    </PreviewContext.Provider>
  );
}

export function NativeMedia({ event, index }: { event: Event; index: number }) {
  const file = nativeFiles(event)[index];
  const [url, setUrl] = useState('');
  const showPreview = useContext(PreviewContext);
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
            onClick={() => query.data && showPreview({ blob: query.data, title, name })}
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
