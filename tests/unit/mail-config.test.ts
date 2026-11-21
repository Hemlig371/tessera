import {describe,expect,it} from 'vitest';
import {validateMailSyncConfig,type MailSyncConfig} from '../../src/core/mail-config';
const device='12345678-1234-4123-8123-123456789abc';
const peer='87654321-4321-4433-8433-123456789abc';
const config:MailSyncConfig={smtpHost:'smtp.example.org',smtpPort:465,imapHost:'imap.example.org',
  imapPort:993,user:'sync@example.org',address:'sync@example.org',peers:[peer],schedule:'manual'};
describe('M6 mail settings',()=>{
  it('accepts a bounded explicit TLS configuration without secrets in SQLite',()=>{
    expect(validateMailSyncConfig(config,device)).toEqual(config);
    expect(JSON.stringify(config)).not.toContain('password');
  });
  it('rejects malformed host, address, peers, schedule and injection',()=>{
    for(const invalid of [
      {...config,smtpHost:'https://smtp.example.org'},
      {...config,imapPort:0},
      {...config,user:'evil\r\nAUTH'},
      {...config,address:'bad\n@example.org'},
      {...config,peers:[device]},
      {...config,peers:[peer,peer]},
      {...config,schedule:'hourly'},
      {...config,secret:'password'},
    ])expect(()=>validateMailSyncConfig(invalid as MailSyncConfig,device)).toThrow('invalidSyncConfig');
  });
});
