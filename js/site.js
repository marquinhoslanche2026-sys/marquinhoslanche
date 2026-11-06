/* =====================================================================
   Marquinho's Lanches — lógica do site (cardápio, carrinho, pedido)
   Depende de: js/menu-data.js (MENU) e backend-config.js (opcional)
   ===================================================================== */
'use strict';

/* ===== Configuração do estabelecimento ===== */
const CFG = {
  name: "Marquinho’s Lanches",
  wa: "5593991759806",
  fee: 5,
  hours: [19.5, 24], // 19h30 às 00h, todos os dias
  pix: { key: "02106038283" }
};
const SIZE_NAMES = ["Pequena", "Média", "Grande", "Família"];
const SIZE_SLICES = ["4 fatias", "6 fatias", "8 fatias", "12 fatias"];
const PIZZA_LIMITS = [1, 2, 3, 3];
const NAV_LABELS = {
  "Hambúrguer Industrial": "Industriais",
  "Hambúrguer Artesanal": "Artesanais",
  "Pizzas Tradicionais": "Pizzas",
  "Pizzas Especiais": "Especiais"
};

/* ===== Utilidades ===== */
const $ = s => document.querySelector(s);
const R = v => "R$ " + Number(v || 0).toFixed(2).replace(".", ",");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion:reduce)").matches;
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } };

/* ===== Backend (Supabase) ===== */
const BACKEND = window.ML_BACKEND || {};
const backendReady = () => !!(BACKEND.url && BACKEND.anonKey && window.supabase &&
  BACKEND.url.startsWith("https://") && !BACKEND.anonKey.includes("COLE_"));
const db = backendReady() ? window.supabase.createClient(BACKEND.url, BACKEND.anonKey) : null;
let availability = {};
let promotions = [];

/* ===== Lista plana de produtos (chave => item) ===== */
/* Nome completo (carrinho, WhatsApp e painel): "Esfirra sabor X", "X-Burguer (Industrial)"... */
const fname = x => x.fn || x.n;
function fullName(ci, n) {
  const cat = MENU[ci].n;
  if (cat === "Esfirras") return `Esfirra sabor ${n.replace(/^de\s+/i, "")}`;
  if (/^Hamb/.test(cat)) { const t = cat.split(" ")[1]; return new RegExp(t, "i").test(n) ? n : `${n} (${t})`; }
  return n;
}
const flat = [];
MENU.forEach((c, ci) => c.i.forEach((x, ii) => {
  if (Array.isArray(x[2])) {
    x[2].forEach((p, s) => flat.push({ k: `${ci}-${ii}-${s}`, ci, n: `Pizza ${x[0]} (${SIZE_NAMES[s]})`, d: x[1], p }));
  } else {
    flat.push({ k: `${ci}-${ii}`, ci, n: x[0], fn: fullName(ci, x[0]), d: x[1], p: x[2] });
  }
}));
const catIndex = name => MENU.findIndex(c => c.n === name);
const isAvailable = k => availability[k] !== false;

/* ===== Estado do carrinho ===== */
let cart = lsGet("ml_cart3", {});
let notes = lsGet("ml_notes3", {});
let combos = lsGet("ml_combos3", {});
const saveCart = () => { lsSet("ml_cart3", cart); lsSet("ml_notes3", notes); lsSet("ml_combos3", combos); };

/* ===== Promoções ===== */
const entryKey = i => (typeof i === "string" ? i : i.product_key);
const entryQty = i => (typeof i === "string" ? 1 : Number(i.quantity) || 1);
const offerQuantity = o => {
  const e = (o?.combo_items || []).find(i => entryKey(i) === o.product_key);
  return Math.max(1, e ? entryQty(e) : 1);
};
const productOffer = k => promotions.find(o => o.promo_type !== "combo" && o.product_key === k);

