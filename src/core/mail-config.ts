import { AppError } from './errors';
import { UUID_RE } from './model';

export interface MailSyncConfig {
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  user: string;
  address: string;
  peers: string[];
  schedule: 'manual' | '15min';
}
const fail = (): never => { throw new AppError('invalidSyncConfig'); };
export function validateMailSyncConfig(value: MailSyncConfig, deviceId: string): MailSyncConfig {
  if (!value || typeof value !== 'object' || !UUID_RE.test(deviceId) ||
      !/^[a-zA-Z0-9.-]{1,253}$/.test(value.smtpHost) ||
      !/^[a-zA-Z0-9.-]{1,253}$/.test(value.imapHost) ||
      !Number.isSafeInteger(value.smtpPort) || value.smtpPort < 1 || value.smtpPort > 65535 ||
      !Number.isSafeInteger(value.imapPort) || value.imapPort < 1 || value.imapPort > 65535 ||
      typeof value.user !== 'string' || value.user.length < 1 || value.user.length > 254 ||
      /[\r\n\0]/.test(value.user) ||
      typeof value.address !== 'string' || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]{1,253}$/.test(value.address) ||
      !Array.isArray(value.peers) || value.peers.length > 32 ||
      value.peers.some(p => !UUID_RE.test(p) || p === deviceId) ||
      new Set(value.peers).size !== value.peers.length ||
      !['manual','15min'].includes(value.schedule) ||
      Object.keys(value).sort().join(',') !==
        'address,imapHost,imapPort,peers,schedule,smtpHost,smtpPort,user') return fail();
  return {...value,peers:[...value.peers]};
}
