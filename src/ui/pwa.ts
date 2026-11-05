import { useEffect, useState } from 'react';

/** Browser event for the PWA install prompt (not in lib.dom). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** `install` is non-null while the browser offers to install the app. */
export function useInstallPrompt(): { install: (() => Promise<void>) | null } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (!deferred) return { install: null };
  const ev = deferred;
  return {
    install: async () => {
      await ev.prompt();
      await ev.userChoice;
      deferred = null;
      listeners.forEach((l) => l());
    },
  };
}

/** Registers the service worker (production only) and announces updates to the UI. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(() => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          // A new version took over while the page was already controlled: offer a reload.
          if (hadController) window.dispatchEvent(new Event('pp-update-ready'));
        });
      })
      .catch(() => {
        /* offline support is a bonus, never fatal */
      });
  });
}

export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener('pp-update-ready', on);
    return () => window.removeEventListener('pp-update-ready', on);
  }, []);
  return ready;
}
