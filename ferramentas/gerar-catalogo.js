/* Gera catalog.json e sincronizar-produtos.sql a partir de js/menu-data.js
   Uso (na pasta do site):  node ferramentas/gerar-catalogo.js
   Assim o cardápio (menu-data.js) é a ÚNICA fonte de preços e nomes. */
const fs = require('fs');
const SIZE = ['Pequena', 'Média', 'Grande', 'Família'];
const src = fs.readFileSync(__dirname + "/../js/menu-data.js", "utf8");
const { MENU } = new Function(src + "; return { MENU };")(); // funciona em Windows, Mac e Linux

const rows = [];
MENU.forEach((c, ci) => c.i.forEach((x, ii) => {
  if (Array.isArray(x[2])) x[2].forEach((p, s) => rows.push({ product_key: `${ci}-${ii}-${s}`, name: `Pizza ${x[0]} (${SIZE[s]})`, category: c.n, price: p, available: true }));
  else rows.push({ product_key: `${ci}-${ii}`, name: x[0], category: c.n, price: x[2], available: true });
}));

fs.writeFileSync(__dirname + '/catalog.json', JSON.stringify(rows, null, 2));

const q = v => "'" + String(v).replace(/'/g, "''") + "'";
const sql = `-- Gerado por gerar-catalogo.js. Atualiza nome, categoria e preço dos produtos
-- SEM mexer na disponibilidade (available) que você controla no painel.
insert into products (product_key, name, category, price, available)
values
${rows.map(r => `  (${q(r.product_key)}, ${q(r.name)}, ${q(r.category)}, ${r.price}, true)`).join(',\n')}
on conflict (product_key) do update
  set name = excluded.name, category = excluded.category, price = excluded.price, updated_at = now();
`;
fs.writeFileSync(__dirname + '/sincronizar-produtos.sql', sql);
console.log(rows.length + ' produtos gerados.');
