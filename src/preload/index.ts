// The only bridge between the page and the main process. The page gets a fixed list
// of named calls and two event subscriptions; it never sees ipcRenderer or Node.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const METHODS = [
  'getState',
  'saveTask',
  'deleteItem',
  'setFlags',
  'previewSimilar',
  'deleteSimilar',
  'restoreSuppressed',
  'updateSettings',
  'sync',
  'searchPlaces',
  'connectGoogle',
  'connectICloud',
  'connectCanvas',
  'disconnect',
  'addFeed',
  'removeFeed',
  'importTasks',
  'exportTasks',
  'loadDemo',
  'clearDemo',
  'clearCache',
  'testNotification',
  'openItem',
  'openHelp',
] as const;

const api: Record<string, unknown> = {};
for (const method of METHODS) {
  api[method] = (...args: unknown[]) => ipcRenderer.invoke('api', method, ...args);
}

function subscribe(channel: string) {
  return (cb: (...args: unknown[]) => void) => {
    const listener = (_event: IpcRendererEvent, ...args: unknown[]): void => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

api.onState = subscribe('state');
api.onCommand = subscribe('command');

contextBridge.exposeInMainWorld('api', api);
