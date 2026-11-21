import { afterAll, describe, expect, it } from 'vitest';
import { connect, type TLSSocket } from 'node:tls';
import { fixture } from '../support/fixture';
import { exportDatabaseArchive, importDatabaseArchive } from '../../src/core/database-archive';
import { Repository } from '../../src/core/repository';
import { encryptedSyncMailbox, type OpaqueSyncTransport } from '../../src/core/encrypted-sync-mailbox';
import { importGroupKey, inspectSecureHeader, openSyncBytes } from '../../src/core/secure-sync-envelope';
import { runLocalSyncCycle } from '../../src/core/local-sync-engine';
import type { ArchiveWriter } from '../../src/core/archive-zip';

const HOST = '127.0.0.1', USER = 'sync', ADDRESS = 'sync@localhost', PASSWORD = 'ci-only-mail-password';
const SMTP = 3465, IMAP = 3993;
const decoder = new TextDecoder('utf-8',{fatal:true});
const finished: Array<() => Promise<void>> = [];
afterAll(async()=>{for(const dispose of finished.reverse())await dispose();});

/** Only the isolated test harness trusts GreenMail's self-signed TLS identity.
 * Tessera native SMTP/IMAP uses OS certificate checking; do not alter production TLS.
 */
class Connection {
  private buffered = Buffer.alloc(0);
  private waiting: (()=>void) | null = null;
  private closed = false;
  constructor(private readonly socket: TLSSocket) {
    socket.on('data',(value:Buffer)=>{
      this.buffered = Buffer.concat([this.buffered,value]);
      if(this.waiting) {const wake=this.waiting;this.waiting=null;wake();}
    });
    socket.on('close',()=>{this.closed=true;if(this.waiting){const wake=this.waiting;this.waiting=null;wake();}});
    socket.on('error',()=>{this.closed=true;if(this.waiting){const wake=this.waiting;this.waiting=null;wake();}});
    socket.setTimeout(18000,()=>socket.destroy(new Error('mail timeout')));
  }
  async bytes(n:number):Promise<Buffer>{
    if(n<0||n>3*1024*1024)throw Error('unbounded IMAP literal');
    while(this.buffered.length<n){
      if(this.closed)throw Error('mail connection closed');
      await new Promise<void>(resolve=>{this.waiting=resolve;});
    }
    const value=this.buffered.subarray(0,n);
    this.buffered=this.buffered.subarray(n);
    return value;
  }
  async line():Promise<string>{
    for(;;){
      const pos=this.buffered.indexOf('\n');
      if(pos>=0){
        if(pos>16384)throw Error('mail line too large');
        const line=decoder.decode(await this.bytes(pos+1));
        return line.replace(/\r?\n$/,'');
      }
      if(this.buffered.length>16384)throw Error('mail line too large');
      if(this.closed)throw Error('connection closed waiting for line');
      await new Promise<void>(resolve=>{this.waiting=resolve;});
    }
  }
  write(text:string):void{this.socket.write(text);}
  close():void{this.socket.destroy();}
}
async function open(port:number,verify=false):Promise<Connection>{
  const socket=await new Promise<TLSSocket>((resolve,reject)=>{
    const client=connect({host:HOST,port,servername:'localhost',rejectUnauthorized:verify},()=>resolve(client));
    client.once('error',reject);
    client.setTimeout(18000,()=>client.destroy(new Error('TLS connection timeout')));
  });
  return new Connection(socket);
}
async function smtpStatus(c:Connection,code:number){
  let line=await c.line();
  for(let i=0;i<32;i++){
    if(!line.startsWith(String(code)))throw Error('SMTP status '+line);
    if(line[3]!=='-')return;
    line=await c.line();
  }
  throw Error('unbounded SMTP greeting');
}
async function send(payload:Uint8Array):Promise<void>{
  const h=inspectSecureHeader(payload);
  const offset=h.kind==='chunk'?h.offset!:-1;
  const bytes=Buffer.from(payload).toString('base64');
  const header=[
    'From: <'+ADDRESS+'>','To: <'+ADDRESS+'>','Subject: Sync data','MIME-Version: 1.0',
    'Content-Type: application/octet-stream','Content-Transfer-Encoding: base64',
    'X-Tessera-Wire: 1','X-Tessera-Kind: '+h.kind,
    'X-Tessera-Source: '+h.sender_id,'X-Tessera-Id: '+h.message_id,
    'X-Tessera-Offset: '+offset,
  ].join('\r\n');
  const c=await open(SMTP);
  try{
    await smtpStatus(c,220);
    c.write('EHLO tessera.local\r\n');await smtpStatus(c,250);
    const auth=Buffer.from('\0'+USER+'\0'+PASSWORD).toString('base64');
    c.write('AUTH PLAIN '+auth+'\r\n');await smtpStatus(c,235);
    c.write('MAIL FROM:<'+ADDRESS+'>\r\n');await smtpStatus(c,250);
    c.write('RCPT TO:<'+ADDRESS+'>\r\n');await smtpStatus(c,250);
    c.write('DATA\r\n');await smtpStatus(c,354);
    c.write(header+'\r\n\r\n'+(bytes.match(/.{1,76}/g)??[]).join('\r\n')+'\r\n.\r\n');
    await smtpStatus(c,250);
    c.write('QUIT\r\n');
  }finally{c.close();}
}
interface Fetched {validity:string;maxUid:number;wires:Uint8Array[];count:number}
async function fetchMail(after:number):Promise<Fetched>{
  const c=await open(IMAP);
  let validity='',next=0;
  const result:Uint8Array[]=[];
  let last=after;
  try{
    expect(await c.line()).toMatch(/^\* OK/i);
    c.write('a1 AUTHENTICATE PLAIN\r\n');
    expect(await c.line()).toMatch(/^\+/);
    c.write(Buffer.from('\0'+USER+'\0'+PASSWORD).toString('base64')+'\r\n');
    expect(await c.line()).toMatch(/^a1 OK/i);
    c.write('a2 SELECT INBOX\r\n');
    for(let i=0;i<80;i++){
      const line=await c.line();
      const v=/UIDVALIDITY (\d+)/i.exec(line);
      const n=/UIDNEXT (\d+)/i.exec(line);
      if(v)validity=v[1]!;
      if(n)next=Number(n[1]);
      if(line.startsWith('a2 ')){expect(line).toMatch(/^a2 OK/i);break;}
    }
    if(!validity||next<1)throw Error('IMAP SELECT did not provide UIDVALIDITY and UIDNEXT');
    c.write('a3 UID SEARCH UID '+(after+1)+':'+(next-1)+' HEADER X-Tessera-Wire 1\r\n');
    let ids:number[]=[];
    for(let i=0;i<80;i++){
      const line=await c.line();
      if(line.startsWith('* SEARCH'))ids.push(...line.split(' ').slice(2).map(Number).filter(n=>Number.isSafeInteger(n)&&n>after));
      if(line.startsWith('a3 ')){expect(line).toMatch(/^a3 OK/i);break;}
    }
    ids=Array.from(new Set(ids)).sort((a,b)=>a-b);
    for(const id of ids){
      c.write('a4 UID FETCH '+id+' (UID BODY.PEEK[])\r\n');
      for(let i=0;i<80;i++){
        const line=await c.line();
        const literal=/\{(\d+)\}$/.exec(line);
        if(literal){
          const message=decoder.decode(await c.bytes(Number(literal[1])));
          const split=message.indexOf('\r\n\r\n');
          if(split>=0 && message.slice(0,split).toLowerCase().includes('x-tessera-wire: 1')){
            const data=message.slice(split+4).replace(/\s/g,'');
            result.push(Uint8Array.from(Buffer.from(data,'base64')));
          }
        }
        if(line.startsWith('a4 ')){expect(line).toMatch(/^a4 OK/i);break;}
      }
      last=id;
    }
    if(ids.length===0)last=Math.max(after,next-1);
    c.write('a5 LOGOUT\r\n');
    return {validity,maxUid:last,wires:result,count:ids.length};
  }finally{c.close();}
}
function liveMailTransport():OpaqueSyncTransport{
  return {
    async list(kind){
      return (await fetchMail(0)).wires.filter(w=>inspectSecureHeader(w).kind===kind);
    },
    async send(_kind,bytes){await send(bytes);},
  };
}

