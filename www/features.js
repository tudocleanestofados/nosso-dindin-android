/* Nosso Dindin: despesas parceladas sem cartão e leitura de comprovantes. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const cents = value => Math.round(Number(value) * 100);
  const moneyBR = value => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const originalUpdate = window.updateSmartTransactionForm;
  const originalSave = window.saveSmartTransaction;
  const originalReset = window.resetTxForm;
  const originalRenderTransactions = window.renderTransactions;
  let saving = false;
  let ledgerTab = 'expenses';
  let receiptReturnToTransaction = false;

  // Ledger filter helpers: dates are ISO calendar dates, not local timestamps.
  let ledgerFilter = 'month';
  let ledgerMonth = today().slice(0, 7);
  let periodFrom = ledgerMonth + '-01';
  let periodTo = monthEnd(ledgerMonth);
  function monthEnd(month) {
    const [year, number] = month.split('-').map(Number);
    return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}`;
  }
  function plusDays(date, days) {
    const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function effectiveDate(item) { return String((item.paid ? item.date : (item.due_date || item.date)) || '').slice(0, 10); }
  function matchesLedger(item, filter, month, from, to, currentDay) {
    const date = effectiveDate(item);
    if (filter === 'overdue') return !item.paid && !!date && date < currentDay;
    if (filter === 'week') return !item.paid && !!date && date >= currentDay && date <= plusDays(currentDay, 6);
    if (filter === 'paid') return !!item.paid && date.slice(0,7) === month;
    if (filter === 'period') return !!from && !!to && from <= to && !!date && date >= from && date <= to;
    if (filter === 'all') return true;
    return !!date && date.slice(0,7) === month;
  }
  function ledgerOrder(a,b) {
    if (!!a.paid !== !!b.paid) return a.paid ? 1 : -1;
    const comparison = effectiveDate(a).localeCompare(effectiveDate(b));
    return (a.paid ? -comparison : comparison) || String(a.id || '').localeCompare(String(b.id || ''));
  }
  function selectedByLedger(item) { return matchesLedger(item, ledgerFilter, ledgerMonth, periodFrom, periodTo, today()); }
  window.ND_LEDGER_HELPERS = { matchesLedger, ledgerOrder, effectiveDate, plusDays, monthEnd };
  function updateLedgerControls() {
    if (!el('ndLedgerFilter')) return;
    el('ndLedgerFilter').value = ledgerFilter;
    el('ndLedgerMonth').value = ledgerMonth;
    el('ndLedgerFrom').value = periodFrom;
    el('ndLedgerTo').value = periodTo;
    el('ndLedgerMonthWrap').classList.toggle('hidden', !['month','paid'].includes(ledgerFilter));
    el('ndLedgerPeriod').classList.toggle('hidden', ledgerFilter !== 'period');
    const status = el('ndLedgerFilterHint');
    status.textContent = ledgerFilter === 'week' ? 'Hoje e os próximos 6 dias. Somente pendentes.'
      : ledgerFilter === 'overdue' ? 'Somente pendentes com vencimento anterior a hoje.'
      : ledgerFilter === 'period' && periodFrom > periodTo ? 'A data inicial deve ser anterior à data final.'
      : ledgerFilter === 'paid' ? 'Pagas ou recebidas no mês selecionado.' : '';
  }
  window.changeLedgerFilter = function () {
    ledgerFilter = el('ndLedgerFilter').value;
    ledgerMonth = el('ndLedgerMonth').value || today().slice(0,7);
    periodFrom = el('ndLedgerFrom').value; periodTo = el('ndLedgerTo').value;
    transactionViewFilter = null;
    renderTransactions();
  };
  // End ledger filter helpers.

  // Daily statement helpers. Closing balances always use the complete ledger.
  function dailyStatement(selected, allTransactions, accountRows, goalRows) {
    const amountCents = value => Math.round(Number(value || 0) * 100);
    const ids = new Set(accountRows.map(account => account.id));
    const base = accountRows.reduce((sum, account) => sum + amountCents(account.initial_balance), 0);
    const events = [];
    allTransactions.forEach(item => {
      if (!item.paid || !ids.has(item.account_id)) return;
      const day = String(item.date || '').slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      events.push({day, delta: (item.type === 'income' ? 1 : -1) * amountCents(item.amount)});
    });
    goalRows.forEach(item => {
      if (!ids.has(item.account_id)) return; // Moving inside the Cofrinho doesn't change available funds.
      const day = String(item.date || item.created_at || '').slice(0,10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
      events.push({day, delta: (item.type === 'deposit' ? -1 : 1) * amountCents(item.amount)});
    });
    events.sort((a,b) => a.day.localeCompare(b.day));
    const groups = new Map();
    selected.forEach(item => {
      const day = effectiveDate(item);
      if (!groups.has(day)) groups.set(day, {day, items: [], paidCents: 0, pendingCents: 0, balanceCents: null});
      const group = groups.get(day);
      group.items.push(item);
      if (item.paid) group.paidCents += amountCents(item.amount);
      else group.pendingCents += amountCents(item.amount);
    });
    let balance = base, cursor = 0;
    [...groups.values()].filter(group => /^\d{4}-\d{2}-\d{2}$/.test(group.day)).sort((a,b) => a.day.localeCompare(b.day)).forEach(group => {
      while (cursor < events.length && events[cursor].day <= group.day) balance += events[cursor++].delta;
      group.balanceCents = balance;
    });
    return [...groups.values()].sort((a,b) => !a.day ? 1 : !b.day ? -1 : a.day.localeCompare(b.day));
  }
  function renderDailyStatement(selected, type) {
    const groups = dailyStatement(selected, transactions, accounts, typeof goalMovements !== 'undefined' ? goalMovements : []);
    const note = '<p class="nd-statement-note">Saldo disponível ao final do dia em todas as contas, considerando receitas recebidas e despesas pagas, sem o valor reservado no Cofrinho. Pendentes não alteram o saldo.</p>';
    return note + groups.map(group => {
      const validDay = /^\d{4}-\d{2}-\d{2}$/.test(group.day);
      const heading = validDay ? new Intl.DateTimeFormat('pt-BR', {weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(group.day+'T12:00:00Z')) : 'Sem data';
      const isFuture = validDay && group.day > today();
      const hasPaid = group.items.some(item => item.paid);
      const paidTotal = hasPaid ? `<div><span>${type === 'income' ? 'Entradas recebidas' : 'Saídas pagas'}</span><strong class="${type === 'income' ? 'income' : 'expense'}">${type === 'income' ? '+' : '−'} ${moneyBR(group.paidCents)}</strong></div>` : '';
      const pendingTotal = group.items.some(item => !item.paid) ? `<div class="nd-day-pending"><span>${type === 'income' ? 'A receber' : 'A pagar'} · previsto</span><strong>${moneyBR(group.pendingCents)}</strong></div>` : '';
      const closing = group.balanceCents !== null && (!isFuture || hasPaid) ? `<div class="nd-day-closing"><span>${isFuture ? 'Saldo registrado para a data' : 'Saldo do dia'}</span><strong class="sensitive-money ${group.balanceCents < 0 ? 'expense' : 'nd-day-balance'}">${moneyBR(group.balanceCents)}</strong></div>` : '';
      return `<section class="nd-statement-day"><header class="nd-day-header"><h3>${escapeHtml(heading)}</h3><small>${group.items.length} ${group.items.length === 1 ? 'lançamento' : 'lançamentos'}</small></header><div class="nd-day-items">${group.items.map(renderTransaction).join('')}</div><footer class="nd-day-footer">${paidTotal}${pendingTotal}${closing}</footer></section>`;
    }).join('');
  }
  function renderLedgerSelection(selected, type, filter) {
    return filter === 'paid' ? renderDailyStatement(selected, type) : selected.map(renderTransaction).join('');
  }
  window.ND_DAILY_STATEMENT = {dailyStatement, renderDailyStatement, renderLedgerSelection};
  // End daily statement helpers.

  function renderInvoiceLedger() {
    const list = el('allTransactions');
    list.classList?.remove('nd-statement-list');
    const cardsById = new Map(creditCards.map(card => [card.id, card]));
    const purchasesById = new Map(cardPurchases.map(purchase => [purchase.id, purchase]));
    const groups = new Map();
    cardInstallments.forEach(item => {
      const month = String(item.invoice_month || '').slice(0, 7);
      if (!month) return;
      const key = `${item.card_id}:${month}`;
      if (!groups.has(key)) groups.set(key, { cardId: item.card_id, month, items: [] });
      groups.get(key).items.push(item);
    });
    const invoices = [...groups.values()].map(invoice => {
      const card = cardsById.get(invoice.cardId);
      const dueMonth = plusDays(invoice.month + '-01', 32).slice(0,7);
      const due = `${dueMonth}-${String(Math.min(Number(card?.due_day || 1), Number(monthEnd(dueMonth).slice(-2)))).padStart(2,'0')}`;
      const paid = invoice.items.every(item => item.paid);
      const payment = (invoicePayments || []).find(p => p.card_id === invoice.cardId && String(p.invoice_month).slice(0,7) === invoice.month);
      return {...invoice, date: paid ? String(payment?.paid_at || due).slice(0,10) : due, due_date: due, paid, id: `${invoice.cardId}:${invoice.month}`};
    }).filter(selectedByLedger).sort((a, b) => ledgerOrder(a,b) ||
      a.month.localeCompare(b.month) || String(cardsById.get(a.cardId)?.name || '').localeCompare(String(cardsById.get(b.cardId)?.name || '')));
    window.ND_LEDGER_VISIBLE_INVOICES = invoices;
    if (el('ndLedgerCount')) el('ndLedgerCount').textContent = `${invoices.length} fatura${invoices.length === 1 ? '' : 's'}`;
    list.innerHTML = invoices.length ? invoices.map(invoice => {
      const card = cardsById.get(invoice.cardId);
      const [year, month] = invoice.month.split('-').map(Number);
      const dueDay = Math.min(Number(card?.due_day || 1), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
      const due = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, dueDay)));
      const total = invoice.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const paid = invoice.items.every(item => item.paid);
      const details = invoice.items.map(item => {
        const purchase = purchasesById.get(item.purchase_id);
        const number = Number(item.installment_number || 1);
        const count = Number(purchase?.installments || 1);
        return `<div class="nd-ledger-invoice-item"><span>${escapeHtml(purchase?.description || 'Compra no cartão')}${count > 1 ? ` (${number}/${count})` : ''}</span><strong>${money(Number(item.amount || 0))}</strong></div>`;
      }).join('');
      return `<div class="nd-ledger-invoice"><div class="nd-ledger-invoice-head"><div><strong>${escapeHtml(card?.name || 'Cartão')}</strong><small>Fatura com vencimento em ${due}</small></div><strong>${money(total)}</strong></div><small>${paid ? 'Paga' : 'Pendente'}</small>${details}</div>`;
    }).join('') : '<div class="empty">Nenhuma fatura no filtro selecionado.</div>';
  }

  window.renderTransactions = function () {
    originalRenderTransactions();
    if (transactionViewFilter === 'receivable') ledgerTab = 'income';
    if (transactionViewFilter === 'payable') ledgerTab = 'expenses';
    document.querySelectorAll('#ndLedgerTabs button').forEach(button => {
      const selected = button.dataset.ledgerTab === ledgerTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    updateLedgerControls();
    if (ledgerTab === 'cards') { renderInvoiceLedger(); return; }
    const type = ledgerTab === 'income' ? 'income' : 'expense';
    const selected = transactions.filter(item => item.type === type && (!transactionViewFilter || !item.paid) && selectedByLedger(item)).sort(ledgerOrder);
    if (el('ndLedgerCount')) el('ndLedgerCount').textContent = `${selected.length} lançamento${selected.length === 1 ? '' : 's'}`;
    el('allTransactions').classList.toggle('nd-statement-list', ledgerFilter === 'paid' && selected.length > 0);
    el('allTransactions').innerHTML = selected.length ? renderLedgerSelection(selected, type, ledgerFilter)
      : `<div class="empty">Nenhuma ${type === 'income' ? 'receita' : 'despesa'} no filtro selecionado.</div>`;
  };

  window.setLedgerTab = function (tab) {
    if (!['income', 'expenses', 'cards'].includes(tab)) return;
    ledgerTab = tab;
    transactionViewFilter = null;
    renderTransactions();
  };

  function dueDate(first, offset) {
    const [year, month, day] = first.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1 + offset, 1));
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  }

  function seriesInput() {
    const total = Number(el('ndInstallmentCount').value);
    const ongoing = el('ndOngoing').checked;
    const next = ongoing ? Number(el('ndNextNumber').value) : 1;
    const amount = cents(el('transactionAmount').value);
    const lastRaw = el('ndLastAmount').value;
    const last = ongoing && lastRaw !== '' ? cents(lastRaw) : null;
    const firstDue = el('ndFirstDue').value;
    if (!Number.isInteger(total) || total < 2 || total > 120 ||
        !Number.isInteger(next) || next < 1 || next > total ||
        !Number.isSafeInteger(amount) || amount <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(firstDue) ||
        (last !== null && (!Number.isSafeInteger(last) || last <= 0)) ||
        (!ongoing && amount < total)) return null;
    const rows = [];
    for (let number = next; number <= total; number++) {
      const value = ongoing ? (number === total && last !== null ? last : amount)
        : Math.floor(amount / total) + (number === total ? amount % total : 0);
      rows.push({ number, value, due: dueDate(firstDue, number - next) });
    }
    return { total, next, amount, ongoing, last, firstDue, rows };
  }

  function updateSeriesPreview() {
    const ongoing = el('ndOngoing').checked;
    el('ndNextWrap').classList.toggle('hidden', !ongoing);
    el('ndLastWrap').classList.toggle('hidden', !ongoing);
    el('transactionAmount').previousElementSibling.textContent = ongoing ? 'Valor de cada parcela restante' : 'Valor total do parcelamento';
    const info = seriesInput();
    const preview = el('ndSeriesPreview');
    if (!info) { preview.textContent = 'Informe o valor, o número de parcelas e o primeiro vencimento.'; return; }
    const rows = info.rows;
    preview.textContent = `${rows.length} parcelas a criar: ${rows[0].number}/${info.total} em ${rows[0].due.split('-').reverse().join('/')} (${moneyBR(rows[0].value)}) até ${rows.at(-1).number}/${info.total} em ${rows.at(-1).due.split('-').reverse().join('/')} (${moneyBR(rows.at(-1).value)}). Total restante: ${moneyBR(rows.reduce((sum, row) => sum + row.value, 0))}.`;
  }

  function fillSeriesCategories() {
    const category = el('ndInstallmentCategory');
    const previous = category.value;
    const available = [...new Set([...EXPENSE_CATEGORIES, ...customCats('expense')])];
    category.replaceChildren(...available.map(name => new Option(name, name)));
    if (available.includes(previous)) category.value = previous;
  }

  window.updateSmartTransactionForm = function () {
    originalUpdate();
    const expense = el('transactionType').value === 'expense';
    const parcelled = expense && el('transactionInstallment').value === 'yes';
    el('ndPaymentModeWrap').classList.toggle('hidden', !parcelled);
    const mode = el('ndPaymentMode').value;
    el('txCardFields').classList.toggle('hidden', !(parcelled && mode === 'card'));
    el('ndNonCardFields').classList.toggle('hidden', !(parcelled && mode === 'no_card'));
    if (parcelled && mode === 'no_card') { fillSeriesCategories(); updateSeriesPreview(); }
    if (!parcelled || mode !== 'no_card') el('transactionAmount').previousElementSibling.textContent = 'Valor';
  };

  window.resetTxForm = function () {
    originalReset();
    el('ndPaymentMode').value = '';
    el('ndOngoing').checked = false;
    el('ndInstallmentCount').value = '2';
    el('ndNextNumber').value = '1';
    el('ndLastAmount').value = '';
    el('ndFirstDue').value = today();
    el('ndPaymentModeWrap').classList.add('hidden');
    el('ndNonCardFields').classList.add('hidden');
    el('transactionAmount').previousElementSibling.textContent = 'Valor';
  };

  window.saveSmartTransaction = async function () {
    if (el('transactionType').value !== 'expense' || el('transactionInstallment').value !== 'yes') return originalSave();
    const mode = el('ndPaymentMode').value;
    if (!mode) { alert('Escolha se o parcelamento foi no cartão ou sem cartão.'); return; }
    if (mode === 'card') return originalSave();
    const info = seriesInput();
    const description = el('transactionDescription').value.trim();
    if (!currentUser || !GROUP_ID) { alert('Entre na conta antes de salvar.'); return; }
    if (!description || !info) { alert('Confira descrição, valor, parcelas e vencimento.'); return; }
    if (saving) return;
    if (!confirm(`Criar ${info.rows.length} despesas de ${description}?\n${el('ndSeriesPreview').textContent}\n\nAs parcelas anteriores não serão cadastradas.`)) return;
    saving = true;
    try {
      const seriesId = crypto.randomUUID();
      const { error } = await supabaseClient.rpc('create_my_noncard_installments', {
        p_group_id: GROUP_ID,
        p_series_id: seriesId,
        p_description: description,
        p_category: el('ndInstallmentCategory').value,
        p_amount_cents: info.amount,
        p_amount_mode: info.ongoing ? 'each' : 'total',
        p_installments: info.total,
        p_next_installment: info.next,
        p_first_due: info.firstDue,
        p_last_amount_cents: info.last
      });
      if (error) throw error;
      if (typeof ndGscTag === 'function') await ndGscTag({ series: seriesId });
      closeTransactionModal();
      await loadCloudData();
      renderAll();
    } catch (error) { alert('Não foi possível criar as parcelas: ' + error.message); }
    finally { saving = false; }
  };

  function parseReceipt(text) {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const amountFrom = s => {
      const parts = String(s).match(/(?:R\$\s*)?\d{1,6}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?\d{1,6}\.\d{2}/g) || [];
      const raw = parts.at(-1);
      if (!raw) return null;
      const digits = raw.replace(/R\$\s*/, '');
      const normalized = digits.includes(',') ? digits.replace(/\./g, '').replace(',', '.') : digits;
      const value = Number(normalized);
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    const candidates = lines.map((line, index) => {
      const clean = line.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (/SUBTOTAL|DESCONTO|TROCO|TRIBUTOS|VALOR APROX|IMPOSTO|TOTAL DE ITENS/.test(clean)) return null;
      const score = /TOTAL A PAGAR|VALOR PAGO|TOTAL PAGO/.test(clean) ? 4
        : /VALOR TOTAL|TOTAL DA NOTA|TOTAL DA COMPRA/.test(clean) ? 3
        : /^\s*TOTAL\b/.test(clean) ? 2 : 0;
      if (!score) return null;
      return { score, amount: amountFrom(line) ?? amountFrom(lines[index + 1] || '') };
    }).filter(x => x && x.amount !== null);
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const ambiguous = best && candidates.some(x => x.score === best.score && x.amount !== best.amount);
    const paymentText = lines.join(' ').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const payments = [
      [/\bPIX\b/, 'pix'], [/\bDEBITO\b/, 'debit'],
      [/\bCREDITO\b/, 'credit'], [/\bDINHEIRO\b|\bESPECIE\b/, 'cash']
    ].filter(([pattern]) => pattern.test(paymentText)).map(([, value]) => value);
    const dateMatch = lines.join(' ').match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
    const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : '';
    const store = lines.slice(0, 9).find(line =>
      /[A-Za-zÀ-ÿ]{3}/.test(line) && !/CNPJ|CPF|NFC|DANFE|DOCUMENTO|CUPOM|FISCAL|ENDEREÇO|ENDERECO|https?:|www\./i.test(line)) || '';
    return { store: store.slice(0, 100), amount: ambiguous ? null : best?.amount || null,
      date, payment: payments.length === 1 ? payments[0] : '', ambiguous: !!ambiguous };
  }
  window.NDReceiptParser = { parseReceipt, seriesInput, dueDate };

  window.openReceiptCapture = async function (source) {
    if (!currentUser) { alert('Entre na sua conta antes de lançar um cupom.'); return; }
    const transactionModal = el('transactionModal');
    if (!transactionModal.classList.contains('hidden')) {
      receiptReturnToTransaction = true;
      transactionModal.classList.add('hidden');
      document.documentElement.classList.remove('nd-transaction-open');
      document.body.classList.remove('nd-transaction-open');
    }
    const modal = el('ndReceiptModal');
    modal.classList.remove('hidden');
    el('ndReceiptStatus').textContent = 'Lendo a imagem no aparelho...';
    el('ndReceiptPreview').removeAttribute('src');
    el('ndReceiptReview').classList.add('hidden');
    if (!window.NDReceiptNative?.scan) {
      el('ndReceiptStatus').textContent = 'Leitura disponível no APK atualizado. Feche esta tela e lance manualmente.';
      return;
    }
    try {
      const result = await window.NDReceiptNative.scan(source);
      if (result.preview) el('ndReceiptPreview').src = result.preview;
      const data = parseReceipt(result.text);
      el('ndReceiptStore').value = data.store;
      el('ndReceiptAmount').value = data.amount ?? '';
      el('ndReceiptDate').value = data.date;
      el('ndReceiptPayment').value = data.payment;
      const cats = [...new Set([...EXPENSE_CATEGORIES, ...customCats('expense')])];
      el('ndReceiptCategory').replaceChildren(new Option('Escolha a categoria', ''), ...cats.map(x => new Option(x, x)));
      el('ndReceiptStatus').textContent = result.warning || (!result.text?.trim()
        ? 'Não encontrei texto na imagem. Preencha os dados manualmente e confira antes de continuar.' : data.ambiguous
        ? 'Há valores totais diferentes na imagem. Confira e preencha o valor correto.'
        : 'Confira todos os campos; o cupom ainda não foi salvo.');
      el('ndReceiptReview').classList.remove('hidden');
    } catch (error) {
      el('ndReceiptStatus').textContent = /cancel/i.test(String(error?.message || error))
        ? 'Captura cancelada.' : 'Não foi possível ler a imagem. Tente outra foto ou lance manualmente.';
    }
  };

  window.closeReceiptCapture = function (restoreTransaction = true) {
    el('ndReceiptModal').classList.add('hidden');
    el('ndReceiptPreview').removeAttribute('src');
    if (restoreTransaction && receiptReturnToTransaction) el('transactionModal').classList.remove('hidden');
    receiptReturnToTransaction = false;
  };

  window.useReceiptDraft = function () {
    const description = el('ndReceiptStore').value.trim();
    const amount = Number(el('ndReceiptAmount').value);
    const date = el('ndReceiptDate').value;
    const payment = el('ndReceiptPayment').value;
    const category = el('ndReceiptCategory').value;
    if (!description || !Number.isFinite(amount) || amount <= 0 || !date) {
      alert('Informe estabelecimento, data e valor antes de continuar.'); return;
    }
    if (!payment) { alert('Confirme a forma de pagamento antes de continuar.'); return; }
    if (payment === 'credit') {
      if (!creditCards.length) { alert('Cadastre o cartão correspondente para esta compra.'); return; }
      closeReceiptCapture(false);
      openPurchaseModal();
      el('purchaseDescription').value = description;
      el('purchaseAmount').value = amount.toFixed(2);
      el('purchaseDate').value = date;
      if ([...el('purchaseCategory').options].some(x => x.value === category)) el('purchaseCategory').value = category;
      alert('Confira o cartão, a categoria e a quantidade de parcelas antes de salvar.');
    } else {
      if (!accounts.length) { alert('Cadastre uma conta para lançar a despesa paga.'); return; }
      closeReceiptCapture(false);
      openTransactionModal();
      chooseTxType('expense');
      el('transactionDescription').value = description;
      el('transactionAmount').value = amount.toFixed(2);
      el('transactionInstallment').value = 'no';
      updateSmartTransactionForm();
      if ([...el('transactionCategory').options].some(x => x.value === category)) el('transactionCategory').value = category;
      el('transactionDate').value = date;
      // A conta não é presumida a partir do texto do cupom.
      alert(`Pagamento identificado: ${el('ndReceiptPayment').selectedOptions[0].text}. Confirme a conta e marque “Pago” antes de salvar.`);
    }
  };

  function init() {
    const tabs = document.createElement('nav');
    tabs.id = 'ndLedgerTabs';
    tabs.setAttribute('aria-label', 'Tipo de lançamento');
    tabs.innerHTML = `<button type="button" data-ledger-tab="income" onclick="setLedgerTab('income')">Receitas</button><button type="button" data-ledger-tab="expenses" onclick="setLedgerTab('expenses')">Despesas</button><button type="button" data-ledger-tab="cards" onclick="setLedgerTab('cards')">Cartões / Faturas</button>`;
    el('transactionsSection').querySelector('.card:first-child').append(tabs);
    tabs.insertAdjacentHTML('afterend', `<div id="ndLedgerFilters"><div><label for="ndLedgerFilter">Mostrar</label><select id="ndLedgerFilter" onchange="changeLedgerFilter()"><option value="month">Lançamentos do mês</option><option value="overdue">Vencidas</option><option value="week">Próximos 7 dias</option><option value="paid">Pagas / Recebidas</option><option value="period">Selecionar período</option><option value="all">Todos os lançamentos</option></select></div><div id="ndLedgerMonthWrap"><label for="ndLedgerMonth">Mês</label><input id="ndLedgerMonth" type="month" onchange="changeLedgerFilter()"></div><div id="ndLedgerPeriod" class="hidden"><div><label for="ndLedgerFrom">De</label><input id="ndLedgerFrom" type="date" onchange="changeLedgerFilter()"></div><div><label for="ndLedgerTo">Até</label><input id="ndLedgerTo" type="date" onchange="changeLedgerFilter()"></div></div><small id="ndLedgerFilterHint"></small><small id="ndLedgerCount" aria-live="polite"></small></div>`);
    const filterStyle = document.createElement('style');
    filterStyle.textContent = `#ndLedgerFilters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:16px}#ndLedgerFilters label{display:block;margin:0 0 5px;color:inherit}#ndLedgerFilters input,#ndLedgerFilters select{width:100%;min-width:0;margin:0}#ndLedgerPeriod{display:grid;grid-template-columns:1fr 1fr;gap:12px;grid-column:1/-1}#ndLedgerFilterHint,#ndLedgerCount{grid-column:1/-1;color:var(--muted,#b5c4d3)}#ndLedgerFilterHint:empty{display:none}#ndLedgerFilters .hidden{display:none!important}#ndLedgerTabs button.active{background:#1d73d8!important;border-color:#1d73d8!important;color:#fff!important}#ndLedgerTabs button:not(.active){background:transparent!important;color:inherit!important}@media(max-width:380px){#ndLedgerFilters{grid-template-columns:1fr}}`;
    document.head.append(filterStyle);
    const dailyStyle = document.createElement('style');
    dailyStyle.textContent = `#transactionsSection #allTransactions{background:var(--surface2,#f0f5fb)!important;color:var(--ink,#17324a)!important;border-color:var(--line,#d3dfeb)!important}#transactionsSection #allTransactions .transaction{background:transparent!important;border-color:var(--line,#d3dfeb)!important}#transactionsSection #allTransactions .transaction-desc{color:var(--ink,#17324a)!important}#transactionsSection #allTransactions .transaction-info{color:var(--muted,#526a80)!important}#transactionsSection #allTransactions.nd-statement-list{background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important}html[data-theme="dark"] .nd-statement-day .transaction-desc{color:#f0f6fc!important}html[data-theme="dark"] .nd-statement-day .transaction-info{color:#c4d5e5!important}html[data-theme="dark"] .nd-statement-day .transaction{border-color:#446077}.nd-statement-note{margin:0 0 18px;padding:12px 14px;border-radius:10px;background:#eaf2fc;color:#38566f;font-size:12px;line-height:1.5}.nd-statement-day{margin:0 0 22px;border:1px solid #d3dfeb;border-radius:14px;overflow:hidden;background:var(--surface2,#f0f5fb);color:var(--ink,#17324a)}.nd-day-header{padding:15px 18px;background:var(--surface,#e9f1fa);border-bottom:1px solid #d3dfeb;display:flex;align-items:center;justify-content:space-between;gap:12px}.nd-day-header h3{font-size:15px;margin:0!important;color:#15334f!important;text-transform:capitalize;line-height:1.4}.nd-day-header small{font-size:11px;color:#526a80;white-space:nowrap}.nd-day-items{padding:0 18px}.nd-day-items .transaction:last-child{border-bottom:0}.nd-day-footer{padding:14px 18px;border-top:1px solid #d3dfeb;background:var(--surface,#e9f1fa);display:grid;gap:10px}.nd-day-footer>div{display:flex;justify-content:space-between;align-items:baseline;gap:14px}.nd-day-footer span{font-size:13px;line-height:1.4}.nd-day-footer strong{white-space:nowrap;font-size:15px}.nd-day-closing{padding-top:10px;border-top:1px solid #d3dfeb;font-weight:700}.nd-day-closing:first-child{border-top:0;padding-top:0}.nd-day-pending{color:#635a33}.nd-day-balance{color:#15497b}.dark .nd-statement-note,html[data-theme="dark"] .nd-statement-note{background:#183449;color:#d4e2ef}.dark .nd-statement-day,html[data-theme="dark"] .nd-statement-day{background:#13283b;color:#e5edf5;border-color:#446077}.dark .nd-day-header,html[data-theme="dark"] .nd-day-header{background:#193248;border-color:#446077}.dark .nd-day-header h3,html[data-theme="dark"] .nd-day-header h3{color:#f0f6fc!important}.dark .nd-day-header small,html[data-theme="dark"] .nd-day-header small{color:#c4d5e5}.dark .nd-day-footer,html[data-theme="dark"] .nd-day-footer{background:#102335;border-color:#446077}.dark .nd-day-closing,html[data-theme="dark"] .nd-day-closing{border-color:#446077}.dark .nd-day-pending,html[data-theme="dark"] .nd-day-pending{color:#ecd8a3}.dark .nd-day-balance,html[data-theme="dark"] .nd-day-balance{color:#8ec5ff}@media(max-width:520px){.nd-day-header{align-items:flex-start;flex-direction:column;gap:3px;padding:13px 14px}.nd-day-items{padding:0 14px}.nd-day-footer{padding:13px 14px}.nd-day-header h3{font-size:14px}.nd-day-footer strong{font-size:16px}}`;
    document.head.append(dailyStyle);

    window.ND_LEDGER_FILTERS_ACTIVE = true;
    updateLedgerControls();
    let dashboardEntry = false;
    const oldDashboardFilter = window.openDashboardFilter;
    window.openDashboardFilter = function () {
      dashboardEntry = true;
      try { return oldDashboardFilter.apply(this,arguments); }
      finally { dashboardEntry = false; }
    };
    const oldShow = window.showSection;
    window.showSection = function(id) {
      if (id === 'transactionsSection' && el(id).classList.contains('hidden')) {
        if (!dashboardEntry) transactionViewFilter = null;
        ledgerFilter = 'month'; ledgerMonth = dashboardEntry ? (window.ND_SELECTED_MONTH || today().slice(0,7)) : today().slice(0,7);
        updateLedgerControls();
      }
      return oldShow.apply(this,arguments);
    };

    const installment = document.createElement('div');
    installment.innerHTML = `<div id="ndPaymentModeWrap" class="form-block hidden"><label>Onde foi feito o parcelamento?</label><select id="ndPaymentMode" onchange="updateSmartTransactionForm()"><option value="">Selecione...</option><option value="card">No cartão</option><option value="no_card">Sem cartão (acordo ou despesa)</option></select></div>
      <div id="ndNonCardFields" class="form-block hidden"><label>Categoria</label><select id="ndInstallmentCategory"></select>
      <label>Quantidade total de parcelas</label><input id="ndInstallmentCount" type="number" min="2" max="120" value="2">
      <label class="nd-inline-check"><input id="ndOngoing" type="checkbox"> Parcelamento já em andamento</label>
      <div id="ndNextWrap" class="hidden"><label>Qual é a próxima parcela?</label><input id="ndNextNumber" type="number" min="1" max="120" value="1"></div>
      <label>Vencimento da primeira parcela a cadastrar</label><input id="ndFirstDue" type="date">
      <div id="ndLastWrap" class="hidden"><label>Valor da última parcela, se for diferente (opcional)</label><input id="ndLastAmount" type="number" step="0.01" min="0.01"></div>
      <small id="ndSeriesPreview" class="nd-feature-hint"></small></div>`;
    el('txCardFields').after(...installment.children);
    ['ndInstallmentCount', 'ndOngoing', 'ndNextNumber', 'ndFirstDue', 'ndLastAmount', 'transactionAmount'].forEach(id =>
      el(id).addEventListener('input', updateSeriesPreview));
    el('ndOngoing').addEventListener('change', updateSeriesPreview);
    el('ndFirstDue').value = today();

    const scan = document.createElement('button');
    scan.type = 'button'; scan.className = 'nd-scan-entry';
    scan.textContent = '📷 Ler cupom ou notinha';
    scan.onclick = () => openReceiptCapture('camera');
    el('txStepType').append(scan);
    const modal = document.createElement('div');
    modal.id = 'ndReceiptModal'; modal.className = 'modal hidden';
    modal.innerHTML = `<div class="modal-content nd-receipt-content"><button class="close" onclick="closeReceiptCapture()">×</button>
      <h2>Ler cupom ou notinha</h2><p>Fotografe ou escolha uma imagem. Revise os dados antes de criar o lançamento.</p>
      <div class="nd-receipt-choices"><button class="secondary" onclick="openReceiptCapture('camera')">Tirar foto</button><button class="secondary" onclick="openReceiptCapture('photos')">Escolher imagem</button></div>
      <div id="ndReceiptStatus" class="nd-feature-hint"></div><img id="ndReceiptPreview" alt="Prévia do cupom selecionado">
      <div id="ndReceiptReview" class="hidden"><label>Loja / estabelecimento</label><input id="ndReceiptStore">
      <label>Valor total pago</label><input id="ndReceiptAmount" type="number" min="0.01" step="0.01">
      <label>Data</label><input id="ndReceiptDate" type="date">
      <label>Forma de pagamento</label><select id="ndReceiptPayment"><option value="">Escolha após conferir</option><option value="pix">Pix</option><option value="debit">Débito</option><option value="cash">Dinheiro</option><option value="credit">Crédito</option></select>
      <label>Categoria</label><select id="ndReceiptCategory"></select><button class="primary" onclick="useReceiptDraft()">Usar no lançamento</button></div></div>`;
    document.body.append(modal);
    const styles = document.createElement('style');
    styles.textContent = `.nd-feature-hint{display:block;color:var(--muted,#a6b5c4);font-size:13px;line-height:1.4;margin:10px 0}.nd-inline-check{display:flex;align-items:center;gap:10px;margin-top:12px}.nd-inline-check input{width:auto!important}.nd-scan-entry{display:block;width:100%;margin-top:14px;padding:13px;border:1px solid #3f698e;border-radius:12px;background:#153b5b;color:#fff;font-weight:700}#ndReceiptModal{z-index:6000!important}#ndReceiptModal .nd-receipt-content{max-height:min(90dvh,850px);overflow:auto}#ndLedgerTabs{display:flex;gap:8px;margin-top:16px;overflow-x:auto}#ndLedgerTabs button{flex:1;min-width:max-content;border:1px solid #4c6780;border-radius:10px;background:transparent;color:var(--text,#dce7f1);padding:10px 12px;font-weight:700}#ndLedgerTabs button.active{background:#1d73d8;border-color:#1d73d8;color:#fff}.nd-ledger-invoice{padding:16px 0;border-bottom:1px solid var(--line,#415166)}.nd-ledger-invoice-head,.nd-ledger-invoice-item{display:flex;justify-content:space-between;gap:12px;align-items:center}.nd-ledger-invoice-head small{display:block;margin:5px 0}.nd-ledger-invoice-item{padding:7px 0}.nd-ledger-invoice-item strong{white-space:nowrap}.nd-receipt-choices{display:flex;gap:8px;margin:12px 0}.nd-receipt-choices button{flex:1}.nd-receipt-content img{display:block;max-width:100%;max-height:180px;object-fit:contain;margin:8px auto}.nd-receipt-content img:not([src]){display:none}.nd-receipt-content label{display:block;margin-top:10px}.nd-receipt-content input,.nd-receipt-content select{width:100%}.nd-receipt-content .primary{margin-top:18px}`;
    document.head.append(styles);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* Monthly recurrence and complete management of remaining card installments. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const monthShift = (month, offset) => {
    const [y, m] = month.slice(0, 7).split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const thisMonth = () => today().slice(0, 7);
  let busy = false;
  const fixedLabel = el('fixedLabel');
  fixedLabel?.insertAdjacentHTML('afterend', '<small id="ndFixedHelp">Despesas fixas geram os próximos 12 meses automaticamente. Os próximos lançamentos ficam pendentes e o período é renovado todo mês.</small>');
  const previousForm = window.updateSmartTransactionForm;
  window.updateSmartTransactionForm = function () {
    previousForm();
    el('ndFixedHelp')?.classList.toggle('hidden', el('transactionType').value !== 'expense' || el('transactionInstallment').value === 'yes');
  };

  el('purchaseExistingFields').insertAdjacentHTML('beforeend', '<label>Mês de vencimento da próxima parcela</label><input id="ndPurchaseDueMonth" type="month"><small>Escolha o mês em que essa parcela vence no banco.</small>');
  function setPurchaseDueMonth() {
    el('ndPurchaseDueMonth').value = monthShift(thisMonth(), el('purchaseFirstInvoice').value === 'next' ? 1 : 0);
  }
  el('purchaseFirstInvoice').addEventListener('change', setPurchaseDueMonth);
  const oldOpenPurchase = window.openPurchaseModal;
  window.openPurchaseModal = function () { oldOpenPurchase(); setPurchaseDueMonth(); };
  const oldSavePurchase = window.saveCardPurchase;
  window.saveCardPurchase = async function () {
    if (!el('purchaseExisting').checked) return oldSavePurchase();
    if (busy) return;
    const args = {
      p_id: crypto.randomUUID(), p_group_id: GROUP_ID,
      p_card_id: el('purchaseCard').value, p_description: el('purchaseDescription').value.trim(),
      p_total_amount: Number(el('purchaseAmount').value), p_purchase_date: el('purchaseDate').value,
      p_category: el('purchaseCategory').value || null, p_installments: Number(el('purchaseInstallments').value),
      p_next_installment: Number(el('purchaseNextInstallment').value), p_first_due_month: el('ndPurchaseDueMonth').value + '-01'
    };
    if (!args.p_description || !args.p_card_id || !args.p_purchase_date || !el('ndPurchaseDueMonth').value || args.p_total_amount <= 0 || !Number.isInteger(args.p_installments) || args.p_installments < 1 || args.p_installments > 120 || !Number.isInteger(args.p_next_installment) || args.p_next_installment < 1 || args.p_next_installment > args.p_installments) { alert('Confira descrição, valor, parcelas e mês de vencimento.'); return; }
    busy = true;
    try {
      const { error } = await supabaseClient.rpc('save_my_existing_card_purchase_at_month', args);
      if (error) throw error;
      closePurchaseModal(); await loadCloudData(); renderAll();
    } catch (e) { alert('Erro ao salvar compra: ' + e.message); }
    finally { busy = false; }
  };

  const modal = el('editCardPurchaseModal');
  el('editCardPurchaseTotalInstallments').disabled = false;
  el('editCardPurchaseTotalInstallments').min = 1;
  el('editCardPurchaseTotalInstallments').max = 120;
  modal.querySelector('h2').insertAdjacentHTML('afterend', `<label>Cartão</label><select id="ndEditPurchaseCard"></select>
    <label>Parcela pendente a alterar</label><select id="ndEditPurchaseItem"></select>
    <label>Aplicar a</label><select id="ndEditPurchaseScope"><option value="remaining">Esta parcela e as seguintes ainda pendentes</option><option value="one">Somente esta parcela</option></select>
    <label>Mês de vencimento dessa parcela</label><input id="ndEditPurchaseDueMonth" type="month">
    <label>Número dessa parcela</label><input id="ndEditPurchaseNext" type="number" min="1" max="120">`);
  modal.querySelector('small').textContent = 'O mês informado é o vencimento no banco. As seguintes ficam nos meses seguintes. Parcelas pagas são preservadas.';
  modal.querySelector('.primary').insertAdjacentHTML('afterend', '<button class="secondary" id="ndDeletePurchase" type="button">Excluir parcelas selecionadas</button>');
  function pendingItems() { return cardInstallments.filter(i => i.purchase_id === el('editCardPurchaseId').value && !i.paid).sort((a,b) => a.installment_number-b.installment_number); }
  function selectedItem() { return pendingItems().find(i => i.id === el('ndEditPurchaseItem').value); }
  function fillSelected() {
    const item = selectedItem(); if (!item) return;
    el('ndEditPurchaseNext').value = item.installment_number;
    el('ndEditPurchaseDueMonth').value = monthShift(item.invoice_month, 1);
    el('editCardPurchaseInstallmentAmount').value = Number(item.amount).toFixed(2);
  }
  function scopeChanged() {
    const one = el('ndEditPurchaseScope').value === 'one';
    el('ndEditPurchaseNext').disabled = one;
    el('editCardPurchaseTotalInstallments').disabled = one;
    el('ndEditPurchaseCard').disabled = one;
    if (one) {
      const p = cardPurchases.find(p => p.id === el('editCardPurchaseId').value);
      el('ndEditPurchaseCard').value = p.card_id;
      el('editCardPurchaseTotalInstallments').value = p.installments;
      el('ndEditPurchaseNext').value = selectedItem()?.installment_number || 1;
    }
  }
  el('ndEditPurchaseItem').addEventListener('change', fillSelected);
  el('ndEditPurchaseScope').addEventListener('change', scopeChanged);
  const oldEdit = window.openEditCardPurchase;
  window.openEditCardPurchase = function (id) {
    const items = cardInstallments.filter(i => i.purchase_id === id && !i.paid).sort((a,b) => a.installment_number-b.installment_number);
    if (!items.length) { alert('Essa compra não tem parcelas pendentes. As parcelas pagas são preservadas.'); return; }
    oldEdit(id);
    el('ndEditPurchaseCard').replaceChildren(...creditCards.map(c => new Option(c.name,c.id)));
    el('ndEditPurchaseCard').value = cardPurchases.find(p => p.id === id).card_id;
    el('ndEditPurchaseItem').replaceChildren(...items.map(i => new Option(`Parcela ${i.installment_number} — vence em ${monthShift(i.invoice_month,1).split('-').reverse().join('/')}`,i.id)));
    el('ndEditPurchaseScope').value = 'remaining';
    fillSelected(); scopeChanged();
  };
  window.saveEditedCardPurchase = async function () {
    if (busy) return;
    const args = {
      p_group_id: GROUP_ID, p_purchase_id: el('editCardPurchaseId').value,
      p_installment_id: el('ndEditPurchaseItem').value, p_scope: el('ndEditPurchaseScope').value,
      p_card_id: el('ndEditPurchaseCard').value, p_description: el('editCardPurchaseDescription').value.trim(),
      p_category: el('editCardPurchaseCategory').value || null, p_purchase_date: el('editCardPurchaseDate').value,
      p_amount: Number(el('editCardPurchaseInstallmentAmount').value), p_next_number: Number(el('ndEditPurchaseNext').value),
      p_total: Number(el('editCardPurchaseTotalInstallments').value), p_due_month: el('ndEditPurchaseDueMonth').value + '-01'
    };
    if (!args.p_description || !args.p_purchase_date || !el('ndEditPurchaseDueMonth').value || args.p_amount <= 0 || !Number.isInteger(args.p_next_number) || !Number.isInteger(args.p_total) || args.p_next_number < 1 || args.p_next_number > args.p_total || args.p_total > 120) { alert('Confira valor, numeração e vencimento.'); return; }
    busy = true;
    try {
      const { error } = await supabaseClient.rpc('edit_my_card_installments',args); if (error) throw error;
      closeEditCardPurchase(); await loadCloudData(); renderAll();
    } catch (e) { alert('Erro ao editar: ' + e.message); }
    finally { busy = false; }
  };
  el('ndDeletePurchase').addEventListener('click', async () => {
    if (busy) return;
    const item = selectedItem(); if (!item) return;
    const scope = el('ndEditPurchaseScope').value;
    if (!confirm(scope === 'one' ? `Excluir somente a parcela ${item.installment_number}?` : `Excluir a parcela ${item.installment_number} e as seguintes pendentes? As parcelas pagas serão mantidas.`)) return;
    busy = true;
    try {
      const { error } = await supabaseClient.rpc('delete_my_card_installments',{p_group_id:GROUP_ID,p_purchase_id:el('editCardPurchaseId').value,p_installment_id:item.id,p_scope:scope}); if (error) throw error;
      closeEditCardPurchase(); await loadCloudData(); renderAll();
    } catch (e) { alert('Erro ao excluir: ' + e.message); }
    finally { busy = false; }
  });
})();

