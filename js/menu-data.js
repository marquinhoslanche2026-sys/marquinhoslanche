/* =====================================================================
   CARDÁPIO — edite preços e itens aqui.
   Formato de cada item: [nome, descrição, preço]
   Pizzas têm 4 preços: [Pequena, Média, Grande, Família]
   ATENÇÃO: se mudar a ORDEM dos itens/categorias, os códigos de
   disponibilidade e promoções (ex.: "2-0-1") do painel mudam também.
   Para adicionar itens novos, coloque sempre no FINAL da categoria.
   ===================================================================== */
const A = x => "Pão brioche, hambúrguer 120g, " + x;

const MENU = [
  { n: "Hambúrguer Industrial", i: [
    ["X-Burguer", "Pão, carne, queijo, presunto, tomate, alface", 13],
    ["X-Salada", "Pão, carne, ovo, queijo, presunto, tomate, alface", 15],
    ["X-Salada Duplo", "Pão, 2 carnes, 2 ovos, queijo, presunto, tomate, alface", 19],
    ["X-Bacon", "Pão, carne, bacon, ovo, queijo, presunto, tomate, alface", 18],
    ["X-Calabresa", "Pão, carne, calabresa, ovo, queijo, presunto, tomate, alface", 17],
    ["X-Salsicha", "Pão, carne, ovo, queijo, presunto, 2 salsichas, tomate, alface", 16],
    ["X-Calabacon", "Pão, carne, ovo, queijo, presunto, bacon, calabresa, tomate, alface", 19],
    ["X-Tudo", "Pão, carne, ovo, bacon, calabresa, salsicha, queijo, presunto, tomate, alface", 29],
    ["X-Egg", "Pão, carne, ovo, queijo, presunto", 12],
    ["Misto Quente", "Pão, queijo e presunto", 5],
    ["Simples", "Pão, picadinho, ovo, queijo, presunto, tomate, alface", 7]
  ]},
  { n: "Hambúrguer Artesanal", i: [
    ["X-Salada Artesanal", A("ovo, queijo mussarela, presunto, alface, tomate"), 24],
    ["X-Burguer Artesanal", A("queijo mussarela, presunto, alface, tomate"), 20],
    ["X-Duplo Artesanal", "Pão brioche, 2 hambúrgueres 120g, 2 ovos, queijo mussarela, presunto, alface, tomate", 28],
    ["X-Calabresa Artesanal", A("calabresa, ovo, queijo mussarela, presunto, alface, tomate"), 25],
    ["X-Bacon Artesanal", A("bacon, queijo mussarela, ovo, alface, tomate"), 26],
    ["Picanha Barbecue", "Pão brioche, blend de picanha 180g, queijo coalho, cebola caramelizada, maionese caseira", 27],
    ["X Marina", A("ovo, queijo coalho, cebola caramelizada, alface, tomate"), 26],
    ["X Carne Artesanal", "Pão brioche, isca 150g, queijo coalho, presunto, alface, tomate", 25],
    ["X-Salsicha Especial", A("2 salsichas, ovo, queijo mussarela, presunto, cheddar, alface, tomate"), 27],
    ["Frango Supreme", "Pão brioche, isca de frango, queijo mussarela, alface, tomate, molho especial", 24],
    ["X-Nortista", A("banana, queijo coalho, carne seca, alface, tomate"), 28],
    ["X Tudo", A("calabresa, bacon, salsicha, isca de carne, isca de frango, queijo mussarela, presunto, alface, tomate"), 33]
  ]},
  { n: "Pizzas Tradicionais", i: [
    ["Portuguesa", "Queijo, mortadela, azeitona, milho verde, tomate, pimentão e orégano", [35, 47, 55, 60]],
    ["Calabresa", "Queijo, calabresa, tomate, pimentão, cebola e orégano", [35, 47, 55, 60]],
    ["Mussarela", "Queijo mussarela, azeitona, tomate, pimentão e orégano", [35, 47, 55, 60]],
    ["2 Queijos", "Queijo, catupiry, azeitona, pimentão, tomate e orégano", [35, 47, 55, 60]],
    ["Baiana", "Queijo, calabresa moída, ovo, azeitona, tomate, pimentão e orégano", [35, 47, 55, 60]],
    ["Baurú", "Queijo, mortadela, cebola, azeitona, milho, tomate, pimentão e orégano", [35, 47, 55, 60]],
    ["Romeu e Julieta", "Queijo e goiabada", [35, 47, 55, 60]]
  ]},
  { n: "Pizzas Especiais", i: [
    ["Bacon", "Queijo, bacon, azeitona, tomate, pimentão e orégano", [38, 48, 59, 70]],
    ["Calabacon", "Queijo, calabresa moída, bacon, tomate, pimentão, cebola e orégano", [38, 48, 59, 70]],
    ["3 Queijos", "Queijo mussarela, cheddar, catupiry, azeitona, tomate, pimentão e orégano", [38, 48, 59, 70]],
    ["Frango com Catupiry", "Queijo, frango, catupiry, milho, pimentão, tomate e orégano", [38, 48, 59, 70]],
    ["Frango Crocante", "Queijo, frango, batata palha, azeitona, tomate, pimentão e orégano", [38, 48, 59, 70]],
    ["Carne Seca", "Queijo, carne seca, cebola, azeitona, tomate, pimentão e orégano", [38, 48, 59, 70]],
    ["Especial da Casa", "Queijos mussarela, frango, calabresa picada, catupiry, batata palha, azeitona, tomate, pimentão e orégano", [38, 48, 59, 70]],
    ["Filé com Fritas", "Mussarela, filé, batata frita, tomate, cebola, pimentão e orégano", [40, 50, 60, 70]],
    ["Carne Seca com Queijo Coalho", "Queijo coalho e carne seca", [40, 50, 60, 70]],
    ["Carne Seca com Banana", "Queijo, carne seca e banana", [40, 50, 60, 70]],
    ["Camarão", "Queijo e camarão", [40, 50, 60, 70]]
  ]},
  { n: "Esfirras", i: [
    ["Mista", "Queijo e presunto", 12],
    ["Mista Especial", "Queijo, presunto e catupiry", 13],
    ["Mista com Cheddar", "Queijo, presunto e cheddar", 14],
    ["Calabacon", "Queijo, calabresa e bacon", 17],
    ["Bacon Cremoso", "Queijo, bacon e catupiry", 16],
    ["de Bacon", "Queijo e bacon", 15],
    ["de Calabresa", "Queijo e calabresa moída", 15],
    ["de Portuguesa", "Queijo, presunto, milho", 14],
    ["Portuguesa Especial", "Queijo, presunto, milho, azeitona e ovo cozido", 16],
    ["de Carne Moída", "Queijo e carne moída (picadinho)", 15],
    ["de Carne", "Queijo e isca de carne", 18],
    ["de Carne Seca", "Queijo, carne seca", 17],
    ["Carne Seca com Banana", "Queijo, carne seca, banana", 18],
    ["de Frango", "Queijo e isca de frango grelhada", 14],
    ["Frango com Catupiry", "Queijo, isca de frango grelhada e catupiry", 16],
    ["de Carne Acebolada", "Queijo e isca de carne acebolada", 15],
    ["de Camarão ao Alho e Óleo", "Queijo e camarão ao alho e óleo", 18],
    ["À Moda do Chefe", "Queijo, isca de carne, frango e calabresa", 17],
    ["À Moda da Casa", "Queijo, presunto, calabresa e catupiry", 16],
    ["Mussarela", "Queijo mussarela", 16],
    ["Três Queijos", "Três queijos", 17]
  ]},
  { n: "Acompanhamentos", i: [
    ["Batata Tradicional", "Batata em palito", 15],
    ["Batata Especial", "200g de batata + calabresa", 25],
    ["Batata Big Family", "400g de batata + calabresa + bacon + cheddar", 30],
    ["Batata com Cheddar", "200g de batata", 18],
    ["Mini Nuggets", "8 unidades", 16],
    ["Barca de Fritas", "200g de batata + calabresa + farofa de bacon + cheddar + mini nuggets", 40]
  ]},
  { n: "Bebidas", i: [
    ["Refrigerante lata", "Coca, Fanta uva, Fanta laranja, Guaraná", 6],
    ["Suco natural 400 ml", "Se informe do sabor disponível", 7],
    ["Refrigerante 2 litros", "Coca, Fanta laranja, Fanta uva", 16],
    ["Refrigerante 1 litro", "Baré, Guaraná, Pepsi, Tuchaua", 8],
    ["Refrigerante 1 litro Coca", "Coca-Cola pet / Ls, Fanta laranja", 12],
    ["Água mineral", "", 3]
  ]}
];
