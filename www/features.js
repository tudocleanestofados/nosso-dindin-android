/* Nosso Dindin: despesas parceladas sem cartão e leitura de comprovantes. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const cents = value => Math.round(Number(value) * 100);
  const moneyBR = value => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const originalUpdate = window.updateSmartTransactionForm;
  const originalSave = window.saveSmartTransaction;
  const originalReset = window.resetTxForm;
  let saving = false;

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
      const { error } = await supabaseClient.rpc('create_my_noncard_installments', {
        p_group_id: GROUP_ID,
        p_series_id: crypto.randomUUID(),
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
      el('ndReceiptStatus').textContent = data.ambiguous
        ? 'Há valores totais diferentes na imagem. Confira e preencha o valor correto.'
        : 'Confira todos os campos; o cupom ainda não foi salvo.';
      el('ndReceiptReview').classList.remove('hidden');
    } catch (error) {
      el('ndReceiptStatus').textContent = /cancel/i.test(String(error?.message || error))
        ? 'Captura cancelada.' : 'Não foi possível ler a imagem. Tente outra foto ou lance manualmente.';
    }
  };

  window.closeReceiptCapture = function () {
    el('ndReceiptModal').classList.add('hidden');
    el('ndReceiptPreview').removeAttribute('src');
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
      closeReceiptCapture();
      openPurchaseModal();
      el('purchaseDescription').value = description;
      el('purchaseAmount').value = amount.toFixed(2);
      el('purchaseDate').value = date;
      if ([...el('purchaseCategory').options].some(x => x.value === category)) el('purchaseCategory').value = category;
      alert('Confira o cartão, a categoria e a quantidade de parcelas antes de salvar.');
    } else {
      if (!accounts.length) { alert('Cadastre uma conta para lançar a despesa paga.'); return; }
      closeReceiptCapture();
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
    styles.textContent = `.nd-feature-hint{display:block;color:var(--muted,#a6b5c4);font-size:13px;line-height:1.4;margin:10px 0}.nd-inline-check{display:flex;align-items:center;gap:10px;margin-top:12px}.nd-inline-check input{width:auto!important}.nd-scan-entry{display:block;width:100%;margin-top:14px;padding:13px;border:1px solid #3f698e;border-radius:12px;background:#153b5b;color:#fff;font-weight:700}.nd-receipt-content{max-height:88vh;overflow:auto}.nd-receipt-choices{display:flex;gap:8px;margin:12px 0}.nd-receipt-choices button{flex:1}.nd-receipt-content img{display:block;max-width:100%;max-height:180px;object-fit:contain;margin:8px auto}.nd-receipt-content img:not([src]){display:none}.nd-receipt-content label{display:block;margin-top:10px}.nd-receipt-content input,.nd-receipt-content select{width:100%}.nd-receipt-content .primary{margin-top:18px}`;
    document.head.append(styles);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