/* Change a recurring expense amount for one month or from this month onward. */
(function () {
  const el = id => document.getElementById(id);
  let saving = false;
  el('editTxAmount').insertAdjacentHTML('afterend', `<div id="ndRecurringEditScope" class="hidden"><label>Aplicar o valor a</label><select id="ndRecurringAmountScope"><option value="one">Somente este mês</option><option value="forward">Este mês e os próximos</option></select><small>“Este mês e os próximos” altera o valor das despesas pendentes e das novas que forem geradas. Despesas já pagas são preservadas.</small></div>`);
  const oldOpen = window.openEditTransaction;
  window.openEditTransaction = function (id) {
    oldOpen(id);
    const t = transactions.find(t => t.id === id);
    const activeRoot = t?.recurrence_series_id && transactions.some(r => r.id === t.recurrence_series_id && r.fixed);
    el('ndRecurringEditScope').classList.toggle('hidden', !(activeRoot && t.type === 'expense' && !t.paid));
    el('ndRecurringAmountScope').value = 'one';
  };
  const oldSave = window.saveEditedTransaction;
  window.saveEditedTransaction = async function () {
    const id = el('editTxId').value;
    const t = transactions.find(t => t.id === id);
    if (!t?.recurrence_series_id) return oldSave();
    if (saving) return;
    const amount = Number(el('editTxAmount').value);
    const description = el('editTxDescription').value.trim();
    const type = el('editTxType').value;
    const paid = el('editTxPaid').value === 'yes';
    const fixed = type === 'expense' && el('editTxFixed').checked;
    const scope = el('ndRecurringEditScope').classList.contains('hidden') ? 'one' : el('ndRecurringAmountScope').value;
    if (!description || !Number.isFinite(amount) || amount <= 0) { alert('Preencha descrição e valor.'); return; }
    if (scope === 'forward' && !fixed) { alert('Mantenha a opção Fixo / recorrente para alterar os próximos meses.'); return; }
    if (scope === 'forward' && !confirm(`Aplicar ${money(amount)} a este mês e às próximas despesas pendentes? As já pagas serão preservadas.`)) return;
    saving = true;
    try {
      const { error } = await supabaseClient.rpc('update_my_transaction_with_recurrence', {
        p_transaction_id:id, p_group_id:GROUP_ID, p_type:type, p_description:description, p_amount:amount,
        p_category:el('editTxCategory').value.trim() || null,
        p_account_id:paid ? el('editTxAccount').value : null,
        p_date:paid ? el('editTxDate').value : (el('editTxDueDate').value || today()),
        p_due_date:paid ? null : (el('editTxDueDate').value || null),
        p_paid:paid, p_fixed:fixed, p_scope:scope
      });
      if (error) throw error;
      closeEditTransaction(); await loadCloudData(); renderAll();
    } catch (error) { alert('Erro ao editar: ' + error.message); }
    finally { saving = false; }
  };
})();
