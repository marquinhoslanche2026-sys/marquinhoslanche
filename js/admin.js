/* =====================================================================
   Marquinho's Lanches — lógica do painel administrativo
   Depende de: backend-config.js (Supabase) e da biblioteca supabase-js
   ===================================================================== */
'use strict';

const cfg = window.ML_BACKEND || {};
const ready = cfg.url && cfg.anonKey && cfg.url.startsWith('https://') &&
  !cfg.url.includes('COLE_') && !cfg.anonKey.includes('COLE_') && window.supabase;

const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);
const dateKey = d => new Date(d).toLocaleDateString('en-CA');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusNames = { received: 'Recebido', preparing: 'Preparando', out_for_delivery: 'Saiu para entrega', completed: 'Concluído', cancelled: 'Cancelado' };
const OPEN_STATUSES = ['received', 'preparing', 'out_for_delivery'];
const POLL_MS = 20000;

let db = null, orders = [], products = [], promotions = [];
let selectedComboKeySet = new Set();
let knownOrderIds = null, pollTimer = null, newOrderIds = new Set(), booted = false;

if (ready) db = window.supabase.createClient(cfg.url, cfg.anonKey);
else $('#setup').classList.remove('hidden');

/* ===== Avisos ===== */
let toastTimer;
function say(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', isError);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4500);
}

/* ===== Autenticação ===== */
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!db) { $('#loginMsg').textContent = 'Configure o backend antes de entrar.'; return; }
  $('#loginMsg').textContent = 'Validando acesso…';
  const { error } = await db.auth.signInWithPassword({ email: $('#email').value, password: $('#password').value });
  if (error) { $('#loginMsg').textContent = 'Falha no acesso: ' + error.message; return; }
  $('#loginMsg').textContent = '';
  await boot();
});
$('#logout').onclick = async () => { await db.auth.signOut(); showLogin(); };

function showLogin() {
  clearInterval(pollTimer); booted = false; knownOrderIds = null;
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#sessionBar').classList.add('hidden');
  document.title = "Painel | Marquinho's Lanches";
}
async function boot() {
  if (booted) return;
  const { data: { session } } = await db.auth.getSession();
  if (!session) return;
  booted = true;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#sessionBar').classList.remove('hidden');
  $('#userEmail').textContent = session.user.email;
  await refreshAll();
  clearInterval(pollTimer);
  pollTimer = setInterval(pollOrders, POLL_MS);
}

/* ===== Carregamento de dados ===== */
/* Carrega pedidos paginados (o Supabase devolve no máx. 1000 por consulta).
   full=true  -> últimos 12 meses (relatórios corretos)
   full=false -> só os últimos 2 dias (atualização leve a cada 20 s) e mescla com o que já está na tela */
async function fetchOrdersSince(sinceISO) {
  const all = [], PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('orders').select('*').gte('created_at', sinceISO)
      .order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}
async function loadOrders(full = false) {
  try {
    const now = new Date();
    const since = full || !orders.length
      ? new Date(now.getFullYear(), now.getMonth() - 11, 1)
      : new Date(Date.now() - 2 * 864e5);
    const fresh = await fetchOrdersSince(since.toISOString());
    const older = full || !orders.length ? [] : orders.filter(o => new Date(o.created_at) < since);
    orders = [...fresh, ...older];
    return true;
  } catch (error) {
    say('Erro ao carregar pedidos: ' + error.message, true);
    return false;
  }
}
async function loadProducts() {
  const { data, error } = await db.from('products').select('*');
  if (error) { say('Erro ao carregar produtos: ' + error.message, true); return; }
  products = data || [];
}
async function loadPromotions() {
  const { data, error } = await db.from('promotions').select('*').order('created_at', { ascending: false });
  if (error) { say('Não foi possível carregar promoções. Execute o SQL de atualização de promoções: ' + error.message, true); promotions = []; return; }
  promotions = data || [];
}
async function refreshAll() {
  await Promise.all([loadOrders(true), loadProducts(), loadPromotions()]);
  detectNewOrders(false);
  renderAll();
}
function renderAll() {
  renderStats(); renderOrders(); renderStock(); renderSales(); renderPromotions(); fillPromoProducts();
  $('#lastUpdate').textContent = '· atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* ===== Atualização automática e aviso de novos pedidos ===== */
async function pollOrders() {
  if (!(await loadOrders())) return;
  detectNewOrders(true);
  renderStats(); renderOrders(); renderSales();
  $('#lastUpdate').textContent = '· atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function detectNewOrders(notify) {
  const ids = new Set(orders.map(o => o.id));
  if (knownOrderIds && notify) {
    const fresh = orders.filter(o => !knownOrderIds.has(o.id));
    if (fresh.length) {
      fresh.forEach(o => newOrderIds.add(o.id));
      say(`🔔 ${fresh.length === 1 ? 'Novo pedido de ' + fresh[0].customer_name : fresh.length + ' novos pedidos'}!`);
      beep();
    }
  }
  knownOrderIds = ids;
  updateBadge();
}
function updateBadge() {
  const n = orders.filter(o => o.status === 'received').length;
  const b = $('#newBadge');
  b.textContent = n; b.classList.toggle('hidden', n === 0);
  document.title = (n ? `(${n}) ` : '') + "Painel | Marquinho's Lanches";
}
let audioCtx;
function beep() {
  if (!$('#soundToggle').checked) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175, 880].forEach((freq, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + i * 0.22;
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.22);
    });
  } catch (e) { /* navegador bloqueou o áudio */ }
}
try { $('#soundToggle').checked = localStorage.getItem('ml_admin_sound') !== '0'; } catch (e) { /* ignorar */ }
$('#soundToggle').addEventListener('change', () => {
  try { localStorage.setItem('ml_admin_sound', $('#soundToggle').checked ? '1' : '0'); } catch (e) { /* ignorar */ }
  if ($('#soundToggle').checked) beep();
});