function lineTotal(k) {
  if (combos[k]) return Number(combos[k].p) * cart[k];
  const x = flat.find(v => v.k === k);
  if (!x) return 0;
  const offer = productOffer(k);
  if (!offer) return x.p * cart[k];
  const q = offerQuantity(offer), price = Number(offer.promo_price);
  if (q <= 1) return price * cart[k];
  return Math.floor(cart[k] / q) * price + (cart[k] % q) * x.p;
}
function by(k) {
  if (combos[k]) return combos[k];
  const x = flat.find(v => v.k === k);
  if (!x) return undefined;
  const offer = productOffer(k);
  return offer && offerQuantity(offer) === 1 ? { ...x, p: Number(offer.promo_price) } : x;
}

/* Remove do carrinho o que deixou de existir */
Object.keys(cart).forEach(k => { if (!by(k)) delete cart[k]; });
Object.keys(combos).forEach(k => { if (!cart[k]) delete combos[k]; });

const subtotal = () => Object.keys(cart).reduce((s, k) => s + lineTotal(k), 0);
const itemCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
const isDelivery = () => $("input[name=t]:checked").value === "Entrega";
const grandTotal = () => subtotal() + (isDelivery() ? CFG.fee : 0);

function isOpenNow() {
  if (!CFG.hours) return true;
  const n = new Date(), h = n.getHours() + n.getMinutes() / 60, [o, c] = CFG.hours;
  return c > o ? h >= o && h < c : h >= o || h < c;
}

/* ===== Sincronização com o painel ===== */
async function syncAvailability() {
  if (!db) return;
  try {
    const [pr, of] = await Promise.all([
      db.from("products").select("product_key,available"),
      db.from("promotions").select("id,title,product_key,promo_price,discount_percent,promo_type,combo_items,active,starts_at,ends_at").eq("active", true)
    ]);
    if (pr.error) throw pr.error;
    availability = Object.fromEntries((pr.data || []).map(p => [p.product_key, p.available]));
    const now = Date.now();
    promotions = (of.error ? [] : (of.data || [])).filter(o =>
      (!o.starts_at || new Date(o.starts_at).getTime() <= now) &&
      (!o.ends_at || new Date(o.ends_at).getTime() >= now) &&
      (o.promo_type === "combo"
        ? (o.combo_items || []).every(i => availability[entryKey(i)] !== false)   // combo some se algum item acabou
        : availability[o.product_key] !== false));
    renderPromotions();
    renderMenu();
    renderCart();
  } catch (e) {
    console.warn("Sincronização remota indisponível:", e.message);
  }
}

function comboNames(o) {
  return (o.combo_items || []).map(i => {
    const p = flat.find(x => x.k === entryKey(i));
    return p ? `${entryQty(i)}× ${fname(p)}` : null;
  }).filter(Boolean);
}
function renderPromotions() {
  const box = $("#promoBanner"), list = $("#promoList");
  const valid = promotions.map(o => ({ ...o, item: flat.find(x => x.k === o.product_key), names: comboNames(o) }))
    .filter(o => o.promo_type === "combo" ? o.names.length >= 2 : !!o.item);
  if (!valid.length) { box.hidden = true; return; }
  box.hidden = false;
  list.innerHTML = valid.map(o => {
    const combo = o.promo_type === "combo";
    const name = combo ? (o.title || "COMBO PROMOCIONAL") : (o.title && o.title !== "OFERTA ESPECIAL" ? o.title : o.item.n);
    const desc = combo ? o.names.join(" + ") : fname(o.item);
    const old = combo
      ? o.combo_items.reduce((sum, it) => { const p = flat.find(x => x.k === entryKey(it)); return sum + (p ? p.p * entryQty(it) : 0); }, 0)
      : o.item.p * offerQuantity(o);
    return `<article class="promo-item"><div><b>${esc(name)}</b><small>${esc(desc)}</small>${o.discount_percent ? `<span class="promo-off">${Number(o.discount_percent)}% OFF</span>` : ""}</div>
      <div class="promo-prices"><span class="promo-old">${R(old)}</span><strong class="promo-new">${R(o.promo_price)}</strong>${combo ? `<button class="add" style="margin-top:5px" data-promo-add="${esc(o.id)}">Adicionar combo</button>` : ""}</div></article>`;
  }).join("");
}

