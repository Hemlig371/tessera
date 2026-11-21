import { AppError } from './errors';
import { canonical, UUID_RE, type JsonValue } from './model';
import { decodeLocalPacket, parseLocalReceipt } from './sync-protocol';

/** M6 authenticated wire envelope. Only opaque bytes reach the transport. */
export type SecureKind = 'packet' | 'receipt' | 'chunk';
export interface SecureHeader {
  format: 'tessera-secure-sync';
  version: 1;
  dataset_id: string;
  sender_id: string;
  kind: SecureKind;
  message_id: string;
  offset?: number;
}
export interface SecureEnvelope extends SecureHeader {
  nonce: string;
  ciphertext: string;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_PLAINTEXT = 1400 * 1024;
const MAX_WIRE = 2 * 1024 * 1024;
const fail = (): never => { throw new AppError('invalidSyncPacket'); };
const isObject = (x: unknown): x is Record<string,unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const uuid = (x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x);
const base64 = (bytes: Uint8Array): string => {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(raw);
};
function unbase64(value: unknown, max: number): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(max / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return fail();
  try {
    const raw = atob(value);
    if (raw.length > max) return fail();
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    if (base64(out) !== value) return fail();
    return out;
  } catch { return fail(); }
}
function header(x: SecureHeader): Uint8Array {
  return encoder.encode(canonical(x as unknown as JsonValue));
}
function parse(input: unknown): SecureEnvelope {
  if (!isObject(input) || input.format !== 'tessera-secure-sync' || input.version !== 1 ||
      !uuid(input.dataset_id) || !uuid(input.sender_id) || !uuid(input.message_id) ||
      !['packet','receipt','chunk'].includes(String(input.kind)) ||
      (input.kind === 'chunk'
        ? (!Number.isSafeInteger(input.offset) || (input.offset as number) < 0 ||
          Object.keys(input).sort().join(',') !==
          'ciphertext,dataset_id,format,kind,message_id,nonce,offset,sender_id,version')
        : (input.offset !== undefined || Object.keys(input).sort().join(',') !==
          'ciphertext,dataset_id,format,kind,message_id,nonce,sender_id,version'))) return fail();
  return input as unknown as SecureEnvelope;
}
/** The 32-byte group secret must come from OS secure storage, never SQLite or a log. */
export async function importGroupKey(secret: Uint8Array): Promise<CryptoKey> {
  if (!(secret instanceof Uint8Array) || secret.byteLength !== 32) return fail();
  return crypto.subtle.importKey('raw',new Uint8Array(secret),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
function validatePayload(kind: SecureKind, plain: Uint8Array, h: SecureHeader): void {
  if (kind === 'chunk') return;
  try {
    if (kind === 'packet') {
      const packet = decodeLocalPacket(plain);
      if (packet.dataset_id !== h.dataset_id || packet.sender_id !== h.sender_id ||
          packet.packet_id !== h.message_id) fail();
    } else {
      const receipt = parseLocalReceipt(JSON.parse(decoder.decode(plain)) as unknown);
      if (receipt.dataset_id !== h.dataset_id || receipt.receiver_id !== h.sender_id ||
          receipt.packet_id !== h.message_id) fail();
    }
  } catch { fail(); }
}
/** New random 96-bit IV per transmission (including retries). No nonce is derived from a sequence. */
export async function sealSyncBytes(
  key: CryptoKey, metadata: Omit<SecureHeader,'format'|'version'>, plain: Uint8Array
): Promise<Uint8Array> {
  if (!(plain instanceof Uint8Array) || plain.byteLength > MAX_PLAINTEXT ||
      (plain.byteLength === 0 && metadata.kind !== 'chunk') || key.algorithm.name !== 'AES-GCM' || !key.usages.includes('encrypt')) return fail();
  const h: SecureHeader = {format:'tessera-secure-sync',version:1,...metadata};
  if (!uuid(h.dataset_id) || !uuid(h.sender_id) || !uuid(h.message_id) ||
      !['packet','receipt','chunk'].includes(h.kind) ||
      (h.kind === 'chunk' ? !Number.isSafeInteger(h.offset) || h.offset! < 0 : h.offset !== undefined)) return fail();
  validatePayload(h.kind,plain,h);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {name:'AES-GCM',iv:nonce,additionalData:header(h),tagLength:128},key,new Uint8Array(plain)));
  const wire = encoder.encode(canonical({...h,nonce:base64(nonce),ciphertext:base64(ciphertext)} as JsonValue));
  if (wire.length > MAX_WIRE) return fail();
  return wire;
}
export function inspectSecureHeader(wire: Uint8Array): SecureHeader {
  return parseWire(wire).header;
}
function parseWire(wire: Uint8Array) {
  if (!(wire instanceof Uint8Array) || wire.length === 0 || wire.length > MAX_WIRE) return fail();
  let envelope: SecureEnvelope;
  try { envelope = parse(JSON.parse(decoder.decode(wire)) as unknown); }
  catch { return fail(); }
  const nonce = unbase64(envelope.nonce,12);
  const ciphertext = unbase64(envelope.ciphertext,MAX_PLAINTEXT+16);
  if (nonce.length !== 12 || ciphertext.length < 16) return fail();
  const h: SecureHeader = {format:envelope.format,version:envelope.version,
    dataset_id:envelope.dataset_id,sender_id:envelope.sender_id,
    kind:envelope.kind,message_id:envelope.message_id,
    ...(envelope.kind === 'chunk' ? {offset:envelope.offset} : {})};
  return {header:h,nonce,ciphertext};
}
/** Authentication is checked before any packet parsing or SQLite effects. */
export async function openSyncBytes(
  key: CryptoKey, wire: Uint8Array, expected: {dataset_id: string;kind?: SecureKind}
): Promise<{header: SecureHeader; bytes: Uint8Array}> {
  const {header:h,nonce,ciphertext} = parseWire(wire);
  if (h.dataset_id !== expected.dataset_id || (expected.kind && h.kind !== expected.kind) ||
      key.algorithm.name !== 'AES-GCM' || !key.usages.includes('decrypt')) return fail();
  try {
    const bytes = new Uint8Array(await crypto.subtle.decrypt(
      {name:'AES-GCM',iv:nonce,additionalData:header(h),tagLength:128},key,new Uint8Array(ciphertext)));
    validatePayload(h.kind,bytes,h);
    return {header:h,bytes};
  } catch { return fail(); }
}