/* ===== Visão geral ===== */
const sumTotals = xs => xs.reduce((a, o) => a + Number(o.total || 0), 0);
function renderStats() {
  const today = dateKey(new Date());
  const done = orders.filter(o => o.status === 'completed' && dateKey(o.created_at) === today);
  const opened = orders.filter(o => OPEN_STATUSES.includes(o.status));
  const sum = sumTotals(done);
  $('#sales').textContent = money(sum);
  $('#doneCount').textContent = done.length;
  $('#openCount').textContent = opened.length;
  $('#ticket').textContent = money(done.length ? sum / done.length : 0);
  updateBadge();
}

/* ===== Pedidos ===== */
const NEXT_STEP = {
  received: () => ({ to: 'preparing', label: '▶ Iniciar preparo' }),
  preparing: o => o.fulfillment === 'delivery' ? { to: 'out_for_delivery', label: '🛵 Saiu para entrega' } : { to: 'completed', label: '✔ Concluir' },
  out_for_delivery: () => ({ to: 'completed', label: '✔ Concluir' })
};
function waLink(o) {
  let d = String(o.customer_phone || '').replace(/\D/g, '');
  if (d.length <= 11) d = '55' + d;
  const msgs = {
    received: `Olá, ${o.customer_name}! Recebemos seu pedido no Marquinho's Lanches. 🍔`,
    preparing: `Olá, ${o.customer_name}! Seu pedido já está sendo preparado. 🔥`,
    out_for_delivery: `Olá, ${o.customer_name}! Seu pedido saiu para entrega. 🛵`,
    completed: `Olá, ${o.customer_name}! Obrigado pela preferência, volte sempre! 🍔`,
    cancelled: `Olá, ${o.customer_name}! Infelizmente precisamos cancelar seu pedido. Podemos conversar?`
  };
  return `https://wa.me/${d}?text=${encodeURIComponent(msgs[o.status] || '')}`;
}
function filteredOrders() {
  const f = $('#statusFilter').value, p = $('#periodFilter').value, q = $('#orderSearch').value.trim().toLowerCase();
  const limit = p === '7' ? Date.now() - 7 * 864e5 : null, today = dateKey(new Date());
  return orders.filter(o => {
    if (f === 'open' ? !OPEN_STATUSES.includes(o.status) : (f !== 'all' && o.status !== f)) return false;
    if (p === 'today' && dateKey(o.created_at) !== today && !(f === 'open' && OPEN_STATUSES.includes(o.status))) return false;
    if (limit && new Date(o.created_at).getTime() < limit) return false;
    if (q && !(String(o.customer_name).toLowerCase().includes(q) || String(o.customer_phone).includes(q))) return false;
    return true;
  });
}
function orderCard(o) {
  const next = NEXT_STEP[o.status]?.(o);
  const items = (o.items || []).map(i => `<div>${esc(i.quantity)}× ${esc(i.name)} <small>${money(i.line_total ?? i.unit_price * i.quantity)}</small>${i.details ? `<br><small>${esc(i.details)}</small>` : ''}${i.notes ? `<br><small>Obs.: ${esc(i.notes)}</small>` : ''}</div>`).join('');
  const where = o.fulfillment === 'delivery' ? `Entrega: ${esc(o.address || '')}${o.reference ? ' (ref.: ' + esc(o.reference) + ')' : ''}` : 'Retirada no local';
  const change = o.payment_change ? ` · troco para ${esc(o.payment_change)}` : '';
  return `<article class="order ${newOrderIds.has(o.id) ? 'is-new' : ''}"><div class="order-main">
    <div class="row"><div class="name">#${esc(o.id.slice(0, 8))} · ${esc(o.customer_name)}</div><span class="badge ${esc(o.status)}">${statusNames[o.status] || esc(o.status)}</span></div>
    <div class="meta">${new Date(o.created_at).toLocaleString('pt-BR')} · ${esc(o.customer_phone)} · ${esc(o.payment_method)}${change} · <b>${money(o.total)}</b></div>
    <div class="order-items">${items || '<small>Sem itens</small>'}</div>
    <div class="meta">${where}${o.customer_notes ? ' · Obs.: ' + esc(o.customer_notes) : ''}</div>
    <div class="order-actions">
      ${next ? `<button class="ok small" data-act="next" data-id="${o.id}" data-to="${next.to}">${next.label}</button>` : ''}
      <select data-status="${o.id}" class="search" aria-label="Alterar status">${Object.entries(statusNames).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <a class="wa-link" href="${waLink(o)}" target="_blank" rel="noopener">WhatsApp</a>
      <button class="secondary small" data-act="print" data-id="${o.id}">🖨 Imprimir</button>
      <button class="danger small" data-delete="${o.id}">Excluir</button>
    </div></div></article>`;
}
function renderOrders() {
  const all = filteredOrders(), items = all.slice(0, 200);
  $('#orders').innerHTML = items.length
    ? items.map(orderCard).join('') + (all.length > items.length ? `<div class="empty">Mostrando os ${items.length} mais recentes de ${all.length}. Use a busca ou os filtros para ver os demais.</div>` : '')
    : '<div class="empty">Nenhum pedido encontrado com esses filtros.</div>';
}
async function setStatus(id, status) {
  const { error } = await db.from('orders').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { say('Não foi possível atualizar: ' + error.message, true); return; }
  newOrderIds.delete(id);
  const local = orders.find(o => o.id === id);
  if (local) local.status = status;
  say('Status atualizado.');
  renderStats(); renderOrders(); renderSales();
}
function printOrder(o) {
  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) { say('Libere pop-ups para imprimir.', true); return; }
  const items = (o.items || []).map(i => `<tr><td>${esc(i.quantity)}x ${esc(i.name)}${i.details ? `<br><small>${esc(i.details)}</small>` : ''}${i.notes ? `<br><small>Obs.: ${esc(i.notes)}</small>` : ''}</td><td style="text-align:right">${money(i.line_total ?? i.unit_price * i.quantity)}</td></tr>`).join('');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Pedido ${esc(o.id.slice(0, 8))}</title><style>body{font:13px monospace;width:300px;margin:8px}h2{text-align:center;margin:4px 0}hr{border:0;border-top:1px dashed #000}table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:2px 0}small{font-size:11px}</style>
  <h2>MARQUINHO'S LANCHES</h2><div style="text-align:center">Pedido #${esc(o.id.slice(0, 8))}<br>${new Date(o.created_at).toLocaleString('pt-BR')}</div><hr>
  <b>${esc(o.customer_name)}</b><br>${esc(o.customer_phone)}<br>${o.fulfillment === 'delivery' ? 'ENTREGA: ' + esc(o.address || '') + (o.reference ? '<br>Ref.: ' + esc(o.reference) : '') : 'RETIRADA NO LOCAL'}<hr>
  <table>${items}</table><hr>
  <table><tr><td>Subtotal</td><td style="text-align:right">${money(o.subtotal)}</td></tr><tr><td>Entrega</td><td style="text-align:right">${money(o.delivery_fee)}</td></tr><tr><td><b>TOTAL</b></td><td style="text-align:right"><b>${money(o.total)}</b></td></tr></table><hr>
  Pagamento: ${esc(o.payment_method)}${o.payment_change ? ' (troco p/ ' + esc(o.payment_change) + ')' : ''}${o.customer_notes ? '<br>Obs.: ' + esc(o.customer_notes) : ''}
  <script>window.onload=()=>{window.print()}<\/script>`);
  w.document.close();
}
$('#orders').addEventListener('change', e => {
  const id = e.target.dataset.status;
  if (id) setStatus(id, e.target.value);
});
$('#orders').addEventListener('click', async e => {
  const act = e.target.closest('[data-act]');
  if (act) {
    if (act.dataset.act === 'next') setStatus(act.dataset.id, act.dataset.to);
    if (act.dataset.act === 'print') { const o = orders.find(x => x.id === act.dataset.id); if (o) printOrder(o); }
    return;
  }
  const id = e.target.dataset.delete;
  if (!id) return;
  const o = orders.find(x => x.id === id);
  if (!confirm(`Excluir o pedido de ${o?.customer_name || id}? Essa ação remove o pedido do relatório de vendas e registra a exclusão no histórico administrativo. Esta ação não pode ser desfeita.`)) return;
  const { error } = await db.rpc('admin_delete_order', { target_order_id: id });
  if (error) { say('Falha ao excluir. Confirme que o SQL de instalação foi aplicado: ' + error.message, true); return; }
  say('Pedido excluído e exclusão registrada no histórico.');
  await refreshAll();
});
['statusFilter', 'periodFilter'].forEach(id => $('#' + id).addEventListener('change', renderOrders));
$('#orderSearch').addEventListener('input', renderOrders);

/* ===== Disponibilidade do cardápio ===== */
function categoryName(cat) {
  const c = String(cat || 'Outros');
  if (/combo/i.test(c)) return '🎁 ' + c;
  if (/pizza/i.test(c)) return '🍕 ' + c;
  if (/hamb[uú]rguer|burger/i.test(c)) return '🍔 ' + c;
  if (/esfirra/i.test(c)) return '🥙 ' + c;
  if (/bebida/i.test(c)) return '🥤 ' + c;
  if (/acompanhamento|batata/i.test(c)) return '🍟 ' + c;
  return '🍽️ ' + c;
}
/* Ordem do cardápio: product_key tem o formato "cat-item" ou "cat-item-tamanho" */
const keyParts = k => String(k || '').split('-').map(Number);
function byMenuOrder(a, b) {
  const x = keyParts(a.product_key), y = keyParts(b.product_key);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}
function groupedProducts(list = products) {
  const groups = {};
  [...list].sort(byMenuOrder).forEach(p => { (groups[p.category || 'Outros'] ||= []).push(p); });
  /* categorias na mesma ordem em que aparecem no site (1º item de cada uma) */
  return Object.entries(groups).sort((a, b) => byMenuOrder(a[1][0], b[1][0]));
}
/* posição de cada categoria no cardápio, usada para ordenar as promoções */
const categoryRank = cat => {
  const i = groupedProducts(products).findIndex(([c]) => c === cat);
  return i < 0 ? 999 : i;
};

/* Pizzas (chave "cat-item-tamanho") viram UMA linha por sabor com 4 chaves; demais itens, uma linha cada */
function stockRows(items) {
  const html = [], seen = new Set();
  items.forEach(p => {
    const parts = String(p.product_key).split('-');
    if (parts.length < 3) {
      html.push(`<div class="product ${p.available ? '' : 'off-row'}"><div><div class="name">${esc(p.name)}</div><div class="meta">${money(p.price)}</div></div>
        <label class="switch"><input type="checkbox" data-stock="${esc(p.product_key)}" ${p.available ? 'checked' : ''}> ${p.available ? 'Disponível' : 'Indisponível'}</label></div>`);
      return;
    }
    const base = parts.slice(0, 2).join('-');
    if (seen.has(base)) return;
    seen.add(base);
    const sizes = items.filter(x => String(x.product_key).startsWith(base + '-'));
    const name = p.name.replace(/\s*\([^)]*\)\s*$/, '');
    html.push(`<div class="product ${sizes.every(x => x.available) ? '' : 'off-row'}"><div><div class="name">${esc(name)}</div></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 16px">${sizes.map(x => `<label class="switch"><input type="checkbox" data-stock="${esc(x.product_key)}" ${x.available ? 'checked' : ''}> ${esc((x.name.match(/\(([^)]*)\)\s*$/) || [, ''])[1])} · ${money(x.price)}</label>`).join('')}</div></div>`);
  });
  return html.join('');
}
function renderStock() {
  const q = $('#stockSearch').value.toLowerCase(), onlyOff = $('#onlyOff').checked;
  const list = products.filter(p => (p.name + ' ' + p.category).toLowerCase().includes(q) && (!onlyOff || !p.available));
  if (!list.length) {
    $('#stock').innerHTML = `<div class="empty">${products.length ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado no banco. Execute o SQL de instalação e confira os registros iniciais.'}</div>`;
    return;
  }
  $('#stock').innerHTML = groupedProducts(list).map(([cat, items]) => `<div class="cat-block">
    <div class="cat-head"><h3>${esc(categoryName(cat))}</h3><span class="muted">${items.filter(p => !p.available).length} indisponível(is) de ${items.length}</span>
    <div class="btns"><button class="secondary small" data-cat-all="on" data-cat="${esc(cat)}">Ativar todos</button><button class="secondary small" data-cat-all="off" data-cat="${esc(cat)}">Desativar todos</button></div></div>
    <div class="list">${stockRows(items)}</div></div>`).join('');
}
$('#stock').addEventListener('change', async e => {
  const key = e.target.dataset.stock;
  if (!key) return;
  const { error } = await db.from('products').update({ available: e.target.checked, updated_at: new Date().toISOString() }).eq('product_key', key);
  if (error) say('Não foi possível atualizar o estoque: ' + error.message, true);
  else say('Disponibilidade atualizada. O cardápio público reflete em até 2 minutos.');
  await loadProducts(); renderStock(); fillPromoProducts();
});
$('#stock').addEventListener('click', async e => {
  const mode = e.target.dataset.catAll;
  if (!mode) return;
  const cat = e.target.dataset.cat;
  if (mode === 'off' && !confirm(`Marcar TODOS os produtos de "${cat}" como indisponíveis?`)) return;
  const { error } = await db.from('products').update({ available: mode === 'on', updated_at: new Date().toISOString() }).eq('category', cat);
  if (error) say('Não foi possível atualizar a categoria: ' + error.message, true);
  else say(`Categoria "${cat}" ${mode === 'on' ? 'ativada' : 'desativada'}.`);
  await loadProducts(); renderStock();
});
$('#stockSearch').oninput = renderStock;
$('#onlyOff').onchange = renderStock;

