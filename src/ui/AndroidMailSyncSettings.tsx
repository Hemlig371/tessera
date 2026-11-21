import {useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {Repository} from '../core/repository';
import type {MailSyncConfig} from '../core/mail-config';
import { createAndroidSyncGroup, invitationForDevice, joinAndroidSyncGroup,
  readMailSyncConfig, configureAndroidMailSync, confirmImportedPeer,
  executeAndroidMailCycle, stopAndroidMailGroup, saveMailCycleError } from '../platform/mail-sync-setup';
import {renderSyncQr,scanSyncQr} from '../platform/sync-qr';
import {syncSecretStore} from '../platform/sync-secrets';
import type {LocalSyncSafety} from '../core/sync-safety';
import type {LocalSyncCycleResult} from '../core/local-sync-engine';
import {ErrorMessage,errorKey} from './common';

const empty:MailSyncConfig={smtpHost:'',smtpPort:465,imapHost:'',imapPort:993,
  user:'',address:'',peers:[],schedule:'manual'};
export function AndroidMailSyncSettings({api,cancel}:{api:Repository;cancel:()=>void}) {
  const {t}=useTranslation();
  const [config,setConfig]=useState<MailSyncConfig>(empty);
  const [password,setPassword]=useState('');
  const [peersText,setPeersText]=useState('');
  const [mode,setMode]=useState<LocalSyncSafety|null>(null);
  const [keyPresent,setKeyPresent]=useState(false);
  const [invite,setInvite]=useState('');
  const [qr,setQr]=useState('');
  const [peerId,setPeerId]=useState('');
  const [checkpoint,setCheckpoint]=useState('');
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<LocalSyncCycleResult|null>(null);
  const [error,setError]=useState('');
  const [working,setWorking]=useState(false);
  const reload=async()=>{
    const [value,safety,secret]=await Promise.all([
      readMailSyncConfig(api),api.localSyncSafety(),syncSecretStore().load('group-key')]);
    if(value){setConfig(value);setPeersText(value.peers.join(', '));}
    setMode(safety);setKeyPresent(!!secret);
  };
  useEffect(()=>{
    let alive=true;
    void reload().catch(e=>{if(alive)setError(errorKey(e));});
    return()=>{alive=false;};
  },[api]);
  const act=async(task:()=>Promise<void>)=>{
    if(working)return;
    setWorking(true);setError('');setMessage('');
    try {await task();await reload();}
    catch(e){setError(errorKey(e));}
    finally {setWorking(false);}
  };
  const displayInvite=async(value:string)=>{
    setInvite(value);
    setQr(await renderSyncQr(value));
  };
  const update=(key:keyof MailSyncConfig,value:string|number)=>{
    setConfig(old=>({...old,[key]:value}));
  };
  return <div className="settings-form">
    <p className="screen-hint">{t('mailSyncHint')}</p>
    <p>{t('mailSyncDeviceId')}: <code>{api.deviceId}</code></p>
    <p>{t('mailSyncDatasetId')}: <code>{api.datasetId}</code></p>
    <p>{t('mailSyncStatus')}: {mode?.mode ?? t('mailSyncNotConfigured')} ({mode?.reason ?? '-'})</p>
    <p>{t('mailSyncLastSuccess')}: {mode?.last_success_at ?? '—'}</p>
    {!keyPresent && (mode?.mode==='never_configured' || mode?.mode==='detached') &&
      <div className="form-actions">
        <button disabled={working} onClick={()=>{void act(async()=>{await displayInvite(await createAndroidSyncGroup(api));});}}>{t('mailSyncStart')}</button>
        <button disabled={working} onClick={()=>{void act(async()=>{
          const value=await scanSyncQr();if(value===null)return;
          const seq=await joinAndroidSyncGroup(api,value);
          setMessage(t('mailSyncJoined')+' '+seq);
        });}}>{t('mailSyncJoin')}</button>
      </div>}
    {keyPresent && <>
      <div className="form-actions"><button disabled={working} onClick={()=>{void act(async()=>{await displayInvite(await invitationForDevice(api));});}}>{t('mailSyncInvite')}</button></div>
      {invite && <div><p>{t('mailSyncQrSensitive')}</p><img alt={t('mailSyncInvite')} width={240} height={240} src={qr} /></div>}
      <form onSubmit={event=>{event.preventDefault();void act(async()=>{
        const peers=peersText.split(',').map(p=>p.trim()).filter(Boolean);
        await configureAndroidMailSync(api,{...config,peers},password||undefined);
        setPassword('');setMessage(t('mailSyncSave'));
      });}}>
      <div className="settings-grid">
        <label>{t('mailSyncSmtpHost')}<input required maxLength={253} value={config.smtpHost} onChange={e=>update('smtpHost',e.target.value)} /></label>
        <label>{t('mailSyncSmtpPort')}<input required type="number" min={1} max={65535} value={config.smtpPort} onChange={e=>update('smtpPort',Number(e.target.value))}/></label>
        <label>{t('mailSyncImapHost')}<input required maxLength={253} value={config.imapHost} onChange={e=>update('imapHost',e.target.value)}/></label>
        <label>{t('mailSyncImapPort')}<input required type="number" min={1} max={65535} value={config.imapPort} onChange={e=>update('imapPort',Number(e.target.value))}/></label>
        <label>{t('mailSyncUsername')}<input required maxLength={254} value={config.user} onChange={e=>update('user',e.target.value)}/></label>
        <label>{t('mailSyncAddress')}<input required type="email" value={config.address} onChange={e=>update('address',e.target.value)}/></label>
        <label>{t('mailSyncPassword')}<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} /></label>
        <label>{t('mailSyncPeers')}<input value={peersText} onChange={e=>setPeersText(e.target.value)} /></label>
        <label>{t('mailSyncSchedule')}<select value={config.schedule} onChange={e=>update('schedule',e.target.value)}>
          <option value="manual">{t('mailSyncManual')}</option><option value="15min">{t('mailSync15')}</option>
        </select></label>
      </div>
      <div className="form-actions"><button className="primary" disabled={working}>{t('mailSyncSave')}</button></div>
      </form>
      <div className="form-actions">
        <button disabled={working || mode?.mode!=='active'} onClick={()=>{void act(async()=>{
          try{const current=await executeAndroidMailCycle(api);setResult(current);setMessage(t('mailSyncChecked'));}
          catch(e){await saveMailCycleError(api);throw e;}
        });}}>{t('mailSyncRun')}</button>
        <button disabled={working || (mode?.mode!=='active' && mode?.mode!=='paused') || !!mode?.reason}
          onClick={()=>{void act(async()=>{await api.pauseLocalSync(mode?.mode==='active');});}}>
          {mode?.mode==='active'?t('mailSyncPause'):t('mailSyncResume')}</button>
      </div>
      <fieldset><legend>{t('mailSyncConfirm')}</legend>
        <label>{t('mailSyncReceiver')}<input value={peerId} onChange={e=>setPeerId(e.target.value.trim())}/></label>
        <label>{t('mailSyncCheckpoint')}<input type="number" min={0} value={checkpoint} onChange={e=>setCheckpoint(e.target.value)}/></label>
        <button disabled={working || !checkpoint} onClick={()=>{void act(async()=>{
          await confirmImportedPeer(api,peerId,Number(checkpoint));
        });}}>{t('mailSyncConfirm')}</button>
      </fieldset>
      <button type="button" className="danger" disabled={working} onClick={()=>{
        if(!window.confirm(t('mailSyncDetachWarn')))return;
        void act(async()=>{await stopAndroidMailGroup(api);setInvite('');setQr('');setConfig(empty);setPeersText('');});
      }}>{t('mailSyncDetach')}</button>
    </>}
    {result && <p>{t('mailSyncReceipt',result)}</p>}
    {message && <p role="status">{message}</p>}
    {error && <ErrorMessage code={error}/>}
    <div className="form-actions"><button type="button" disabled={working} onClick={cancel}>{t('cancel')}</button></div>
  </div>;
}
