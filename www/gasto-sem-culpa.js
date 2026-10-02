/* Personal allowance is an allocation of existing bank money, never a second balance. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const brl = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const monthNow = () => {const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Recife',year:'numeric',month:'2-digit'}).formatToParts(new Date());return parts.find(x=>x.type==='year').value+'-'+parts.find(x=>x.type==='month').value;};
  let members = [], settings = [], months = [], tags = [], loadedGroup = null, busy = false;
  const active = () => Boolean(currentUser && GROUP_ID && supabaseClient);
  const selectedMonth = () => ($('gscMonth')?.value || monthNow()) + '-01';
  const accountBalance = id => {
    const a = accounts.find(x => x.id === id);
    if (!a) return 0;
    return Number(a.initial_balance || 0) + transactions.filter(t => t.paid && t.account_id === id)
      .reduce((sum,t) => sum + (t.type === 'income' ? 1 : -1) * Number(t.amount || 0),0)
      - goalMovements.filter(m => m.account_id === id).reduce((sum,m) => sum + (m.type === 'deposit' ? 1 : -1) * Number(m.amount || 0),0);
  };
  const profile = user => settings.find(s => s.user_id === user);
  const memberLabel = m => (m.email || 'Usuário').split('@')[0];

  async function load() {
    if (!active() || busy) return;
    busy = true;
    try {
      const group = GROUP_ID;
      const [family, configs, limits, entries] = await Promise.all([
        supabaseClient.rpc('get_my_family_members',{p_group_id:group}),
        supabaseClient.from('gsc_settings').select('*').eq('group_id',group),
        supabaseClient.from('gsc_months').select('*').eq('group_id',group).order('month',{ascending:false}),
        supabaseClient.from('gsc_expenses').select('*').eq('group_id',group)
      ]);
      for (const answer of [family,configs,limits,entries]) if (answer.error) throw answer.error;
      if (GROUP_ID !== group) return;
      members = family.data || []; settings = configs.data || []; months = limits.data || []; tags = entries.data || [];
      loadedGroup = group;
      fillChoice();
      await render();
    } catch (error) { console.error('Gasto sem Culpa:',error); if (!$('gscSection').classList.contains('hidden')) $('gscMembers').textContent='Não foi possível carregar: '+error.message; }
    finally { busy = false; }
  }
  async function render() {
    if (!active() || loadedGroup !== GROUP_ID) return;
    const node = $('gscMembers'); if (!node) return;
    const selected = selectedMonth();
    const balances = await Promise.all(members.map(m => supabaseClient.rpc('gsc_balance',{p_group:GROUP_ID,p_user:m.user_id,p_month:selected})));
    node.innerHTML = members.map((m,i) => {
      const p=profile(m.user_id), configured=months.find(x=>x.user_id===m.user_id&&x.month===selected);
      const state=balances[i].data || {allocated:0,spent:0,carry:0,remaining:0};
      const id=String(i), historical=months.filter(x=>x.user_id===m.user_id).slice(0,12);
      return `<div class="card nd-gsc-person"><h3>${escapeHtml(memberLabel(m))}</h3>
        <p>Disponível: <strong>${brl(state.remaining)}</strong> · usado ou reservado no mês: ${brl(state.spent)}</p>
        <small>Sobra anterior: ${brl(state.carry)}. Parcelas contam no mês do vencimento.</small>
        <label>Valor definido para ${escapeHtml(selected.slice(0,7))}</label><input type="number" min="0" step="0.01" id="gscAmount${id}" value="${configured ? Number(configured.amount) : 0}">
        <label>Conta padrão para pagar despesas</label><select id="gscAccount${id}"><option value="">Escolha uma conta</option>${accounts.map(a=>`<option value="${a.id}" ${a.id===p?.account_id?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}</select>
        <label>Notificação individual (horário de Recife)</label><input type="time" step="300" id="gscTime${id}" value="${String(p?.notification_time||'09:00').slice(0,5)}">
        <label><input type="checkbox" id="gscNotify${id}" ${p?.notification_enabled===false?'':'checked'}> Receber lembrete diário</label>
        <button class="primary" onclick="ndGscSave(${i})">Salvar para ${escapeHtml(memberLabel(m))}</button>
        <details><summary>Meses anteriores</summary><ul>${historical.map(x=>`<li>${escapeHtml(x.month.slice(0,7))}: ${brl(x.amount)}</li>`).join('')||'<li>Nenhum mês definido.</li>'}</ul></details></div>`;
    }).join('') || '<p>Carregando membros da família…</p>';
    const mini=$('ndGscSummary');
    if(mini) mini.innerHTML=members.map((m,i)=>`<div>${escapeHtml(memberLabel(m))}: <strong>${brl(balances[i].data?.remaining)}</strong></div>`).join('');
  }
  function fillChoice() {
    const choice=$('ndGscPerson'); if (!choice) return;
    const previous=choice.value;
    choice.replaceChildren(...members.map(m=>new Option(memberLabel(m),m.user_id)));
    choice.value=members.some(m=>m.user_id===previous)?previous:(currentUser?.id||members[0]?.user_id||'');
    setPaymentAccount();
  }
  function setPaymentAccount() {
    if (!$('ndGscUse')?.checked) return;
    const id=profile($('ndGscPerson').value)?.account_id;
    if(id && $('transactionAccount')?.querySelector(`option[value="${id}"]`)) $('transactionAccount').value=id;
  }
  function updateChoice() {
    const expense=$('transactionType')?.value==='expense';
    $('ndGscChoice')?.classList.toggle('hidden',!expense);
    setPaymentAccount();
  }
  async function tag({transaction=null,series=null,purchase=null}) {
    if (!$('ndGscUse')?.checked) return;
    const user=$('ndGscPerson').value;
    if (!user) throw new Error('Escolha quem usará o Gasto sem Culpa.');
    const {error}=await supabaseClient.rpc('gsc_tag',{p_group:GROUP_ID,p_user:user,p_transaction:transaction,p_series:series,p_purchase:purchase});
    if (error) throw error;
    load();
  }
  window.ndGscTag=tag;
  window.ndGscRender=render;
  window.ndGscSave=async i => {
    const m=members[i], amount=Number($('gscAmount'+i).value), account=$('gscAccount'+i).value;
    if (!m || !Number.isFinite(amount) || amount<0 || !account) {alert('Informe um valor válido e uma conta padrão.');return;}
    const {error}=await supabaseClient.rpc('gsc_configure',{
      p_group:GROUP_ID,p_user:m.user_id,p_month:selectedMonth(),p_amount:amount,
      p_account:account,p_time:$('gscTime'+i).value,p_enabled:$('gscNotify'+i).checked
    });
    if(error){alert('Não foi possível salvar: '+error.message);return;}
    await load();
  };
  window.ndExportFinance=async () => {
    if (!active()) {alert('Entre na conta primeiro.');return false;}
    const [finance,config,limits,entries]=await Promise.all([
      supabaseClient.rpc('get_my_finance_data',{p_group_id:GROUP_ID}),
      supabaseClient.from('gsc_settings').select('*').eq('group_id',GROUP_ID),
      supabaseClient.from('gsc_months').select('*').eq('group_id',GROUP_ID),
      supabaseClient.from('gsc_expenses').select('*').eq('group_id',GROUP_ID)
    ]);
    if([finance,config,limits,entries].some(x=>x.error)){alert('Não foi possível preparar a cópia. Nada foi apagado.');return false;}
    const content={exported_at:new Date().toISOString(),group_id:GROUP_ID,finance:finance.data,gsc_settings:config.data,gsc_months:limits.data,gsc_expenses:entries.data};
    const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`nosso-dindin-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    return true;
  };
  window.ndResetFinance=async () => {
    if(!active()) return;
    if(!await ndExportFinance()) return;
    const phrase=prompt('Uma cópia foi preparada para download. Para apagar os dados financeiros desta família, digite ZERAR DADOS. As contas de usuário permanecem.');
    if(phrase!=='ZERAR DADOS') return;
    if(!confirm('Confirma a remoção definitiva dos dados financeiros da família?')) return;
    const {error}=await supabaseClient.rpc('reset_my_finance_data',{p_group:GROUP_ID,p_confirmation:phrase});
    if(error){alert('Não foi possível zerar: '+error.message);return;}
    for(const key of ['transactions','accounts','creditCards','cardPurchases','cardInstallments','invoicePayments'])localStorage.removeItem(key);
    members=[];settings=[];months=[];tags=[];await loadCloudData();await load();renderAll();alert('Dados financeiros zerados. Os usuários continuam cadastrados.');
  };
  function inject() {
    if(!$('ndGscChoice')) {
      const wrap=document.createElement('div');wrap.id='ndGscChoice';wrap.className='form-block hidden';
      wrap.innerHTML='<label><input type="checkbox" id="ndGscUse" onchange="ndGscSetAccount()"> Abater do Gasto sem Culpa</label><label>Pessoa</label><select id="ndGscPerson" onchange="ndGscSetAccount()"></select><small>As parcelas reservam o valor no mês do vencimento. O saldo da conta diminui quando a despesa ou fatura é paga.</small>';
      $('txForm')?.append(wrap);
    }
    if(!$('ndGscSummary')) {
      const card=document.createElement('div');card.className='card';
      card.innerHTML='<h3>Gasto sem Culpa</h3><div id="ndGscSummary"></div><button class="secondary" onclick="showSection(\'gscSection\')">Ver e configurar</button>';
      $('dashboardSection')?.append(card);
    }
    if(!document.querySelector('.nav [data-gsc]')){
      const nav=document.querySelector('aside.nav');
      if(nav){const button=document.createElement('button');button.dataset.gsc='1';button.textContent='Gasto sem Culpa';button.onclick=()=>showSection('gscSection',button);nav.append(button);}
    }
  }
  window.ndGscSetAccount=setPaymentAccount;
  const originalShow=window.showSection;
  window.showSection=function(id,button){const r=originalShow(id,button);if(id==='gscSection')load();return r;};
  const originalUpdate=window.updateSmartTransactionForm;
  window.updateSmartTransactionForm=function(){originalUpdate();updateChoice();};
  const originalReset=window.resetTxForm;
  window.resetTxForm=function(){originalReset();if($('ndGscUse'))$('ndGscUse').checked=false;updateChoice();};
  const originalPay=window.openPayTransaction;
  window.openPayTransaction=function(id){originalPay(id);const t=transactions.find(x=>x.id===id);if(!t)return;
    const tag=tags.find(x=>x.transaction_id===id || (t.installment_series_id && x.installment_series_id===t.installment_series_id));
    const preferred=profile(tag?.user_id)?.account_id;
    if(preferred && $('payTxAccount')?.querySelector(`option[value="${preferred}"]`)) $('payTxAccount').value=preferred;
  };
  const originalPayConfirm=window.confirmPayTransaction;
  window.confirmPayTransaction=async function(){const t=transactions.find(x=>x.id===$('payTxId').value);const account=$('payTxAccount').value;
    if(t?.type==='expense' && accountBalance(account)<Number(t.amount) && !confirm('A conta escolhida pode ficar negativa. Deseja pagar mesmo assim?'))return;
    return originalPayConfirm();
  };
  const originalInvoice=window.payInvoice;
  window.payInvoice=function(cardId,month){originalInvoice(cardId,month);
    const choices=new Set(cardInstallments.filter(x=>x.card_id===cardId && String(x.invoice_month).slice(0,7)===String(month).slice(0,7))
      .map(x=>profile(tags.find(t=>t.purchase_id===x.purchase_id)?.user_id)?.account_id).filter(Boolean));
    if(choices.size===1 && $('invoicePayAccount')) $('invoicePayAccount').value=[...choices][0];
  };
  const originalInvoiceConfirm=window.confirmInvoicePayment;
  window.confirmInvoicePayment=async function(){
    const card=$('invoicePayCard').value,month=$('invoicePayMonth').value,account=$('invoicePayAccount').value;
    const amount=cardInstallments.filter(x=>x.card_id===card && String(x.invoice_month).slice(0,7)===String(month).slice(0,7) && !x.paid).reduce((sum,x)=>sum+Number(x.amount||0),0);
    if(accountBalance(account)<amount && !confirm('A conta escolhida pode ficar negativa após pagar a fatura. Deseja continuar?'))return;
    return originalInvoiceConfirm();
  };
  inject();$('gscMonth').value=monthNow();
  const originalLoad=window.loadCloudData;
  window.loadCloudData=async function(){const result=await originalLoad();load();return result;};
  const menu=document.querySelector('.ndm-drawer .ndm-nav');
  if(menu&&!menu.querySelector('[data-section="gscSection"]')){
    const b=document.createElement('button');b.dataset.section='gscSection';b.textContent='Gasto sem Culpa';b.onclick=()=>{showSection('gscSection');document.querySelector('.ndm-drawer')?.classList.remove('open');document.querySelector('.ndm-backdrop')?.classList.remove('open');};menu.append(b);
  }
  setTimeout(load,200);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
})();
