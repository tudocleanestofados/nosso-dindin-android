/* O período escolhido no painel controla resumos, gráfico e atalhos. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const cents = value => Math.round(Number(value || 0) * 100);
  const money = value => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const current = new Date();
  let selectedMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
  window.ND_SELECTED_MONTH = selectedMonth;

  function shiftMonth(value, count) {
    const [year, month] = value.split('-').map(Number);
    const day = new Date(Date.UTC(year, month - 1 + count, 1));
    return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  function dueMonth(installment) {
    const invoice = String(installment.invoice_month || '').slice(0, 7);
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(invoice) ? shiftMonth(invoice, 1) : '';
  }
  const transactionMonth = item => String(item.due_date || item.date || '').slice(0, 7);
  const dateMonth = item => String(item.date || item.due_date || '').slice(0, 7);

  function synchronizeMonthControls() {
    const values = new Set([selectedMonth]);
    for (let n = -24; n <= 36; n++) values.add(shiftMonth(selectedMonth, n));
    (transactions || []).forEach(item => {
      const month = transactionMonth(item);
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) values.add(month);
    });
    (cardInstallments || []).forEach(item => {
      const month = dueMonth(item);
      if (month) values.add(month);
    });
    const options = [...values].sort().map(value => {
      const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${value}-01T12:00:00Z`));
      return { value, label: label.charAt(0).toUpperCase() + label.slice(1) };
    });
    document.querySelectorAll('#dashboardSection .month-select, #dashboardSection .chart-card .card-head select, #dashboardSection .ndm-month').forEach(select => {
      if (select.dataset.monthRange !== `${options[0]?.value}:${options.at(-1)?.value}`) {
        select.replaceChildren(...options.map(({ value, label }) => new Option(label, value)));
        select.dataset.monthRange = `${options[0]?.value}:${options.at(-1)?.value}`;
      }
      select.value = selectedMonth;
      select.onchange = () => selectDashboardMonth(select.value);
      select.setAttribute('aria-label', 'Mês do resumo financeiro');
    });
  }

  function invoiceGroups() {
    const groups = new Map();
    (cardInstallments || []).forEach(item => {
      if (item.paid) return;
      const due = dueMonth(item);
      if (!due) return;
      const key = `${item.card_id || ''}:${due}`;
      const group = groups.get(key) || { due, cardId: item.card_id, amount: 0 };
      group.amount += cents(item.amount);
      groups.set(key, group);
    });
    return [...groups.values()];
  }

  function renderMonth() {
    const tx = transactions || [];
    const receivable = tx.filter(item => !item.paid && item.type === 'income' && transactionMonth(item) === selectedMonth);
    const payable = tx.filter(item => !item.paid && item.type === 'expense' && transactionMonth(item) === selectedMonth);
    const invoices = invoiceGroups();
    const currentInvoices = invoices.filter(item => item.due === selectedMonth);
    const futureInvoices = invoices.filter(item => item.due > selectedMonth);
    const set = (id, value) => { const node = byId(id); if (node) node.textContent = value; };
    set('modelReceivable', money(receivable.reduce((sum, item) => sum + cents(item.amount), 0)));
    set('modelReceivableCount', `${receivable.length} ${receivable.length === 1 ? 'lançamento' : 'lançamentos'}`);
    set('modelPayable', money(payable.reduce((sum, item) => sum + cents(item.amount), 0)
      + currentInvoices.reduce((sum, item) => sum + item.amount, 0)));
    const parts = [];
    if (payable.length) parts.push(`${payable.length} ${payable.length === 1 ? 'lançamento' : 'lançamentos'}`);
    if (currentInvoices.length) parts.push(`${currentInvoices.length} ${currentInvoices.length === 1 ? 'fatura' : 'faturas'}`);
    set('modelPayableCount', parts.join(' + ') || '0 compromissos');
    set('futureInvoices', money(futureInvoices.reduce((sum, item) => sum + item.amount, 0)));
    set('modelInvoiceCount', `${futureInvoices.length} ${futureInvoices.length === 1 ? 'fatura' : 'faturas'}`);

    const chart = byId('modelChart');
    if (chart) {
      const income = tx.filter(item => item.paid && item.type === 'income' && item.category !== 'Transferência' && dateMonth(item) === selectedMonth)
        .reduce((sum, item) => sum + cents(item.amount), 0);
      const expense = tx.filter(item => item.paid && item.type === 'expense' && item.category !== 'Transferência' && dateMonth(item) === selectedMonth)
        .reduce((sum, item) => sum + cents(item.amount), 0);
      const max = Math.max(income, expense, Math.abs(income - expense), 1);
      chart.innerHTML = [['Receitas', income, '#36b96a'], ['Despesas', expense, '#ef4351'], ['Resultado', income - expense, '#2671df']]
        .map(([label, amount, color]) => `<div class="bar-col"><b>${money(amount)}</b><div class="bar" style="height:${Math.max(14, Math.abs(amount) / max * 95)}px;background:${color}"></div><span>${label}</span></div>`).join('');
    }
  }

  window.selectDashboardMonth = function (value) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    selectedMonth = value;
    window.ND_SELECTED_MONTH = value;
    window.renderModelDashboard();
    if (typeof transactionViewFilter !== 'undefined' && transactionViewFilter) window.renderTransactions();
  };
  const previousDashboard = window.renderModelDashboard;
  window.renderModelDashboard = function () {
    if (typeof previousDashboard === 'function') previousDashboard.apply(this, arguments);
    synchronizeMonthControls();
    renderMonth();
  };

  const previousTransactions = window.renderTransactions;
  window.renderTransactions = function () {
    if (typeof previousTransactions === 'function') previousTransactions.apply(this, arguments);
    if (typeof transactionViewFilter === 'undefined' || !['receivable', 'payable'].includes(transactionViewFilter)) return;
    const wanted = (transactions || []).filter(item => !item.paid
      && item.type === (transactionViewFilter === 'receivable' ? 'income' : 'expense')
      && transactionMonth(item) === selectedMonth);
    const list = byId('allTransactions');
    if (list) list.innerHTML = wanted.length ? wanted.sort((a, b) => String(a.due_date || a.date).localeCompare(String(b.due_date || b.date)))
      .map(window.renderTransaction).join('') : '<div class="empty">Nenhum lançamento pendente neste mês.</div>';
  };

  function placeSyncStatus() {
    const status = byId('ndSyncStatus');
    const mobileGreeting = document.querySelector('#dashboardSection .ndm-greeting');
    const desktopAnchor = document.querySelector('#dashboardSection .model-dashboard .hero-row');
    const anchor = matchMedia('(max-width:800px)').matches ? mobileGreeting : desktopAnchor;
    if (!status || !anchor) return;
    if (anchor === desktopAnchor) { if (status.nextElementSibling !== anchor) anchor.before(status); }
    else if (status.previousElementSibling !== anchor) anchor.after(status);
  }
  const statusStyle = document.createElement('style');
  statusStyle.textContent = '#ndSyncStatus{position:static!important;z-index:auto!important;right:auto!important;bottom:auto!important;box-shadow:none!important;background:transparent!important;border:0!important;color:var(--muted,#aebfd0)!important;padding:0!important;margin:4px 0 12px auto!important;width:max-content;max-width:100%;font-size:11px!important}#ndSyncStatus[data-state="error"],#ndSyncStatus[data-state="offline"]{color:#e35b59!important}';
  document.head.append(statusStyle);

  function setBadge(count) {
    document.querySelectorAll('.bell-wrap b, .ndm-badge').forEach(badge => {
      badge.textContent = count ? String(count) : '';
      badge.classList.toggle('hidden', !count);
      badge.setAttribute('aria-label', `${count} avisos de vencimento`);
    });
  }
  const previousNotifications = window.loadDueNotifications;
  window.loadDueNotifications = async function () {
    try {
      const rows = await previousNotifications.apply(this, arguments);
      setBadge(Array.isArray(rows) ? rows.length : 0);
      return rows;
    } catch (error) {
      setBadge(0);
      throw error;
    }
  };
  const previousLoad = window.loadCloudData;
  window.loadCloudData = async function () {
    const result = await previousLoad.apply(this, arguments);
    if (currentUser && GROUP_ID) window.loadDueNotifications();
    return result;
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser && GROUP_ID) window.loadDueNotifications();
  });
  window.addEventListener('resize', placeSyncStatus);
  document.addEventListener('DOMContentLoaded', () => {
    placeSyncStatus();
    setBadge(0);
    synchronizeMonthControls();
    if (currentUser && GROUP_ID) window.loadDueNotifications();
  });
})();