/* ===== Cardápio ===== */
const qtyControl = k => cart[k]
  ? `<div class="st2"><button data-a="m" data-k="${k}" aria-label="Diminuir quantidade de ${esc(fname(by(k)))}">−</button><span aria-label="Quantidade">${cart[k]}</span><button data-a="p" data-k="${k}" aria-label="Aumentar quantidade de ${esc(fname(by(k)))}">+</button></div>`
  : `<button class="add" data-a="p" data-k="${k}">Adicionar</button>`;

function productCard(x) {
  const off = !isAvailable(x.k), offer = productOffer(x.k), oq = offer ? offerQuantity(offer) : 1;
  const normal = flat.find(z => z.k === x.k)?.p || x.p;
  const price = offer ? `<span><del>${R(normal * oq)}</del><b>${R(oq > 1 ? offer.promo_price : x.p)}</b></span>` : `<b>${R(x.p)}</b>`;
  return `<article class="it ${off ? "unavailable" : ""}"><h3>${esc(x.n)}${offer ? " <small>🔥 PROMOÇÃO</small>" : ""}</h3>
    ${x.d ? `<p>${esc(x.d)}</p>` : ""}
    ${offer && oq > 1 ? `<p class="deal">${oq} unidades por ${R(offer.promo_price)} <small>(${R(Number(offer.promo_price) / oq)} cada)</small></p>` : ""}
    ${off ? '<span class="stock-note">Indisponível no momento</span>' : ""}
    <div class="ft">${price}${off ? "" : qtyControl(x.k)}</div></article>`;
}
function pizzaCard(x, ci, ii) {
  const rows = x[2].map((p, s) => {
    const off = !isAvailable(`${ci}-${ii}-${s}`);
    return `<div class="ft sz"><span>${SIZE_NAMES[s]}<small>${SIZE_SLICES[s]}</small>${off ? '<small class="stock-note">Indisponível</small>' : ""}</span><b>${R(p)}</b>${off ? "" : `<button class="add" data-a="pzb" data-k="${ci}-${ii}" data-size="${s}">Montar</button>`}</div>`;
  }).join("");
  return `<article class="it"><h3>${esc(x[0])}</h3><p>${esc(x[1])}</p>${rows}</article>`;
}

function renderMenu() {
  const q = $("#q").value.toLowerCase().trim();
  const wasOpen = new Set([...document.querySelectorAll("#list details[open]")].map(d => d.id));
  const html = MENU.map((c, ci) => {
    const items = c.i.map((x, ii) => ({ x, ii })).filter(o => (o.x[0] + " " + o.x[1]).toLowerCase().includes(q));
    if (!items.length) return "";
    const cards = items.map(o => Array.isArray(o.x[2]) ? pizzaCard(o.x, ci, o.ii) : productCard(by(`${ci}-${o.ii}`))).join("");
    const open = q || wasOpen.has("c" + ci) ? "open" : "";
    return `<details class="category" id="c${ci}" ${open}><summary><span>${esc(c.n)}</span><small>${items.length} ${items.length === 1 ? "produto" : "produtos"}</small></summary><div class="g">${cards}</div></details>`;
  }).join("");
  $("#list").innerHTML = (q ? "" : comboSectionHtml(wasOpen.has("combos"))) + (html || '<p class="empty">Nada encontrado. Tente outro nome.</p>');
}

/* ===== Combos de lanches ===== */
const pick = (cats, re) => flat.filter(x => isAvailable(x.k) && cats.includes(MENU[x.ci].n) && (!re || re.test(x.n)));
const lanches = () => pick(["Hambúrguer Industrial", "Hambúrguer Artesanal"]);
const acomp = () => pick(["Acompanhamentos"]);
const label = x => fname(x);

