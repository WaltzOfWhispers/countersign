import { app as electronApp, BrowserWindow } from 'electron';

import { createAgentWalletApp } from '../app.js';
import { resolveElectronAppConfig } from './config.js';

let countersignServer;

async function startEmbeddedServer() {
  const config = resolveElectronAppConfig();
  const app = createAgentWalletApp({
    dataFile: config.dataFile,
    walletDir: config.walletDir,
    publicDir: config.publicDir
  });

  countersignServer = await app.start({
    port: config.port,
    host: '127.0.0.1'
  });

  return config;
}

async function createWindow() {
  const config = await startEmbeddedServer();
  const window = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    title: 'Countersign',
    backgroundColor: '#f8f2e8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await window.loadURL(config.serverUrl);
}

electronApp.whenReady().then(async () => {
  await createWindow();

  electronApp.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

electronApp.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    electronApp.quit();
  }
});

electronApp.on('before-quit', async () => {
  if (countersignServer) {
    await new Promise((resolve, reject) => {
      countersignServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }).catch(() => undefined);
  }
});
