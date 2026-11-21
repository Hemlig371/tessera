import {Capacitor,registerPlugin} from '@capacitor/core';
import {AppError} from '../core/errors';
import {parseSyncInvitation} from '../core/sync-pairing';
import {qrcodegen} from '../vendor/qrcodegen';
import {nativeMailSyncSupported} from './native-mail-sync';
const native=registerPlugin<{
  render(options:{value:string}):Promise<{image:string}>;
  scan():Promise<{cancelled:boolean;value?:string}>;
}>('SyncQr');
export async function renderSyncQr(invitation:string):Promise<string> {
  parseSyncInvitation(invitation);
  if(Capacitor.getPlatform()==='android')return (await native.render({value:invitation})).image;
  if(!nativeMailSyncSupported())throw new AppError('nativeRequired');
  // Offline-only local QR rendering. The group key is never sent to a QR service.
  const code=qrcodegen.QrCode.encodeText(invitation,qrcodegen.QrCode.Ecc.MEDIUM);
  const margin=4,dimension=code.size+margin*2;
  let path='';
  for(let y=0;y<code.size;y++)for(let x=0;x<code.size;x++)
    if(code.getModule(x,y))path+='M'+(x+margin)+' '+(y+margin)+'h1v1h-1z';
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+dimension+' '+dimension+
    '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/>'+
    '<path fill="black" d="'+path+'"/></svg>';
  return 'data:image/svg+xml;base64,'+btoa(svg);
}
export async function scanSyncQr():Promise<string|null> {
  if(Capacitor.getPlatform()!=='android')throw new AppError('nativeRequired');
  const result=await native.scan();
  if(result.cancelled)return null;
  parseSyncInvitation(result.value ?? '');
  return result.value!;
}

/** Scan a user-selected local QR image when the desktop WebView exposes BarcodeDetector.
 * Never uploads group secrets or grants a remote camera service access.
 */
export async function scanDesktopSyncQrImage(file:File):Promise<string> {
  if(!nativeMailSyncSupported() || Capacitor.getPlatform()==='android' ||
      !file.type.startsWith('image/') || file.size>8*1024*1024)throw new AppError('qrScanFailed');
  type Detection={rawValue:string};
  type Scanner=new(options:{formats:string[]})=>{detect(input:ImageBitmap):Promise<Detection[]>};
  const supported=(globalThis as typeof globalThis & {BarcodeDetector?:Scanner}).BarcodeDetector;
  if(!supported)throw new AppError('qrUnavailable');
  const bitmap=await createImageBitmap(file);
  try {
    const matches=await new supported({formats:['qr_code']}).detect(bitmap);
    if(matches.length!==1)throw new AppError('qrScanFailed');
    parseSyncInvitation(matches[0]!.rawValue);
    return matches[0]!.rawValue;
  } finally {bitmap.close();}
}
