/* Visão mensal, edição de acordos, conferência de faturas e estado da sincronização. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const moneyBR = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const toCents = value => Math.round(Number(value) * 100);
  const localDay = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  const monthAfter = invoiceMonth => {
    const [year, month] = String(invoiceMonth || '').slice(0, 7).split('-').map(Number);
    if (!year || !month || month < 1 || month > 12) return '';
    const next = new Date(Date.UTC(year, month, 1));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const dueLabel = (invoiceMonth, day) => {
    const [year, month] = String(invoiceMonth).slice(0, 7).split('-').map(Number);
    const max = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month, Math.min(Number(day || 1), max))));
  };

  function monthlyForecast() {
    const month = window.ND_SELECTED_MONTH || localDay().slice(0, 7);
    const categories = new Map();
    let paid = 0, pending = 0;
    const invoicePaymentTx = new Set((invoicePayments || []).map(x => x.transaction_id).filter(Boolean));
    const add = (category, amount, isPaid) => {
      const value = toCents(amount);
      if (!Number.isSafeInteger(value) || value <= 0) return;
      const key = String(category || 'Sem categoria').trim() || 'Sem categoria';
      categories.set(key, (categories.get(key) || 0) + value);
      if (isPaid) paid += value; else pending += value;
    };
    (transactions || []).forEach(item => {
      if (item.type !== 'expense' || item.transfer_id || invoicePaymentTx.has(item.id)
          || ['Transferência', 'Cofrinho'].includes(item.category)) return;
      const day = String(item.due_date || item.date || '').slice(0, 10);
      if (day.slice(0, 7) === month) add(item.category, item.amount, !!item.paid);
    });
    const purchases = new Map((cardPurchases || []).map(item => [item.id, item]));
    (cardInstallments || []).forEach(item => {
      if (monthAfter(item.invoice_month) !== month) return;
      add(purchases.get(item.purchase_id)?.category || 'Cartão', item.amount, !!item.paid);
    });
    return { month, categories, paid, pending, total: paid + pending };
  }

  function drawForecast() {
    const root = el('modelCategories');
    if (!root) return;
    const { month, categories, paid, pending, total } = monthlyForecast();
    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
      .format(new Date(`${month}-01T12:00:00`));
    const title = root.closest('.model-card')?.querySelector('.card-head h3');
    if (title) title.textContent = 'Gastos previstos por categoria';
    const sorted = [...categories].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    if (sorted.length > 5) top.push(['Outras categorias', sorted.slice(5).reduce((sum, row) => sum + row[1], 0)]);
    const colors = ['#2474e8', '#f28b39', '#36b96a', '#66b9e8', '#ad83eb', '#a9b9c9'];
    let position = 0;
    const stops = top.map((row, index) => {
      const start = position;
      position += row[1] / (total || 1) * 100;
      return `${colors[index]} ${start}% ${position}%`;
    });
    root.innerHTML = `<p class="nd-forecast-caption">Despesas e parcelas com vencimento em ${esc(monthName)}</p>
      ${total ? `<div class="donut" role="img" aria-label="Total previsto: ${moneyBR(total)}" style="background:conic-gradient(${stops.join(',')})"><div class="donut-center"><b>${moneyBR(total)}</b>Previsto</div></div>`
        : '<p class="nd-forecast-empty">Nenhum gasto previsto para este mês.</p>'}
      <div class="cat-list">${top.map((row, index) => `<div class="cat-item"><span class="cat-name"><span class="cat-dot" style="background:${colors[index]}"></span><span class="category-label">${esc(row[0])}</span></span><b>${moneyBR(row[1])}</b></div>`).join('')}</div>
      <div class="nd-forecast-status"><span>Pago <strong>${moneyBR(paid)}</strong></span><span>A pagar <strong>${moneyBR(pending)}</strong></span></div>`;
  }

  const earlierDashboard = window.renderModelDashboard;
  window.renderModelDashboard = function () {
    if (typeof earlierDashboard === 'function') earlierDashboard.apply(this, arguments);
    drawForecast();
  };

  let syncFailure = false;
  let syncFailureKind = 'read';
  let pendingCalls = 0;
  function setSyncStatus(state) {
    const node = el('ndSyncStatus');
    if (!node) return;
    node.dataset.state = state;
    const label = el('ndSyncLabel');
    label.textContent = state === 'working' ? 'Sincronizando…' : state === 'error'
      ? (syncFailureKind === 'write' ? 'Falha ao salvar · confira o lançamento' : 'Falha na sincronização') : state === 'offline' ? 'Sem conexão'
      : state === 'saved' ? `Salvo · ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Aguardando dados';
    el('ndSyncRetry').classList.toggle('hidden', state !== 'error' && state !== 'offline');
  }
  function trackRpc(client) {
    if (!client || client.__ndTrackedRpc) return;
    const original = client.rpc.bind(client);
    client.rpc = function (name, args, options) {
      const ledger = name === 'get_my_finance_data' || /^(?:create_my_noncard_installments|update_my_noncard_installment_series|(?:save|update|delete|pay)_my_.*|make_my_transfer|move_goal_money|move_vault_allocation)$/.test(name);
      if (!ledger) return original(name, args, options);
      pendingCalls++;
      setSyncStatus('working');
      return Promise.resolve(original(name, args, options)).then(result => {
        pendingCalls--;
        if (result.error) { syncFailure = true; syncFailureKind = name === 'get_my_finance_data' ? 'read' : 'write'; setSyncStatus('error'); }
        else if (!syncFailure && !pendingCalls) setSyncStatus('saved');
        return result;
      }, error => {
        pendingCalls--;
        syncFailure = true;
        syncFailureKind = name === 'get_my_finance_data' ? 'read' : 'write';
        setSyncStatus('error');
        throw error;
      });
    };
    client.__ndTrackedRpc = true;
  }
  const originalLoad = window.loadCloudData;
  window.loadCloudData = async function () {
    trackRpc(supabaseClient);
    return originalLoad.apply(this, arguments);
  };
  window.retryFinanceSync = async function () {
    if (!navigator.onLine) { setSyncStatus('offline'); return; }
    syncFailure = false;
    setSyncStatus('working');
    await loadCloudData();
    if (!syncFailure) renderAll();
  };

  const originalTransaction = window.renderTransaction;
  window.renderTransaction = function (item) {
    const html = originalTransaction(item);
    if (!item.installment_series_id || item.paid || String(item.due_date || '') < localDay()) return html;
    const position = html.lastIndexOf('</div>');
    if (position < 0) return html;
    const button = `<button type="button" class="nd-edit-series" onclick="openSeriesEditor('${item.installment_series_id}')">Editar parcelas futuras</button>`;
    return html.slice(0, position) + button + html.slice(position);
  };

  function futureSeries(seriesId) {
    return (transactions || []).filter(row => row.installment_series_id === seriesId
      && !row.paid && String(row.due_date || '') >= localDay())
      .sort((a, b) => Number(a.installment_number) - Number(b.installment_number));
  }
  window.openSeriesEditor = function (seriesId) {
    const rows = futureSeries(seriesId);
    if (!rows.length) { alert('Não há parcelas futuras pendentes para editar.'); return; }
    const first = rows[0], last = rows.at(-1);
    el('ndSeriesId').value = seriesId;
    el('ndSeriesDescription').value = String(first.description || '').replace(/ \(\d+\/\d+\)$/, '');
    const options = [...new Set([...EXPENSE_CATEGORIES, ...customCats('expense'), first.category || 'Outros'])];
    el('ndSeriesCategory').replaceChildren(...options.map(name => new Option(name, name)));
    el('ndSeriesCategory').value = first.category || 'Outros';
    el('ndSeriesAmount').value = Number(first.amount).toFixed(2);
    el('ndSeriesLastAmount').value = last.id !== first.id && Number(last.amount) !== Number(first.amount)
      ? Number(last.amount).toFixed(2) : '';
    el('ndSeriesFirstDue').value = String(first.due_date).slice(0, 10);
    el('ndSeriesLocked').textContent = `Serão alteradas ${rows.length} parcelas futuras, de ${first.installment_number}/${first.installment_total} até ${last.installment_number}/${last.installment_total}. Parcelas pagas e vencidas permanecem como estão.`;
    el('ndSeriesModal').classList.remove('hidden');
  };
  window.closeSeriesEditor = () => el('ndSeriesModal').classList.add('hidden');
  window.saveSeriesEditor = async function () {
    const seriesId = el('ndSeriesId').value;
    const rows = futureSeries(seriesId);
    const description = el('ndSeriesDescription').value.trim();
    const category = el('ndSeriesCategory').value;
    const amount = toCents(el('ndSeriesAmount').value);
    const lastRaw = el('ndSeriesLastAmount').value;
    const last = lastRaw ? toCents(lastRaw) : null;
    const firstDue = el('ndSeriesFirstDue').value;
    if (!rows.length || !description || !Number.isSafeInteger(amount) || amount <= 0
        || (last !== null && (!Number.isSafeInteger(last) || last <= 0)) || firstDue < localDay()) {
      alert('Confira descrição, valores e a primeira data de vencimento.'); return;
    }
    if (!confirm(`Alterar ${rows.length} parcelas futuras deste acordo? As parcelas já pagas ou vencidas não serão alteradas.`)) return;
    const button = el('ndSeriesSave'); button.disabled = true;
    try {
      const { data, error } = await supabaseClient.rpc('update_my_noncard_installment_series', {
        p_group_id: GROUP_ID, p_series_id: seriesId, p_description: description,
        p_category: category, p_amount_cents: amount, p_first_due: firstDue,
        p_last_amount_cents: last
      });
      if (error) throw error;
      if (Number(data) !== rows.length) throw new Error('A quantidade de parcelas mudou. Atualize a lista e confira.');
      closeSeriesEditor();
      await loadCloudData(); renderAll();
    } catch (error) { alert('Não foi possível atualizar as parcelas: ' + error.message); }
    finally { button.disabled = false; }
  };

  let comparedInvoice = null;
  window.openInvoiceReconciliation = function (cardId, invoiceMonth) {
    const card = (creditCards || []).find(item => item.id === cardId);
    const rows = (cardInstallments || []).filter(item => item.card_id === cardId
      && String(item.invoice_month || '').slice(0, 7) === String(invoiceMonth).slice(0, 7))
      .sort((a, b) => String(a.purchase_id).localeCompare(String(b.purchase_id)) || Number(a.installment_number) - Number(b.installment_number));
    if (!card || !rows.length) return;
    comparedInvoice = { cardId, invoiceMonth, rows };
    const purchases = new Map((cardPurchases || []).map(item => [item.id, item]));
    const expected = rows.reduce((sum, item) => sum + toCents(item.amount), 0);
    el('ndCompareTitle').textContent = `${card.name} · vencimento ${dueLabel(invoiceMonth, card.due_day)}`;
    el('ndCompareExpected').textContent = moneyBR(expected);
    el('ndCompareBank').value = '';
    el('ndCompareDifference').textContent = 'Informe o valor que aparece no banco para esta mesma fatura.';
    el('ndCompareRows').innerHTML = rows.map(item => {
      const purchase = purchases.get(item.purchase_id);
      return `<div class="nd-compare-line"><span>${esc(purchase?.description || 'Compra no cartão')}${Number(purchase?.installments || 1) > 1 ? ` (${item.installment_number}/${purchase.installments})` : ''}</span><strong>${moneyBR(toCents(item.amount))}</strong>${purchase ? `<button type="button" class="secondary" data-purchase-id="${purchase.id}">Revisar</button>` : ''}</div>`;
    }).join('');
    el('ndCompareModal').classList.remove('hidden');
  };
  window.updateInvoiceComparison = function () {
    if (!comparedInvoice) return;
    const input = el('ndCompareBank').value;
    if (!input) { el('ndCompareDifference').textContent = 'Informe o valor que aparece no banco para esta mesma fatura.'; return; }
    const bank = toCents(input);
    const app = comparedInvoice.rows.reduce((sum, item) => sum + toCents(item.amount), 0);
    if (!Number.isSafeInteger(bank) || bank < 0) { el('ndCompareDifference').textContent = 'Confira o valor informado.'; return; }
    const difference = bank - app;
    el('ndCompareDifference').textContent = difference === 0 ? 'Valores iguais. Fatura conferida.'
      : `Diferença de ${moneyBR(Math.abs(difference))}: ${difference > 0 ? 'o banco mostra mais' : 'o app mostra mais'}. Revise as compras abaixo.`;
  };
  window.closeInvoiceComparison = () => { el('ndCompareModal').classList.add('hidden'); comparedInvoice = null; };

  function addComparisonButtons(root, invoices) {
    [...root.querySelectorAll('.nd-card-detail, .nd-ledger-invoice')].forEach((node, index) => {
      const invoice = invoices[index];
      if (!invoice || node.querySelector('.nd-compare-action')) return;
      const target = node.querySelector('.nd-current-invoice, .nd-ledger-invoice-head');
      if (!target) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary nd-compare-action';
      button.textContent = 'Conferir com banco';
      button.onclick = () => openInvoiceReconciliation(invoice.cardId, invoice.month);
      target.append(button);
    });
  }
  const originalCards = window.renderCards;
  window.renderCards = function () {
    originalCards.apply(this, arguments);
    const cards = creditCards || [];
    const current = cards.map(card => {
      const months = [...new Set((cardInstallments || []).filter(item => item.card_id === card.id && !item.paid)
        .map(item => String(item.invoice_month || '').slice(0, 7)).filter(Boolean))].sort();
      return months.length ? { cardId: card.id, month: months[0] } : null;
    });
    addComparisonButtons(el('cardsDetailedOverview'), current);
  };
  const originalLedger = window.renderTransactions;
  window.renderTransactions = function () {
    originalLedger.apply(this, arguments);
    if (!el('ndLedgerTabs')?.querySelector('button[data-ledger-tab="cards"].active')) return;
    const cardName = new Map((creditCards || []).map(card => [card.id, card.name]));
    const groups = new Map();
    (cardInstallments || []).forEach(item => {
      const month = String(item.invoice_month || '').slice(0, 7);
      if (month) groups.set(`${item.card_id}:${month}`, { cardId: item.card_id, month });
    });
    const invoices = [...groups.values()].sort((a, b) => a.month.localeCompare(b.month)
      || String(cardName.get(a.cardId) || '').localeCompare(String(cardName.get(b.cardId) || '')));
    addComparisonButtons(el('allTransactions'), invoices);
  };

  function init() {
    const sync = document.createElement('div');
    sync.id = 'ndSyncStatus'; sync.dataset.state = 'idle';
    sync.innerHTML = '<span id="ndSyncLabel">Aguardando dados</span><button id="ndSyncRetry" type="button" class="hidden" onclick="retryFinanceSync()">Atualizar dados</button>';
    document.body.append(sync);
    const series = document.createElement('div');
    series.id = 'ndSeriesModal'; series.className = 'modal hidden';
    series.innerHTML = `<div class="modal-content nd-finance-modal"><button class="close" onclick="closeSeriesEditor()">×</button><h2>Editar parcelas futuras</h2><p id="ndSeriesLocked"></p><input id="ndSeriesId" type="hidden"><label>Descrição do acordo</label><input id="ndSeriesDescription"><label>Categoria</label><select id="ndSeriesCategory"></select><label>Valor de cada parcela restante</label><input id="ndSeriesAmount" type="number" min="0.01" step="0.01"><label>Última parcela, se diferente (opcional)</label><input id="ndSeriesLastAmount" type="number" min="0.01" step="0.01"><label>Próximo vencimento</label><input id="ndSeriesFirstDue" type="date"><button id="ndSeriesSave" class="primary" onclick="saveSeriesEditor()">Salvar parcelas futuras</button></div>`;
    document.body.append(series);
    const compare = document.createElement('div');
    compare.id = 'ndCompareModal'; compare.className = 'modal hidden';
    compare.innerHTML = `<div class="modal-content nd-finance-modal"><button class="close" onclick="closeInvoiceComparison()">×</button><h2>Conferir fatura com o banco</h2><p id="ndCompareTitle"></p><div class="nd-compare-total"><span>Total no Nosso Dindin</span><strong id="ndCompareExpected"></strong></div><label>Valor desta fatura no banco</label><input id="ndCompareBank" type="number" min="0" step="0.01" oninput="updateInvoiceComparison()" placeholder="0,00"><p id="ndCompareDifference" role="status"></p><h3>Compras e parcelas</h3><div id="ndCompareRows"></div><small>Revise uma compra para corrigir dados. A comparação não muda valores automaticamente.</small></div>`;
    document.body.append(compare);
    el('ndCompareRows').addEventListener('click', event => {
      const id = event.target.closest('[data-purchase-id]')?.dataset.purchaseId;
      if (!id) return;
      closeInvoiceComparison();
      openEditCardPurchase(id);
    });
    const style = document.createElement('style');
    style.textContent = `#ndSyncStatus{position:fixed;right:12px;bottom:96px;z-index:90;background:#20384e;color:#fff;border:1px solid #63819a;border-radius:12px;padding:8px 12px;font-size:12px;box-shadow:0 4px 18px #0015;display:flex;align-items:center;gap:8px}#ndSyncStatus[data-state="error"],#ndSyncStatus[data-state="offline"]{background:#74302c}#ndSyncRetry{font-size:12px;padding:5px 7px;border-radius:7px;background:#fff;color:#19344d}.nd-edit-series{margin:10px 0 0;border:1px solid #477fbd;border-radius:9px;padding:8px 10px;background:#1d73d8;color:#fff;font-weight:700}.nd-finance-modal{max-height:90dvh;overflow:auto}.nd-finance-modal label{display:block;margin:14px 0 5px}.nd-finance-modal input,.nd-finance-modal select{width:100%}.nd-finance-modal .primary{margin-top:16px}.nd-compare-total,.nd-compare-line{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #72839855}.nd-compare-line{flex-wrap:wrap}.nd-compare-line button{padding:6px 10px}.nd-compare-action{margin:8px 0}.nd-forecast-caption{font-size:12px;color:var(--muted,#b8c8d5);margin-bottom:12px}.nd-forecast-status{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px}.nd-forecast-status span{border:1px solid #63819a70;border-radius:9px;padding:8px;font-size:12px}.nd-forecast-status strong{display:block;font-size:15px}.nd-forecast-empty{margin:22px 0;color:var(--muted,#b8c8d5)}@media(max-width:800px){#ndSeriesModal,#ndCompareModal{z-index:6100!important}#ndSyncStatus{bottom:calc(84px + env(safe-area-inset-bottom,0px))}}`;
    style.textContent += `#dashboardSection #modelCategories .nd-forecast-caption,#dashboardSection #modelCategories .nd-forecast-status,#dashboardSection #modelCategories .nd-forecast-empty{grid-column:1/-1}#dashboardSection #modelCategories .donut{grid-column:1;grid-row:2}#dashboardSection #modelCategories .cat-list{grid-column:2;grid-row:2}#dashboardSection #modelCategories .nd-forecast-status{grid-row:3}#dashboardSection #modelCategories .cat-item b{white-space:nowrap;font-size:11px}`;
    style.textContent += `#cardsSection .nd-current-invoice{flex-wrap:wrap}#cardsSection .nd-current-invoice>.nd-compare-action{width:100%;flex:0 0 100%;margin-top:0;text-align:center}`;
    document.head.append(style);
    trackRpc(supabaseClient);
    window.addEventListener('offline', () => setSyncStatus('offline'));
    window.addEventListener('online', () => { if (currentUser) retryFinanceSync(); });
    if (!navigator.onLine) setSyncStatus('offline');
    if (currentUser && GROUP_ID) retryFinanceSync();
    drawForecast();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
