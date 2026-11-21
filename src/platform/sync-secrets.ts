import { Capacitor, registerPlugin } from '@capacitor/core';
import { AppError } from '../core/errors';

type SecretName = 'group-key' | 'mail-credentials';
const native = registerPlugin<{
  store(options:{name:SecretName;value:string}):Promise<void>;
  load(options:{name:SecretName}):Promise<{value:string|null}>;
  remove(options:{name:SecretName}):Promise<void>;
}>('SyncSecrets');

/** Fail closed on unsupported platforms. Never substitute SQLite/localStorage. */
export function syncSecretStore() {
  if (Capacitor.getPlatform() !== 'android') throw new AppError('secureStorageUnavailable');
  return {
    async store(name:SecretName,value:string):Promise<void> {
      if (value.length > 16384) throw new AppError('invalidSyncSecret');
      await native.store({name,value});
    },
    async load(name:SecretName):Promise<string|null> {
      return (await native.load({name})).value;
    },
    async remove(name:SecretName):Promise<void> { await native.remove({name}); },
  };
}
