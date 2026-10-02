/* The name each member chose in Profile is shared with their family. */
(function () {
  'use strict';
  let migrating = false;
  const savedName = () => currentUser?.id ? String(localStorage.getItem('finance_profile_name_'+currentUser.id)||'').trim() : '';
  const remoteName = () => String(currentUser?.user_metadata?.display_name||'').trim();
  const previousDisplayName=window.userDisplayName;
  window.userDisplayName=function(){return remoteName() || previousDisplayName();};

  async function migrateLocalName() {
    if(migrating || !currentUser?.id || !supabaseClient || remoteName() || !savedName())return;
    const uid=currentUser.id, name=savedName();
    migrating=true;
    try{
      const {data,error}=await supabaseClient.auth.updateUser({data:{display_name:name}});
      if(error)throw error;
      if(currentUser?.id===uid)currentUser=data.user;
      window.ndGscRefresh?.();
    }catch(error){console.error('Sincronização do nome:',error);}
    finally{migrating=false;}
  }

  const previousLoad=window.loadCloudData;
  window.loadCloudData=async function(){const result=await previousLoad();await migrateLocalName();return result;};

  const previousSave=window.saveProfile;
  window.saveProfile=async function(){
    const name=document.getElementById('profileNameInput')?.value.trim();
    if(!name){alert('Informe seu nome.');return;}
    if(!currentUser){alert('Entre na sua conta antes de salvar o perfil.');return;}
    const button=document.querySelector('#profileModal button[onclick="saveProfile()"]');
    if(button)button.disabled=true;
    try{
      const {data,error}=await supabaseClient.auth.updateUser({data:{display_name:name}});
      if(error)throw error;
      currentUser=data.user;
      previousSave();
      window.ndGscRefresh?.();
    }catch(error){alert('Não foi possível sincronizar o nome: '+error.message);}
    finally{if(button)button.disabled=false;}
  };

  setTimeout(migrateLocalName,750);
})();