/* Para dar desconto num combo, altere "off" (valor em R$) */
const COMBOS = {
  solo: { n: "Combo Solo", t: "1 lanche + 1 acompanhamento + 1 refrigerante lata", off: 0,
    slots: () => [["Lanche", lanches()], ["Acompanhamento", acomp()], ["Bebida", pick(["Bebidas"], /lata/i)]] },
  casal: { n: "Combo Casal", t: "2 lanches + 1 acompanhamento + 1 refrigerante de 1 litro", off: 0,
    slots: () => [["Lanche 1", lanches()], ["Lanche 2", lanches()], ["Acompanhamento", acomp()], ["Bebida", pick(["Bebidas"], /1 litro/i)]] },
  familia: { n: "Combo Família", t: "4 lanches + 2 acompanhamentos + 1 refrigerante de 2 litros", off: 0,
    slots: () => [["Lanche 1", lanches()], ["Lanche 2", lanches()], ["Lanche 3", lanches()], ["Lanche 4", lanches()], ["Acompanhamento 1", acomp()], ["Acompanhamento 2", acomp()], ["Bebida", pick(["Bebidas"], /2 litros/i)]] }
};
const PIZZA_COMBOS = [
  { id: "solo", n: "Combo Pizza Solo", t: "1 pizza pequena + batata tradicional + refrigerante lata", size: 0, batName: "Batata Tradicional", drink: /lata/i },
  { id: "casal", n: "Combo Pizza Casal", t: "1 pizza grande + batata especial + refrigerante de 1 litro", size: 2, batName: "Batata Especial", drink: /1 litro/i },
  { id: "familia", n: "Combo Pizza Família", t: "1 pizza família + Batata Big Family + refrigerante de 2 litros", size: 3, batName: "Batata Big Family", drink: /2 litros/i }
];
const comboFrom = id => COMBOS[id].slots().reduce((a, s) => a + (s[1].length ? Math.min(...s[1].map(x => x.p)) : 0), 0) - COMBOS[id].off;

function comboSectionHtml(open) {
  const total = Object.keys(COMBOS).length + PIZZA_COMBOS.length;
  const burger = Object.keys(COMBOS).map(id => `<article class="it"><h3>${COMBOS[id].n}</h3><p>${COMBOS[id].t}. Você escolhe cada item.</p><div class="ft"><b>A partir de ${R(comboFrom(id))}</b><button class="add" data-a="cbo" data-k="${id}">Montar</button></div></article>`).join("");
  const pizza = PIZZA_COMBOS.map(c => `<article class="it"><h3>${c.n}</h3><p>${c.t}. Escolha o sabor e personalize os itens.</p><div class="ft"><b>Monte o seu</b><button class="add" data-a="pzcombo" data-k="${c.id}">Montar</button></div></article>`).join("");
  return `<details class="category" id="combos" ${open ? "open" : ""}><summary><span>Combos Burger e Pizza</span><small>${total} opções</small></summary><div class="g">${burger}${pizza}<p class="hint" style="grid-column:1/-1">O total é a soma dos preços dos itens escolhidos.</p></div></details>`;
}

let currentCombo = null;
const comboSelection = () => [...document.querySelectorAll("#cbs select")].map(s => by(s.value)).filter(Boolean);
function comboTotal() {
  const t = comboSelection().reduce((a, x) => a + x.p, 0) - COMBOS[currentCombo].off;
  $("#cbp").textContent = R(t);
  return t;
}
function openCombo(id) {
  currentCombo = id;
  const c = COMBOS[id], slots = c.slots();
  if (slots.some(s => !s[1].length)) { showToast("Alguns itens deste combo estão indisponíveis agora."); return; }
  $("#cbt").textContent = c.n;
  $("#cbd").textContent = c.t + (c.off ? " · desconto de " + R(c.off) : "");
  $("#cbs").innerHTML = slots.map(s => `<label>${s[0]}<select>${s[1].map(x => `<option value="${x.k}">${esc(label(x))} · ${R(x.p)}</option>`).join("")}</select></label>`).join("");
  comboTotal();
  openModal("#cbm");
}

/* ===== Montador de pizzas ===== */
let pzSize = 0, pzCombo = null;
const fillOptional = (sel, items) => { sel.innerHTML = '<option value="">Nenhum</option>' + items.map(x => `<option value="${x.k}">${esc(x.n)} · ${R(x.p)}</option>`).join(""); };