describe('GreenMail real SMTP+IMAP TLS protocol, no outside mail account',()=>{
  it('refuses the self-signed server with normal TLS trust (production default)',async()=>{
    await expect(open(SMTP,true)).rejects.toThrow();
    await expect(open(IMAP,true)).rejects.toThrow();
  });
  it('transfers encrypted M5 SQLite changes and authenticated applied ACK over live SMTP/IMAP',async()=>{
    const left=await fixture();finished.push(left.cleanup);
    const a=left.api!;
    const library=await a.createLibrary('GreenMail E2E');
    const collection=await a.createCollection(library.id,'Notes','Text');
    const entry=await a.saveEntry(collection.id,{[collection.primary_field_id]:'private initial value'});
    await a.startLocalSync();
    const chunks:Uint8Array[]=[];
    const writer:ArchiveWriter={write:async data=>{chunks.push(Uint8Array.from(data));},
      finish:async()=>{},abort:async()=>{throw Error('unexpected archive abort');}};
    const manifest=await exportDatabaseArchive(left.db,left.files,writer);
    const zip=Uint8Array.from(Buffer.concat(chunks));
    const right=await fixture('node',false);finished.push(right.cleanup);
    await importDatabaseArchive({name:'snapshot.zip',mime:'application/zip',size:zip.length,
      read:async(offset,length)=>zip.slice(offset,offset+length)},right.db,right.files);
    const b=await Repository.open(right.db,right.files);
    await b.registerLocalArchiveBaseline(a.deviceId,manifest);
    await a.acknowledgeLocalArchiveBaseline(b.deviceId,manifest);
    await b.startLocalSync();
    const edited=await a.saveEntry(collection.id,{[collection.primary_field_id]:'after encrypted SMTP'},entry.id,entry.hlc);
    const key=await importGroupKey(crypto.getRandomValues(new Uint8Array(32)));
    const transport=liveMailTransport();
    const am=encryptedSyncMailbox(transport,key,a.datasetId,a.deviceId);
    const bm=encryptedSyncMailbox(transport,key,b.datasetId,b.deviceId);
    const first=await runLocalSyncCycle(a,am,[b.deviceId],12,1400*1024);
    expect(first.sent).toBeGreaterThan(0);
    const inbox=await fetchMail(0);
    expect(inbox.validity).toMatch(/^\d+$/);
    expect(inbox.wires.length).toBeGreaterThan(0);
    for(const wire of inbox.wires){
      const header=inspectSecureHeader(wire);
      expect(header.dataset_id).toBe(a.datasetId);
      expect(decoder.decode(wire)).not.toContain('after encrypted SMTP');
      const decrypted=await openSyncBytes(key,wire,{dataset_id:a.datasetId});
      expect(decrypted.bytes.length).toBeGreaterThan(0);
    }
    const next=await fetchMail(inbox.maxUid);
    expect(next.wires).toHaveLength(0);
    expect(next.validity).toBe(inbox.validity);
    expect((await b.getEntry(entry.id))?.hlc).not.toBe(edited.hlc);
    await runLocalSyncCycle(b,bm,[a.deviceId],12,1400*1024);
    expect((await b.getEntry(entry.id))?.hlc).toBe(edited.hlc);
    const afterAck=await fetchMail(0);
    expect(afterAck.wires.some(w=>inspectSecureHeader(w).kind==='receipt')).toBe(true);
    await runLocalSyncCycle(a,am,[b.deviceId],12,1400*1024);
    expect((await a.localSyncPeerAck(b.deviceId))!).toBeGreaterThan(manifest.checkpoint.seq);
    for(let n=0;n<2;n++){
      await runLocalSyncCycle(b,bm,[a.deviceId],12,1400*1024);
      await runLocalSyncCycle(a,am,[b.deviceId],12,1400*1024);
    }
    expect((await b.getHistory(entry.id)).versions).toHaveLength(2);
  },120000);
});
