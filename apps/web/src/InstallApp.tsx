import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@harnessrc/client-sdk';
import { Download, Check } from 'lucide-react';
import { useInstall } from './install.ts';
export function InstallApp() {
  const { state, install } = useInstall();
  const native = useQuery<{ available: boolean; version?: string; url?: string }>({
    queryKey: ['android-package'],
    queryFn: () => api('/api/android'),
    retry: false,
  });
  const [help, setHelp] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(navigator.userAgent);
  return (
    <section className="settings-section install-app">
      <h3>Install app</h3>
      {native.data?.available && native.data.url && (
        <div className="install-instructions">
          <strong>Native Android app</strong>
          <p>
            Native keyboard image paste, file sharing and voice recording. Keep Tailscale connected.
          </p>
          <a className="primary" href={native.data.url}>
            Download Android APK · {native.data.version}
          </a>
          <p className="helper">
            Open the download and allow Android to install this package. The browser app remains
            available below.
          </p>
        </div>
      )}
      <p className="helper">Open Relay from your home screen in its own app window.</p>
      {state === 'installed' ? (
        <p role="status">
          <Check size={18} /> Relay is installed on this device.
        </p>
      ) : (
        <>
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => {
              if (state !== 'ready') {
                setHelp(true);
                return;
              }
              setBusy(true);
              setNotice('');
              void install()
                .then((outcome) => {
                  setNotice(
                    outcome === 'accepted'
                      ? 'Installation accepted. Your browser will finish adding Relay.'
                      : 'Installation dismissed. You can install later from your browser menu.',
                  );
                  setHelp(outcome !== 'accepted');
                })
                .catch(() => {
                  setNotice('Your browser could not open the installer. Use its menu instead.');
                  setHelp(true);
                })
                .finally(() => setBusy(false));
            }}
          >
            <Download size={18} />{' '}
            {busy
              ? 'Opening installer…'
              : state === 'ready'
                ? 'Install Relay'
                : 'How to install Relay'}
          </button>
          {help && (
            <div className="install-instructions">
              <p>
                {ios
                  ? 'In Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled and tap Add.'
                  : android
                    ? 'Open your browser’s ⋮ menu, then tap Install app or Add to Home screen. If this is an in-app browser, open Relay in Chrome first.'
                    : 'Use the install icon in your browser’s address bar, or its menu → Install Relay. Chrome and Edge support installing this app.'}
              </p>
              <p className="helper">Keep Tailscale connected to access your agents.</p>
            </div>
          )}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </section>
  );
}