function chosenFlavors() {
  return [...document.querySelectorAll("#pzflavors input:checked")].map(el => {
    const ci = Number(el.dataset.ci), ii = Number(el.dataset.ii), it = MENU[ci].i[ii];
    return { ci, ii, name: it[0], prices: it[2] };
  });
}
function pizzaPrice() {
  const chosen = chosenFlavors();
  const tradCi = catIndex("Pizzas Tradicionais");
  let price = 0;
  if (chosen.length) {
    const trad = chosen.filter(x => x.ci === tradCi), spec = chosen.filter(x => x.ci !== tradCi);
    if (!trad.length) price = Math.max(...spec.map(x => x.prices[pzSize]));
    else {
      const t = trad[0].prices[pzSize];
      price = spec.length ? t + spec.reduce((s, x) => s + Math.max(0, x.prices[pzSize] - t), 0) / chosen.length : t;
    }
  }
  const bat = by($("#pzbat").value), drink = by($("#pzdrink").value);
  price += (bat ? bat.p : 0) + (drink ? drink.p : 0);
  $("#pztotal").textContent = R(price);
  return { price, chosen, bat, drink };
}
function renderPizzaFlavors() {
  $("#pzflavors").innerHTML = ["Pizzas Tradicionais", "Pizzas Especiais"].map(cat => {
    const ci = catIndex(cat);
    return `<fieldset><legend>${cat}</legend>${MENU[ci].i.map((x, ii) => {
      const off = !isAvailable(`${ci}-${ii}-${pzSize}`);
      return `<label><input type="checkbox" data-ci="${ci}" data-ii="${ii}" ${off ? "disabled" : ""}> <span>${esc(x[0])} <small>(${R(x[2][pzSize])})${off ? " · indisponível" : ""}</small></span></label>`;
    }).join("")}</fieldset>`;
  }).join("");
}
function updatePizzaLimit() {
  const c = pzCombo && PIZZA_COMBOS.find(x => x.id === pzCombo);
  $("#pzlimit").textContent = c
    ? `${c.n}: ${SIZE_NAMES[pzSize]}, até ${PIZZA_LIMITS[pzSize]} sabor(es). Batata e refrigerante incluídos.`
    : `${SIZE_NAMES[pzSize]}: escolha até ${PIZZA_LIMITS[pzSize]} sabor(es).`;
}
function openPizza(size, comboId = null) {
  pzSize = Number(size); pzCombo = comboId;
  $("#pzs").value = String(pzSize);
  $("#pzs").disabled = !!comboId;
  $("#pzt").textContent = comboId ? PIZZA_COMBOS.find(c => c.id === comboId).n : "Monte sua pizza";
  $("#pznotes").value = "";
  fillOptional($("#pzbat"), pick(["Acompanhamentos"]));
  fillOptional($("#pzdrink"), pick(["Bebidas"]));
  renderPizzaFlavors();
  if (comboId) {
    const c = PIZZA_COMBOS.find(x => x.id === comboId);
    const drink = pick(["Bebidas"]).find(x => c.drink.test(x.n)), bat = pick(["Acompanhamentos"]).find(x => x.n === c.batName);
    if (drink) $("#pzdrink").value = drink.k;
    if (bat) $("#pzbat").value = bat.k;
  }
  updatePizzaLimit();
  openModal("#pizzam");
  pizzaPrice();
}

