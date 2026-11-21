import {describe,expect,it} from 'vitest';
import {qrcodegen} from '../../src/vendor/qrcodegen';
import {createSyncInvitation,parseSyncInvitation} from '../../src/core/sync-pairing';
describe('M6 offline QR encoder',()=>{
  it('builds a deterministic, scannable QR grid for a 256-bit key invitation without networking',()=>{
    const dataset='12345678-1234-4123-8123-123456789abc';
    const source='87654321-4321-4433-8433-123456789abc';
    const key=crypto.getRandomValues(new Uint8Array(32));
    const invite=createSyncInvitation(dataset,source,key);
    expect(parseSyncInvitation(invite).secret).toEqual(key);
    const qr=qrcodegen.QrCode.encodeText(invite,qrcodegen.QrCode.Ecc.MEDIUM);
    const second=qrcodegen.QrCode.encodeText(invite,qrcodegen.QrCode.Ecc.MEDIUM);
    expect(qr.size).toBeGreaterThan(25);
    expect(qr.size).toBeLessThanOrEqual(177);
    for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)
      expect(qr.getModule(x,y)).toBe(second.getModule(x,y));
    expect(qr.getModule(-1,0)).toBe(false);
  });
});
