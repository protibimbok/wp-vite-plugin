import type { Rolldown } from 'vite';

export type Watcher = Rolldown.RolldownWatcher;

export function isWatcher(result: unknown): result is Watcher {
  return !!result && typeof result === 'object' && 'on' in result && typeof result.on === 'function';
}

// Settles after the first build (successful or not); `onRebuilt` fires for later ones only.
export function watchBuilds(watcher: Watcher, onRebuilt?: () => void): Promise<void> {
  return new Promise((resolve) => {
    let initial = true;
    watcher.on('event', (event) => {
      if (event.code === 'BUNDLE_END' && !initial) onRebuilt?.();
      if (event.code === 'END' || event.code === 'ERROR') {
        initial = false;
        resolve();
      }
    });
  });
}