/* ===== Carrinho / pedido ===== */
function cartLines() {
  return Object.keys(cart).map(k => {
    const x = by(k);
    return `<div class="ln"><div class="lnhead"><div><b>${esc(fname(x))}</b>${combos[k] ? `<small>${esc(x.d)}</small>` : ""}<span>${R(lineTotal(k))}</span></div>
      <button class="rmitem" data-a="rm" data-k="${k}" aria-label="Remover ${esc(fname(x))} do carrinho" title="Remover item">✕</button></div>
      ${qtyControl(k)}
      <input data-note="${k}" value="${esc(notes[k] || "")}" placeholder="Observação (ex.: sem tomate)" maxlength="80" aria-label="Observação de ${esc(fname(x))}"></div>`;
  }).join("");
}
function buildWhatsAppLink() {
  const delivery = isDelivery(), pay = $("#pay").value, ref = $("#rf2").value.trim(), obs = $("#orderobs").value.trim();
  const lines = Object.keys(cart).map(k => {
    const x = by(k);
    return `${cart[k]}x ${fname(x)} - ${R(lineTotal(k))}` + (combos[k] ? ` (${combos[k].d})` : "") + (notes[k] ? `\n   _Obs: ${notes[k]}_` : "");
  });
  let m = `*Novo pedido – ${CFG.name}*\n\n${lines.join("\n")}\n\nSubtotal: ${R(subtotal())}\n${delivery ? "Entrega: " + R(CFG.fee) : "Retirada no local"}\n*Total: ${R(grandTotal())}*\n\n*Cliente:* ${$("#nm").value.trim()}\n*Telefone:* ${$("#ph").value.trim()}\n`;
  if (delivery) m += `*Entrega em:* ${$("#ad").value.trim()}${ref ? " (ref.: " + ref + ")" : ""}\n`;
  m += `*Pagamento:* ${pay}` + (pay === "Pix" ? " (envio o comprovante em seguida)" : "") + (pay === "Dinheiro" && $("#tr").value.trim() ? `, troco para ${$("#tr").value.trim()}` : "");
  if (obs) m += `\n*Observações do pedido:* ${obs}`;
  $("#send").href = `https://wa.me/${CFG.wa}?text=${encodeURIComponent(m)}`;
}
function renderCart() {
  const keys = Object.keys(cart);
  $("#bar").hidden = !keys.length;
  $("#bc").textContent = itemCount() + (itemCount() === 1 ? " item" : " itens");
  $("#bt").textContent = R(subtotal());
  $("#lines").innerHTML = keys.length ? cartLines() : "<p>Seu carrinho está vazio. Adicione itens do cardápio.</p>";
  $("#adr").hidden = !isDelivery();
  $("#rs").textContent = R(subtotal());
  $("#rf").textContent = isDelivery() ? R(CFG.fee) : "Retirada";
  $("#rt").textContent = R(grandTotal());
  const p = $("#pay").value;
  $("#troco").hidden = p !== "Dinheiro";
  $("#pixbox").hidden = !(p === "Pix" && itemCount() > 0);
  $("#closedNote").hidden = isOpenNow();
  buildWhatsAppLink();
}

const FIELDS = ["nm", "ph", "ad", "rf2", "orderobs"];
const persistFields = () => lsSet("ml_f", Object.fromEntries(FIELDS.map(i => [i, $("#" + i).value])));
(() => { const s = lsGet("ml_f", {}); FIELDS.forEach(i => { if (s[i]) $("#" + i).value = s[i]; }); })();

/* ===== Janelas e avisos ===== */
let toastTimer;
function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}
const MODALS = ["#dr", "#cbm", "#pizzam"];
function openModal(sel) { $(sel).hidden = false; document.body.style.overflow = "hidden"; }
function closeModal(sel) {
  $(sel).hidden = true;
  if (MODALS.every(m => $(m).hidden)) document.body.style.overflow = "";
}

