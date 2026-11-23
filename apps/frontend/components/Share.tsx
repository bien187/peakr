'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Popover } from './PeakrChrome';

/** Kopiert Text; ältere Browser bzw. Seiten ohne Clipboard-Recht über ein unsichtbares Textfeld. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Knopf mit Fenster: «Link kopieren» und – wo der Browser es kann – «Teilen …»
 * über das Teilen-Menü des Systems (WhatsApp, Nachrichten, Mail …).
 */
export function ShareButton({
  url,
  title,
  text,
  label = 'Teilen',
  icon = 'Share2',
  className = 'btn btn-soft',
  align = 'left',
}: {
  url: string;
  title: string;
  text?: string;
  label?: string;
  icon?: string;
  className?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);
  useEffect(() => {
    if (!open) setState('idle');
  }, [open]);

  const copy = async () => {
    setState((await copyText(url)) ? 'copied' : 'failed');
  };

  const share = async () => {
    try {
      await navigator.share({ title, text, url });
      setOpen(false);
    } catch (err) {
      // Abbrechen im System-Menü ist kein Fehler.
      if ((err as { name?: string })?.name !== 'AbortError') setState('failed');
    }
  };

  return (
    <div className="share" style={{ position: 'relative' }}>
      <button type="button" className={className} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name={icon} size={16} stroke={2} /> {label}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align={align}>
        <div className="pop-list">
          <button type="button" className={'pop-item' + (state === 'copied' ? ' is-on' : '')} onClick={copy}>
            <Icon name={state === 'copied' ? 'Check' : 'Link'} size={15} stroke={2} />
            {state === 'copied' ? 'Link kopiert' : 'Link kopieren'}
          </button>
          {canShare && (
            <button type="button" className="pop-item" onClick={share}>
              <Icon name="Share2" size={15} stroke={2} /> Teilen …
            </button>
          )}
        </div>
        {state === 'failed' && (
          <input className="input share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
        )}
      </Popover>
    </div>
  );
}
