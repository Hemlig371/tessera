import {describe,expect,it} from 'vitest';
import {createSyncInvitation,parseSyncInvitation} from '../../src/core/sync-pairing';
const dataset='12345678-1234-4123-8123-123456789abc';
describe('M6 QR secret handoff',()=>{
  it('roundtrips a 256-bit key and rejects malformed or tampered invitations',()=>{
    const secret=crypto.getRandomValues(new Uint8Array(32));
    const invitation=createSyncInvitation(dataset,secret);
    expect(parseSyncInvitation(invitation)).toEqual({datasetId:dataset,secret});
    for(const value of ['',invitation+'garbage',JSON.stringify({...JSON.parse(invitation),version:2}),
      JSON.stringify({...JSON.parse(invitation),group_key:'AAAA'}),
      JSON.stringify({...JSON.parse(invitation),extra:1})])
      expect(()=>parseSyncInvitation(value)).toThrow('invalidSyncInvitation');
  });
});