/* ===== Eventos ===== */
function changeCart(a, k) {
  if (a === "p") cart[k] = (cart[k] || 0) + 1;
  else if (a === "m" && cart[k]) { cart[k]--; if (cart[k] <= 0) { delete cart[k]; delete notes[k]; delete combos[k]; } }
  else if (a === "rm") { delete cart[k]; delete notes[k]; delete combos[k]; }
  else return false;
  saveCart(); renderMenu(); renderCart();
  if (a === "p" && $("#dr").hidden) showToast("Adicionado ao carrinho · pode continuar escolhendo!");
  return true;
}
document.addEventListener("click", e => {
  const promo = e.target.closest("[data-promo-add]");
  if (promo) {
    const offer = promotions.find(o => o.id === promo.dataset.promoAdd);
    if (!offer || offer.promo_type !== "combo") return;
    const id = "promoCombo" + Date.now();
    combos[id] = { n: offer.title || "Combo promocional", d: comboNames(offer).join(" + "), p: Number(offer.promo_price) };
    cart[id] = 1; saveCart(); renderMenu(); renderCart();
    showToast("Combo promocional adicionado ao carrinho!");
    return;
  }
  if (MODALS.includes("#" + e.target.id)) { closeModal("#" + e.target.id); return; }
  const b = e.target.closest("[data-a]");
  if (!b) return;
  const a = b.dataset.a, k = b.dataset.k;
  switch (a) {
    case "go": {
      const el = document.getElementById(k);
      if (el) { if (el.tagName === "DETAILS") el.open = true; el.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" }); }
      return;
    }
    case "open": openModal("#dr"); renderCart(); return;
    case "close": closeModal("#dr"); return;
    case "ck2": copyPix(b); return;
    case "cbo": openCombo(k); return;
    case "cbx": closeModal("#cbm"); return;
    case "pzb": openPizza(b.dataset.size); return;
    case "pzcombo": { const c = PIZZA_COMBOS.find(x => x.id === k); if (c) openPizza(c.size, c.id); return; }
    case "pzc": closeModal("#pizzam"); return;
    default: changeCart(a, k);
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") MODALS.forEach(m => { if (!$(m).hidden) closeModal(m); });
});
$("#dr").addEventListener("input", e => {
  if (e.target.dataset.note) { notes[e.target.dataset.note] = e.target.value; saveCart(); }
  e.target.classList.remove("invalid");
  persistFields(); buildWhatsAppLink();
});
$("#dr").addEventListener("change", renderCart);
$("#q").addEventListener("input", renderMenu);

async function copyPix(btn) {
  try { await navigator.clipboard.writeText(CFG.pix.key); }
  catch (e) {
    const a = document.createElement("textarea");
    a.value = CFG.pix.key; document.body.appendChild(a); a.select();
    try { document.execCommand("copy"); } catch (_) { /* ignorar */ }
    a.remove();
  }
  const old = btn.textContent;
  btn.textContent = "Chave copiada ✓";
  setTimeout(() => { btn.textContent = old; }, 1800);
}

/* Combos de lanches */
$("#cbm").addEventListener("change", comboTotal);
$("#cbadd").addEventListener("click", () => {
  const c = COMBOS[currentCombo], id = "cb" + Date.now();
  combos[id] = { n: c.n, d: comboSelection().map(label).join(" + "), p: comboTotal() };
  cart[id] = 1; saveCart(); closeModal("#cbm"); renderMenu(); renderCart();
  showToast("Combo adicionado ao carrinho. Continue escolhendo!");
});

/* Pizzas */
$("#pzs").addEventListener("change", () => { pzSize = Number($("#pzs").value); updatePizzaLimit(); renderPizzaFlavors(); pizzaPrice(); });
$("#pzbat").addEventListener("change", pizzaPrice);
$("#pzdrink").addEventListener("change", pizzaPrice);
$("#pzflavors").addEventListener("change", e => {
  if (chosenFlavors().length > PIZZA_LIMITS[pzSize]) {
    e.target.checked = false;
    showToast(`Este tamanho permite até ${PIZZA_LIMITS[pzSize]} sabor(es).`);
  }
  pizzaPrice();
});
$("#pzadd").addEventListener("click", () => {
  const d = pizzaPrice();
  if (!d.chosen.length) { showToast("Escolha pelo menos um sabor de pizza."); return; }
  if (pzCombo) {
    const c = PIZZA_COMBOS.find(x => x.id === pzCombo);
    if (!d.drink) { showToast("Escolha o refrigerante do combo."); return; }
    if (!d.bat) { showToast(`Escolha a batata do combo (${c.batName}).`); return; }
  }
  const obs = $("#pznotes").value.trim();
  const detail = `${pzCombo ? SIZE_NAMES[pzSize] + " · " : ""}${d.chosen.length > 1 ? "Sabores" : "Sabor"}: ${d.chosen.map(x => x.name).join(" / ")}${d.bat ? " · " + d.bat.n : ""}${d.drink ? " · " + d.drink.n : ""}${obs ? " · Obs.: " + obs : ""}`;
  const id = "pz" + Date.now();
  combos[id] = { n: pzCombo ? PIZZA_COMBOS.find(x => x.id === pzCombo).n : `Pizza ${SIZE_NAMES[pzSize]}`, d: detail, p: d.price };
  cart[id] = 1; pzCombo = null;
  saveCart(); closeModal("#pizzam"); renderMenu(); renderCart();
  showToast("Pizza adicionada ao carrinho. Continue escolhendo!");
});

/* ===== Envio do pedido ===== */
let sending = false;
function validateOrder() {
  const errors = [], bad = [];
  if (!itemCount()) errors.push("Adicione itens ao carrinho.");
  if (!$("#nm").value.trim()) { errors.push("Informe seu nome."); bad.push("#nm"); }
  if ($("#ph").value.replace(/\D/g, "").length < 10) { errors.push("Informe um telefone válido com DDD."); bad.push("#ph"); }
  if (isDelivery() && !$("#ad").value.trim()) { errors.push("Informe o endereço de entrega."); bad.push("#ad"); }
  document.querySelectorAll("#dr input.invalid").forEach(i => i.classList.remove("invalid"));
  bad.forEach(s => $(s).classList.add("invalid"));
  if (bad.length) $(bad[0]).focus();
  return errors;
}
function afterOrderSent() {
  cart = {}; notes = {}; combos = {};
  saveCart(); renderMenu(); renderCart(); closeModal("#dr");
}
$("#send").addEventListener("click", async e => {
  if (sending) { e.preventDefault(); return; }
  const errors = validateOrder(), box = $("#err");
  if (errors.length) { e.preventDefault(); box.textContent = errors.join(" "); box.hidden = false; return; }
  box.hidden = true;
  if (!db) { showToast("Pedido seguirá pelo WhatsApp."); setTimeout(afterOrderSent, 1500); return; }

  e.preventDefault();
  sending = true;
  const waUrl = $("#send").href;
  const win = window.open("about:blank", "_blank");
  if (win) win.document.write("<title>Registrando pedido…</title><p style='font:16px sans-serif;padding:24px'>Registrando seu pedido…</p>");
  const items = Object.keys(cart).map(k => {
    const p = by(k);
    return { product_key: k, name: fname(p), quantity: cart[k], unit_price: p.p, line_total: lineTotal(k), details: combos[k]?.d || null, notes: notes[k] || null };
  });
  try {
    const delivery = isDelivery();
    const { error } = await db.from("orders").insert({
      customer_name: $("#nm").value.trim(),
      customer_phone: $("#ph").value.trim(),
      fulfillment: delivery ? "delivery" : "pickup",
      address: delivery ? $("#ad").value.trim() : null,
      reference: delivery ? $("#rf2").value.trim() : null,
      payment_method: $("#pay").value,
      payment_change: $("#pay").value === "Dinheiro" ? $("#tr").value.trim() : null,
      customer_notes: $("#orderobs").value.trim() || null,
      items,
      subtotal: Number(subtotal().toFixed(2)),
      delivery_fee: delivery ? CFG.fee : 0,
      total: Number(grandTotal().toFixed(2)),
      status: "received"
    });
    if (error) throw error;
    if (win) win.location = waUrl; else location.href = waUrl;
    showToast("Pedido registrado! Finalize o envio pelo WhatsApp.");
    afterOrderSent();
  } catch (err) {
    if (win) win.close();
    box.textContent = "Não foi possível registrar o pedido agora. Verifique sua conexão e tente novamente, ou chame a gente direto no WhatsApp.";
    box.hidden = false;
    console.error(err);
  } finally {
    sending = false;
  }
});

/* ===== Inicialização ===== */
$("#pk").textContent = CFG.pix.key;
$("#tabs").innerHTML = [["Combos", "combos"], ...MENU.map((c, i) => [NAV_LABELS[c.n] || c.n, "c" + i])]
  .map(t => `<button data-a="go" data-k="${t[1]}">${t[0]}</button>`).join("");
$("#waTop").href = `https://wa.me/${CFG.wa}?text=` + encodeURIComponent("Olá! Vim pelo site e gostaria de fazer um pedido.");
(function status() {
  const s = $("#st"), on = isOpenNow();
  s.hidden = false; s.textContent = on ? "Aberto agora" : "Fechado";
  s.classList.toggle("off", !on);
})();
renderMenu();
renderCart();
syncAvailability();
setInterval(syncAvailability, 120000); // atualiza disponibilidade e promoções a cada 2 min