/* ===== Vendas ===== */
function renderSales() {
  const now = new Date(), today = dateKey(now);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
  const done = orders.filter(o => o.status === 'completed');
  const tod = done.filter(o => dateKey(o.created_at) === today);
  const week = done.filter(o => new Date(o.created_at) >= weekStart);
  const month = monthOrders(done);
  $('#daySales').textContent = money(sumTotals(tod));
  $('#weekSales').textContent = money(sumTotals(week));
  $('#monthSales').textContent = money(sumTotals(month));
  $('#dayCount').textContent = `${tod.length} pedidos`;
  $('#weekCount').textContent = `${week.length} pedidos`;
  $('#monthCount').textContent = `${month.length} pedidos`;
  $('#monthTicket').textContent = money(month.length ? sumTotals(month) / month.length : 0);
  $('#dayDoneCount').textContent = tod.length;
  $('#pixSales').textContent = money(sumTotals(tod.filter(o => o.payment_method === 'Pix')));
  $('#cashSales').textContent = money(sumTotals(tod.filter(o => o.payment_method === 'Dinheiro')));
  $('#cardSales').textContent = money(sumTotals(tod.filter(o => String(o.payment_method).toLowerCase().includes('cartão'))));
  renderSalesChart();
  renderTopProducts(month);
}
function monthOrders(list) {
  const now = new Date();
  return list.filter(o => { const d = new Date(o.created_at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); });
}
function renderTopProducts(month) {
  const map = {};
  month.forEach(o => (o.items || []).forEach(i => {
    const key = String(i.name || '—');
    const m = (map[key] ||= { qty: 0, total: 0 });
    m.qty += Number(i.quantity) || 0;
    m.total += Number(i.line_total ?? i.unit_price * i.quantity) || 0;
  }));
  const rows = Object.entries(map).sort((a, b) => b[1].qty - a[1].qty).slice(0, 10);
  const max = Math.max(1, ...rows.map(r => r[1].qty));
  $('#topProducts').innerHTML = rows.length
    ? rows.map(([name, v], i) => `<div class="rank-row"><b>${i + 1}º</b><div>${esc(name)}<div class="rank-bar"><i style="width:${(v.qty / max * 100).toFixed(0)}%"></i></div></div><div style="text-align:right"><b>${v.qty}×</b><div class="meta" style="margin:0">${money(v.total)}</div></div></div>`).join('')
    : '<div class="empty">Ainda não há pedidos concluídos neste mês.</div>';
}
function renderSalesChart() {
  const range = $('#chartRange').value || '7', now = new Date(), rows = [];
  const doneOrders = orders.filter(o => o.status === 'completed');
  if (range === '12') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const list = doneOrders.filter(o => { const x = new Date(o.created_at); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth(); });
      rows.push({ label: d.toLocaleDateString('pt-BR', { month: 'short' }), value: sumTotals(list), count: list.length });
    }
  } else {
    const n = Number(range);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const key = dateKey(d), list = doneOrders.filter(o => dateKey(o.created_at) === key);
      rows.push({ label: n === 7 ? d.toLocaleDateString('pt-BR', { weekday: 'short' }) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: sumTotals(list), count: list.length });
    }
  }
  $('#chartTitle').textContent = range === '12' ? 'Vendas por mês — últimos 12 meses' : `Vendas por dia — últimos ${range} dias`;
  const W = 900, H = 300, pad = { l: 48, r: 14, t: 25, b: 45 }, cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const max = Math.max(1, ...rows.map(r => r.value)), step = cw / rows.length, bw = Math.min(34, step * .62);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de vendas concluídas"><line x1="${pad.l}" y1="${pad.t + ch}" x2="${W - pad.r}" y2="${pad.t + ch}" stroke="#555"/>`;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch - ch * i / 4, v = max * i / 4;
    svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#ffffff14"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" class="chart-label">${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)}</text>`;
  }
  rows.forEach((r, i) => {
    const x = pad.l + i * step + (step - bw) / 2, h = ch * r.value / max, y = pad.t + ch - h;
    svg += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(0, h)}" rx="4" fill="#a31616" stroke="#f2b705" stroke-width=".7"><title>${esc(r.label)}: ${money(r.value)} (${r.count} pedidos)</title></rect><text x="${x + bw / 2}" y="${H - 18}" text-anchor="middle" class="chart-label">${esc(r.label)}</text>`;
    if (r.value > 0 && rows.length <= 12) svg += `<text x="${x + bw / 2}" y="${Math.max(14, y - 6)}" text-anchor="middle" class="chart-value">${Math.round(r.value)}</text>`;
  });
  $('#salesChart').innerHTML = svg + '</svg>';
}
$('#chartRange').onchange = renderSalesChart;
$('#exportCsv').onclick = () => {
  const month = monthOrders(orders.filter(o => o.status === 'completed')).reverse();
  if (!month.length) { say('Não há pedidos concluídos neste mês para exportar.', true); return; }
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Data', 'Pedido', 'Cliente', 'Telefone', 'Tipo', 'Pagamento', 'Subtotal', 'Entrega', 'Total', 'Itens'].map(cell).join(';')];
  month.forEach(o => lines.push([new Date(o.created_at).toLocaleString('pt-BR'), o.id.slice(0, 8), o.customer_name, o.customer_phone, o.fulfillment === 'delivery' ? 'Entrega' : 'Retirada', o.payment_method,
    String(o.subtotal ?? '').replace('.', ','), String(o.delivery_fee ?? '').replace('.', ','), String(o.total ?? '').replace('.', ','),
    (o.items || []).map(i => `${i.quantity}x ${i.name}`).join(' | ')].map(cell).join(';')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vendas-${dateKey(new Date()).slice(0, 7)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

/* ===== Promoções ===== */
const entryKey = i => (typeof i === 'string' ? i : i.product_key);
const entryQty = i => (typeof i === 'string' ? 1 : Number(i.quantity) || 1);
const productByKey = k => products.find(p => p.product_key === k);
const promoQty = o => { const e = (o.combo_items || []).find(i => entryKey(i) === o.product_key); return e ? entryQty(e) : 1; };
const selectedComboKeys = () => [...selectedComboKeySet];

function fillPromoProducts() {
  const grouped = groupedProducts().map(([cat, items]) => `<optgroup label="${esc(categoryName(cat))}">${items.map(p => `<option value="${esc(p.product_key)}">${esc(p.name)} · ${money(p.price)}</option>`).join('')}</optgroup>`).join('');
  const sel = $('#promoProduct'), old = sel.value;
  sel.innerHTML = '<option value="">Selecione um produto…</option>' + grouped;
  if (productByKey(old)) sel.value = old;
  renderComboProductGroups();
  updatePromoPreview();
}
function renderComboProductGroups() {
  const query = ($('#comboProductSearch').value || '').trim().toLocaleLowerCase('pt-BR');
  $('#comboProductGroups').innerHTML = groupedProducts().map(([cat, items]) => {
    const filtered = items.filter(p => p.name.toLocaleLowerCase('pt-BR').includes(query) || cat.toLocaleLowerCase('pt-BR').includes(query));
    if (!filtered.length) return '';
    return `<section class="combo-product-category"><h4>${esc(categoryName(cat))} <span style="color:#aaa;font-weight:400">(${filtered.length})</span></h4><div class="combo-product-options">${filtered.map(p => `<label class="combo-product-option"><input type="checkbox" data-combo-key="${esc(p.product_key)}" ${selectedComboKeySet.has(p.product_key) ? 'checked' : ''}><span>${esc(p.name)}<small>${money(p.price)}</small></span></label>`).join('')}</div></section>`;
  }).join('') || '<div class="empty">Nenhum produto encontrado.</div>';
  const n = selectedComboKeySet.size;
  $('#comboSelectedCount').textContent = `${n} ${n === 1 ? 'produto selecionado' : 'produtos selecionados'}`;
}
function promoBase(o) {
  if (o.promo_type === 'combo') return (o.combo_items || []).reduce((a, i) => a + Number(productByKey(entryKey(i))?.price || 0) * entryQty(i), 0);
  return Number(productByKey(o.product_key)?.price || 0) * promoQty(o);
}
function promoItemsText(o) {
  if (o.promo_type === 'combo') return (o.combo_items || []).map(i => { const p = productByKey(entryKey(i)); return p ? `${entryQty(i)}× ${p.name}` : null; }).filter(Boolean).join(' + ');
  const p = productByKey(o.product_key), q = promoQty(o);
  return q > 1 ? `${q}× ${p?.name || o.product_key}` : (p?.name || o.product_key);
}
function renderPromotions() {
  const el = $('#promotions');
  if (!promotions.length) { el.innerHTML = '<div class="empty">Nenhuma promoção cadastrada. Use o formulário acima.</div>'; return; }
  const buckets = {};
  promotions.forEach(o => {
    const cat = o.promo_type === 'combo' ? 'Combos promocionais' : (productByKey(o.product_key)?.category || 'Outros produtos');
    (buckets[cat] ||= []).push(o);
  });
  el.innerHTML = Object.entries(buckets).sort((a, b) => {
    if (a[0] === 'Combos promocionais') return -1;
    if (b[0] === 'Combos promocionais') return 1;
    return categoryRank(a[0]) - categoryRank(b[0]);
  }).map(([cat, items]) => `<section class="promo-section"><div class="promo-section-head"><h3>${esc(categoryName(cat))}</h3><span>${items.length} ${items.length === 1 ? 'promoção' : 'promoções'}</span></div><div class="list">${items.map(o => {
    const isCombo = o.promo_type === 'combo';
    return `<article class="product promo-list-card"><div style="flex:1;min-width:220px"><div class="name">${esc(o.title || 'OFERTA ESPECIAL')}</div>
      <div style="margin-top:7px"><span class="promo-pill">${isCombo ? 'COMBO' : 'PRODUTO'}</span><span class="promo-pill">${o.active ? '● ATIVA' : '○ DESATIVADA'}</span>${o.discount_percent ? `<span class="promo-pill">${Number(o.discount_percent)}% OFF</span>` : ''}</div>
      <div class="meta" style="margin-top:8px">${esc(promoItemsText(o))}</div>
      <div class="meta">Preço normal: ${money(promoBase(o))} <span style="padding:0 5px">→</span> <b style="color:var(--gold);font-size:1.05rem">${money(o.promo_price)}</b></div>
      <div class="meta">${o.starts_at ? 'Início: ' + new Date(o.starts_at).toLocaleString('pt-BR') + ' · ' : ''}${o.ends_at ? 'Fim: ' + new Date(o.ends_at).toLocaleString('pt-BR') : 'Sem data de término'}</div></div>
      <div class="order-actions promo-actions"><button class="secondary small" data-edit-promo="${o.id}">Editar</button><button class="secondary small" data-toggle-promo="${o.id}">${o.active ? 'Desativar' : 'Ativar'}</button><button class="danger small" data-delete-promo="${o.id}">Excluir</button></div></article>`;
  }).join('')}</div></section>`).join('');
}
function basePromoPrice() {
  if ($('#promoType').value === 'combo') return selectedComboKeys().reduce((s, k) => s + Number(productByKey(k)?.price || 0), 0);
  return Number(productByKey($('#promoProduct').value)?.price || 0) * Math.max(1, Number($('#promoQuantity').value || 1));
}
function updatePromoPreview() {
  const base = basePromoPrice(), mode = $('#discountType').value, val = Number($('#promoPrice').value || 0), type = $('#promoType').value;
  $('#singleProductFields').classList.toggle('hidden', type === 'combo');
  $('#comboFields').classList.toggle('hidden', type !== 'combo');
  $('#discountValueField').firstElementChild.textContent = mode === 'percent' ? 'Desconto (%)' : 'Valor promocional';
  $('#promoPrice').max = mode === 'percent' ? '99.99' : String(Math.max(.01, base - .01));
  $('#promoPrice').placeholder = mode === 'percent' ? 'Ex.: 15' : 'Ex.: 19,90';
  const final = mode === 'percent' ? base * (1 - val / 100) : val;
  $('#discountPreview').textContent = base > 0
    ? (mode === 'percent' ? `Preço normal: ${money(base)} · Preço com ${val || 0}% de desconto: ${money(final)}`
      : `Preço normal: ${money(base)} · Preço promocional: ${money(final)}${final > 0 && final < base ? ` · Economia de ${money(base - final)}` : ''}`)
    : 'Selecione o produto ou os itens do combo para calcular o desconto.';
}
function resetPromo() {
  $('#promoForm').reset();
  $('#promoId').value = '';
  $('#promoQuantity').value = '1';
  $('#promoActive').checked = true;
  selectedComboKeySet.clear();
  $('#comboProductSearch').value = '';
  renderComboProductGroups();
  updatePromoPreview();
}
$('#promoForm').addEventListener('submit', async e => {
  e.preventDefault();
  const type = $('#promoType').value, mode = $('#discountType').value, val = Number($('#promoPrice').value);
  const selected = selectedComboKeys(), product = productByKey($('#promoProduct').value);
  const quantity = type === 'product' ? Math.max(1, Math.min(99, Math.floor(Number($('#promoQuantity').value || 1)))) : 1;
  const base = type === 'combo' ? selected.reduce((a, k) => a + Number(productByKey(k)?.price || 0), 0) : Number(product?.price || 0) * quantity;
  if (type === 'combo' && selected.length < 2) { say('Selecione pelo menos dois produtos para formar um combo.', true); return; }
  if (type === 'product' && !product) { say('Escolha um produto.', true); return; }
  if (!(base > 0)) { say('Não foi possível calcular o preço normal.', true); return; }
  if (mode === 'percent' && !(val > 0 && val < 100)) { say('Informe um desconto entre 0 e 99,99%.', true); return; }
  const finalPrice = mode === 'percent' ? Math.round(base * (1 - val / 100) * 100) / 100 : val;
  if (!(finalPrice > 0 && finalPrice < base)) { say('O preço promocional precisa ser maior que zero e menor que o preço normal (' + money(base) + ').', true); return; }
  const start = $('#promoStart').value ? new Date($('#promoStart').value).toISOString() : null;
  const end = $('#promoEnd').value ? new Date($('#promoEnd').value).toISOString() : null;
  if (start && end && new Date(end) <= new Date(start)) { say('A data final precisa ser depois da inicial.', true); return; }
  const payload = {
    promo_type: type, discount_mode: mode,
    product_key: type === 'product' ? product.product_key : null,
    combo_items: type === 'combo' ? selected.map(product_key => ({ product_key, quantity: 1 })) : (quantity > 1 ? [{ product_key: product.product_key, quantity }] : []),
    title: $('#promoTitle').value.trim() || (type === 'combo' ? 'COMBO PROMOCIONAL' : 'OFERTA ESPECIAL'),
    promo_price: finalPrice,
    discount_percent: mode === 'percent' ? val : Math.round((1 - finalPrice / base) * 10000) / 100,
    active: $('#promoActive').checked, starts_at: start, ends_at: end, updated_at: new Date().toISOString()
  };
  let id = $('#promoId').value;
  if (!id && type === 'product') { const existing = promotions.find(o => o.promo_type !== 'combo' && o.product_key === product.product_key); if (existing) id = existing.id; }
  if (id) payload.id = id;
  const { error } = await db.from('promotions').upsert(payload);
  if (error) { say('Erro ao salvar promoção. Confirme se executou o SQL de atualização de promoções: ' + error.message, true); return; }
  say('Promoção salva! O banner do site será atualizado.');
  resetPromo();
  await loadPromotions(); renderPromotions();
});
$('#promoCancel').onclick = resetPromo;
['promoQuantity', 'promoPrice'].forEach(id => $('#' + id).addEventListener('input', updatePromoPreview));
['promoType', 'discountType', 'promoProduct'].forEach(id => $('#' + id).addEventListener('change', updatePromoPreview));
$('#comboProductGroups').addEventListener('change', e => {
  if (!e.target.matches('input[data-combo-key]')) return;
  const key = e.target.dataset.comboKey;
  if (e.target.checked) selectedComboKeySet.add(key); else selectedComboKeySet.delete(key);
  renderComboProductGroups(); updatePromoPreview();
});
$('#comboProductSearch').addEventListener('input', renderComboProductGroups);
$('#clearComboProducts').addEventListener('click', () => { selectedComboKeySet.clear(); renderComboProductGroups(); updatePromoPreview(); });
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
$('#promotions').addEventListener('click', async e => {
  const edit = e.target.dataset.editPromo, toggle = e.target.dataset.togglePromo, del = e.target.dataset.deletePromo;
  if (edit) {
    const o = promotions.find(x => x.id === edit);
    if (!o) return;
    $('#promoId').value = o.id;
    $('#promoType').value = o.promo_type || 'product';
    $('#discountType').value = o.discount_mode || 'fixed';
    $('#promoProduct').value = o.product_key || '';
    $('#promoQuantity').value = o.promo_type !== 'combo' ? promoQty(o) : 1;
    $('#promoTitle').value = o.title || '';
    $('#promoPrice').value = (o.discount_mode || 'fixed') === 'percent' ? (o.discount_percent || 0) : o.promo_price;
    selectedComboKeySet = new Set((o.combo_items || []).map(entryKey));
    renderComboProductGroups();
    $('#promoActive').checked = o.active;
    $('#promoStart').value = toLocalInput(o.starts_at);
    $('#promoEnd').value = toLocalInput(o.ends_at);
    updatePromoPreview();
    $('#promoForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (toggle) {
    const o = promotions.find(x => x.id === toggle);
    const { error } = await db.from('promotions').update({ active: !o.active, updated_at: new Date().toISOString() }).eq('id', toggle);
    if (error) { say('Erro ao alterar promoção: ' + error.message, true); return; }
    say('Status da promoção atualizado.');
    await loadPromotions(); renderPromotions();
    return;
  }
  if (del) {
    if (!confirm('Excluir esta promoção do banner?')) return;
    const { error } = await db.from('promotions').delete().eq('id', del);
    if (error) { say('Erro ao excluir promoção: ' + error.message, true); return; }
    say('Promoção excluída.');
    await loadPromotions(); renderPromotions();
  }
});

/* ===== Navegação por abas e atualização manual ===== */
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
  ['orders', 'stock', 'promotions', 'sales'].forEach(t => $('#' + t + 'Tab').classList.toggle('hidden', t !== b.dataset.tab));
  if (b.dataset.tab === 'sales') renderSales();
});
$('#refresh').onclick = async () => { await refreshAll(); say('Dados atualizados.'); };

/* ===== Início: retoma a sessão se já estiver logado ===== */
if (db) {
  db.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_OUT' || !session) showLogin(); });
  db.auth.getSession().then(({ data }) => { if (data.session) boot(); });
}
