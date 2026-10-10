import { IconButton as OpenUIIconButton } from '@openuidev/react-ui/IconButton';
export { Button } from '@openuidev/react-ui/Button';
export { TextArea } from '@openuidev/react-ui/TextArea';
import type { ReactNode, ButtonHTMLAttributes } from 'react';
export function Status({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      <span aria-hidden="true" className="status-dot" />
      {status === 'blocked' ? 'Needs attention' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <OpenUIIconButton
      variant="tertiary"
      size="large"
      type="button"
      icon={children}
      {...props}
      className={`icon-button ${props.className ?? ''}`}
      aria-label={label}
      title={label}
    />
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
