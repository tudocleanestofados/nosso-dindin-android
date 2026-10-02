import { CapacitorUpdater } from '@capgo/capacitor-updater';

const STATUS = () => document.getElementById('ndUpdateStatus');
const manifestUrl = 'https://raw.githubusercontent.com/tudocleanestofados/nosso-dindin-android/main/updates/manifest.json';
const state = {checking:false};

async function checkUpdates(manual=false) {
  if(state.checking)return;
  state.checking=true;
  try {
    const current=await CapacitorUpdater.current();
    const webVersion=current.bundle.version;
    const nativeVersion=current.native;
    STATUS().textContent=`Versão instalada: ${nativeVersion} · conteúdo: ${webVersion}`;
    const response=await fetch(manifestUrl+'?t='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error('Não foi possível consultar as versões.');
    const manifest=await response.json();
    if(manifest.app_id!=='com.nossodindin.app')throw new Error('Manifesto de outro aplicativo.');
    if(manifest.native_version && manifest.native_version!==nativeVersion && manifest.apk_url){
      STATUS().textContent=`Nova versão do aplicativo: ${manifest.native_version}.`;
      if(manual && confirm('Há uma versão nova do aplicativo. Abrir a instalação?')) window.open(manifest.apk_url,'_system');
      return;
    }
    if(!manifest.web_version || manifest.web_version===webVersion || !manifest.zip_url){
      if(manual) STATUS().textContent=`Versão instalada: ${nativeVersion} · conteúdo: ${webVersion}. Atualizado.`;
      return;
    }
    if(!/^https:\/\//.test(manifest.zip_url) || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) throw new Error('Pacote de atualização inválido.');
    STATUS().textContent='Baixando atualização do conteúdo…';
    const bundle=await CapacitorUpdater.download({version:manifest.web_version,url:manifest.zip_url,checksum:manifest.sha256});
    STATUS().textContent='Atualização pronta. Abrindo a nova versão…';
    await CapacitorUpdater.set({id:bundle.id});
  } catch(error) { console.error('Atualização:',error); if(manual) STATUS().textContent=error.message||'Não foi possível verificar atualizações.'; }
  finally {state.checking=false;}
}
window.ndCheckUpdates=checkUpdates;
CapacitorUpdater.notifyAppReady().then(()=>checkUpdates(false)).catch(error=>console.error('Atualização:',error));
