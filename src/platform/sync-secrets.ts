import { Capacitor, registerPlugin } from '@capacitor/core';
import { AppError } from '../core/errors';
import { invoke } from '@tauri-apps/api/core';
import { nativeMailSyncSupported } from './native-mail-sync';

type SecretName = 'group-key' | 'mail-credentials';
const native = registerPlugin<{
  store(options:{name:SecretName;value:string}):Promise<void>;
  load(options:{name:SecretName}):Promise<{value:string|null}>;
  remove(options:{name:SecretName}):Promise<void>;
}>('SyncSecrets');

/** Fail closed on unsupported platforms. Never substitute SQLite/localStorage. */
export function syncSecretStore() {
  if (!nativeMailSyncSupported()) throw new AppError('secureStorageUnavailable');
  const desktop = Capacitor.getPlatform() !== 'android';
  return {
    async store(name:SecretName,value:string):Promise<void> {
      if (value.length > 16384) throw new AppError('invalidSyncSecret');
      if (desktop) await invoke<void>('sync_secret_store',{name,value});
      else await native.store({name,value});
    },
    async load(name:SecretName):Promise<string|null> {
      return desktop ? await invoke<string|null>('sync_secret_load',{name}) : (await native.load({name})).value;
    },
    async remove(name:SecretName):Promise<void> {
      if(desktop) await invoke<void>('sync_secret_remove',{name});
      else await native.remove({name});
    },
  };
}
