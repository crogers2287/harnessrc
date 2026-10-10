import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function SessionDrawer({
  open,
  close,
  children,
}: {
  open: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 767px)').matches);
  const [drag, setDrag] = useState<number>();
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const media = matchMedia('(max-width: 767px)');
    const changed = () => setMobile(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (!mobile || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, [mobile, open]);
  useEffect(() => {
    if (!mobile) return;
    let start: { x: number; y: number; width: number; moved: boolean } | undefined;
    const begin = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'button, a, input, textarea, select, summary, [role=button], [contenteditable=true]',
        )
      )
        return;
      const touch = event.touches[0];
      if (!open && touch.clientX > 56) return;
      start = {
        x: touch.clientX,
        y: touch.clientY,
        width: panel.current?.offsetWidth ?? 320,
        moved: false,
      };
    };
    const move = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (!start.moved && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.4) {
        start = undefined;
        return;
      }
      if (Math.abs(dx) < 10 && !start.moved) return;
      start.moved = true;
      if (event.cancelable) event.preventDefault();
      setDrag(Math.min(start.width, Math.max(0, (open ? start.width : 0) + dx)));
    };
    const end = (event: TouchEvent) => {
      if (start?.moved) {
        const dx = event.changedTouches[0].clientX - start.x;
        if (open && dx < -55) closeRef.current();
        else if (!open && dx > 55) window.dispatchEvent(new Event('relay-open-sessions'));
      }
      start = undefined;
      setDrag(undefined);
    };
    const cancel = () => {
      start = undefined;
      setDrag(undefined);
    };
    window.addEventListener('touchstart', begin, { passive: true });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', cancel);
    return () => {
      window.removeEventListener('touchstart', begin);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', cancel);
    };
  }, [mobile, open]);
  const visible = open || drag !== undefined;
  return (
    <>
      {mobile && visible && (
        <button
          className="drawer-backdrop"
          aria-label="Dismiss session drawer"
          onClick={close}
          tabIndex={-1}
        />
      )}
      <aside
        ref={panel}
        id="session-drawer"
        className={`sidebar ${open ? 'drawer-open' : ''} ${drag !== undefined ? 'drawer-dragging' : ''}`}
        role={mobile ? 'dialog' : undefined}
        aria-modal={mobile && visible ? true : undefined}
        aria-label="Sessions"
        inert={mobile && !visible}
        style={
          mobile && drag !== undefined
            ? { transform: `translateX(calc(-100% + ${drag}px))` }
            : undefined
        }
        onKeyDown={(event) => {
          if (!mobile || !open) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input, select, a[href]',
            ) ?? [],
          );
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {mobile && (
          <button className="drawer-close" aria-label="Close sessions" onClick={close}>
            <X size={21} />
          </button>
        )}
        {children}
      </aside>
    </>
  );
}
