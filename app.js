// Front do Observatório: busca os dados na API e desenha o painel.
// "/api" é repassado pra API na VPS pelo vercel.json (mesma origem, sem CORS).
const API = "/api";
const graficos = {};

const NIVEL_TEXTO = {
  verde: { titulo: "Normal", acao: "Manter rotina de prevenção." },
  amarelo: { titulo: "Atenção", acao: "Reforçar visitas de agentes nos bairros com mais casos." },
  laranja: { titulo: "Alerta", acao: "Mutirões de limpeza e fumacê; preparar unidades de saúde." },
  vermelho: { titulo: "Epidemia", acao: "Abrir leitos de hidratação e ampliar atendimento." },
  indefinido: { titulo: "Sem dado", acao: "" },
};

const fmt = (n) => (n == null ? "–" : Math.round(n).toLocaleString("pt-BR"));
const fmtData = (iso) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
};

async function buscar(caminho) {
  const r = await fetch(API + caminho);
  if (!r.ok) throw new Error(`${caminho}: ${r.status}`);
  return r.json();
}

// pra partes extras do painel: se falhar, devolve null e só aquele pedaço some
const opcional = (caminho) => buscar(caminho).catch((e) => { console.warn(e); return null; });

// cores dos gráficos vêm do CSS, então mudam junto com o tema
const cor = (nome) => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
const transparente = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, "0");

function desenhar(id, config) {
  Chart.defaults.color = cor("--suave");
  Chart.defaults.borderColor = cor("--grade");
  if (graficos[id]) graficos[id].destroy();
  graficos[id] = new Chart(document.getElementById(id), config);
}

function preencherKpis(r, semanasPrevistas) {
  // sem previsão = lista vazia (uma previsão de 0 casos é um valor válido, não "sem dado")
  const p = r.previsao_4_semanas;
  const temPrevisao = semanasPrevistas.length > 0;
  document.getElementById("kpi-previsao").textContent = temPrevisao ? fmt(p.total) : "–";
  document.getElementById("kpi-previsao-faixa").innerHTML = temPrevisao
    ? `<span class="suave">Faixa provável:</span> ${fmt(p.minimo)} a ${fmt(p.maximo)}`
    : "Previsão indisponível";

  // contagem real até agora; a estimativa do InfoDengue vai separada, com o nome dela
  document.getElementById("atualizacao").textContent = `Dados até a semana de ${fmtData(r.semana_atual)}`;
  const [, mes, dia] = r.semana_atual.split("-");
  document.getElementById("kpi-semana-rotulo").textContent = `Notificados · semana de ${dia}/${mes}`;
  const notif = r.casos_notificados_semana;
  document.getElementById("kpi-semana").textContent = fmt(notif);

  // barra: quanto da estimativa já foi notificado (as notificações chegam com atraso)
  const est = r.estimativa_infodengue;
  const temAtraso = est.casos != null && Math.round(est.casos) > notif;
  document.getElementById("kpi-semana-atraso").hidden = !temAtraso;
  if (temAtraso) {
    const pct = Math.round((notif / est.casos) * 100);
    document.getElementById("kpi-semana-barra").style.width = `${pct}%`;
    document.getElementById("kpi-semana-trilho").setAttribute(
      "aria-label", `${pct}% da estimativa já notificados`);
    document.getElementById("kpi-semana-estimativa").innerHTML =
      `<span class="suave">Deve fechar em</span> ~${fmt(est.casos)} <span class="suave">(${fmt(est.minimo)}–${fmt(est.maximo)})</span>`;
  }
  // canal endêmico: compara a ESTIMATIVA (a semana ainda não fechou) com a faixa normal
  const c = r.canal_endemico_semana;
  let comparacao = "";
  if (c && c.q1 != null) {
    const situacao = est.casos == null ? ""
      : est.casos > c.q3 ? " · acima do normal"
      : est.casos < c.q1 ? " · abaixo do normal"
      : " · dentro do normal";
    comparacao = `<span class="suave">Faixa normal dessa semana:</span> ${fmt(c.q1)} a ${fmt(c.q3)}${situacao}`;
  }
  document.getElementById("kpi-semana-comparacao").innerHTML = comparacao;

  document.getElementById("kpi-incidencia").textContent =
    r.incidencia_100k == null ? "–" : r.incidencia_100k.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

  // nível: nome + "nível X de 4" + escala; a cor nunca é a única pista
  const nivel = NIVEL_TEXTO[r.nivel_alerta] || NIVEL_TEXTO.indefinido;
  const numero = ["verde", "amarelo", "laranja", "vermelho"].indexOf(r.nivel_alerta) + 1;
  document.getElementById("kpi-alerta-card").dataset.nivel = numero;
  document.getElementById("kpi-alerta").textContent = nivel.titulo;
  document.getElementById("kpi-alerta-escala").textContent = numero ? `nível ${numero} de 4` : "";
  document.getElementById("kpi-acao").textContent = nivel.acao;
}

function graficoCurva(dados, canal) {
  const obs = dados.observados;
  const prev = dados.previsao;
  const labels = [...obs.map((o) => o.semana_inicio), ...prev.map((p) => p.semana_inicio)].map(fmtData);
  const vazio = (n) => Array(n).fill(null);
  const ultimo = obs.length ? obs[obs.length - 1].estimados : null;

  // faixa normal (canal endêmico): q1 a q3 da mesma semana epidemiológica nos anos anteriores
  const faixa = [];
  if (canal) {
    const porSemana = Object.fromEntries(canal.map((c) => [c.semana_epi, c]));
    const semanas = [...obs, ...prev].map((p) => porSemana[p.semana_epi] || {});
    faixa.push(
      { label: "Faixa normal (início)", data: semanas.map((c) => c.q1), semLegenda: true, semDica: true,
        borderColor: "transparent", pointRadius: 0, tension: 0.2 },
      { label: "Faixa normal (metade do meio dos anos anteriores)", data: semanas.map((c) => c.q3),
        faixaNormal: semanas, borderColor: "transparent", pointRadius: 0, tension: 0.2,
        backgroundColor: transparente(cor("--faixa-normal"), 0.22), fill: "-1" },
    );
  }

  desenhar("graf-curva", {
    type: "line",
    data: {
      labels,
      datasets: [
        ...faixa, // primeiro no array = desenhada atrás das curvas
        { label: "Casos notificados", data: [...obs.map((o) => o.notificados), ...vazio(prev.length)],
          borderColor: cor("--serie-azul"), borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: "Estimativa InfoDengue (atraso de notificação)",
          data: [...obs.map((o) => o.estimados), ...vazio(prev.length)],
          borderColor: cor("--serie-azul-2"), borderDash: [2, 3], borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: "Previsão do nosso modelo", data: [...vazio(obs.length - 1), ultimo, ...prev.map((p) => p.previstos)],
          borderColor: cor("--serie-vermelha"), borderDash: [6, 4], borderWidth: 2, pointRadius: 3 },
        { label: "Mínimo", data: [...vazio(obs.length), ...prev.map((p) => p.minimo)],
          borderColor: "transparent", pointRadius: 0, semLegenda: true },
        { label: "Máximo", data: [...vazio(obs.length), ...prev.map((p) => p.maximo)], semLegenda: true,
          borderColor: "transparent", backgroundColor: transparente(cor("--serie-vermelha"), 0.15), fill: "-1", pointRadius: 0 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { filter: (item, data) => !data.datasets[item.datasetIndex].semLegenda } },
        tooltip: {
          filter: (item) => !item.dataset.semDica,
          callbacks: {
            label: (ctx) => {
              const f = ctx.dataset.faixaNormal;
              return f ? `Faixa normal: ${fmt(f[ctx.dataIndex].q1)} a ${fmt(f[ctx.dataIndex].q3)}`
                       : `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`;
            },
          },
        },
      },
      scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { beginAtZero: true } },
    },
  });
}

function graficoChuva(dados) {
  desenhar("graf-chuva", {
    data: {
      labels: dados.map((d) => fmtData(d.semana_inicio)),
      datasets: [
        { type: "bar", label: "Chuva (mm)", data: dados.map((d) => d.chuva_mm),
          backgroundColor: transparente(cor("--serie-azul"), 0.35), yAxisID: "chuva" },
        { type: "line", label: "Casos (estimativa InfoDengue)", data: dados.map((d) => d.casos),
          borderColor: cor("--serie-vermelha"), borderWidth: 2, pointRadius: 0, tension: 0.2, yAxisID: "casos" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } },
        chuva: { position: "left", beginAtZero: true, title: { display: true, text: "Chuva (mm)" } },
        casos: { position: "right", beginAtZero: true, grid: { drawOnChartArea: false },
                 title: { display: true, text: "Casos" } },
      },
    },
  });
}

function graficoDefasagem(dados) {
  // análise diagnóstica: em que defasagem a chuva/temperatura mais acompanham os casos
  document.getElementById("bloco-defasagem").hidden = !dados;
  if (!dados) return;
  const num = (v) => (v == null ? "–" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  desenhar("graf-defasagem", {
    type: "bar",
    data: {
      labels: dados.map((d) => d.defasagem_semanas),
      datasets: [
        { label: "Chuva", data: dados.map((d) => d.chuva), backgroundColor: cor("--serie-azul"),
          borderRadius: 3, borderSkipped: "start" },
        { label: "Temperatura", data: dados.map((d) => d.temperatura), backgroundColor: cor("--serie-laranja"),
          borderRadius: 3, borderSkipped: "start" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            title: (itens) => `Clima de ${itens[0].label} semana(s) antes`,
            label: (ctx) => `${ctx.dataset.label}: ${num(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { title: { display: true, text: "Semanas entre o clima e os casos" } },
        y: { suggestedMin: -0.2, suggestedMax: 0.6, title: { display: true, text: "Correlação" } },
      },
    },
  });
}

function graficoAnual(dados) {
  // ano em andamento: barra mais clara e marcado com *, pra não parecer ano fechado
  const parcial = dados.find((d) => d.parcial);
  const legenda = document.getElementById("legenda-anual");
  legenda.textContent = parcial
    ? `*${parcial.ano} ainda em andamento (dados até a semana de ${fmtData(parcial.ultima_semana)})`
    : "";
  legenda.hidden = !parcial;

  desenhar("graf-anual", {
    type: "bar",
    data: {
      labels: dados.map((d) => (d.parcial ? `${d.ano}*` : d.ano)),
      datasets: [{
        label: "Casos notificados",
        data: dados.map((d) => d.casos),
        backgroundColor: dados.map((d) => (d.parcial ? transparente(cor("--serie-azul"), 0.35) : cor("--serie-azul"))),
      }],
    },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
               scales: { y: { beginAtZero: true } } },
  });
}

// ---------- mapas (cor por faixa de incidência, escala de um tom só: claro = pouco, escuro = muito) ----------
const FAIXAS_CALOR = [1, 3, 6, 12, 25]; // incidência semanal por 100 mil hab.
const faixaDe = (v, limites) => limites.filter((l) => v >= l).length; // 0 a limites.length
const num1 = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function legendaCores(id, limites, unidade) {
  const rotulos = [`menos de ${limites[0]}`, ...limites.slice(0, -1).map((l, i) => `${l} a ${limites[i + 1]}`),
                   `${limites[limites.length - 1]} ou mais`];
  document.getElementById(id).innerHTML =
    rotulos.map((r, i) => `<span><i class="n${i}"></i>${r}</span>`).join("") +
    `<span><i class="sem"></i>sem dado</span><span class="suave">${unidade}</span>`;
}

function mapaCalor(dados) {
  document.getElementById("painel-calor").hidden = !(dados && dados.length);
  if (!dados || !dados.length) return;
  const porAno = {};
  for (const d of dados) (porAno[d.ano] ||= {})[d.semana_epi] = d.incidencia_100k;
  const anos = Object.keys(porAno).map(Number).sort((a, b) => a - b);
  const semanas = Array.from({ length: 53 }, (_, i) => i + 1);

  // cabeçalho com algumas semanas, depois uma linha por ano
  let html = "<span></span>" + semanas.map((s) => `<span class="calor-semana">${s === 1 || s % 10 === 0 ? s : ""}</span>`).join("");
  for (const ano of anos) {
    html += `<span class="calor-ano">${ano}</span>`;
    for (const s of semanas) {
      const v = porAno[ano][s];
      html += v == null
        ? "<i></i>"
        : `<i class="n${faixaDe(v, FAIXAS_CALOR)}" title="${ano}, semana ${s}: ${num1(v)} por 100 mil"></i>`;
    }
  }
  const grade = document.getElementById("mapa-calor");
  grade.innerHTML = html;
  // resumo em texto pra leitor de tela
  const pico = dados.reduce((a, b) => ((b.incidencia_100k ?? -1) > (a.incidencia_100k ?? -1) ? b : a));
  grade.setAttribute("aria-label", `Incidência semanal de ${anos[0]} a ${anos[anos.length - 1]}. ` +
    `Maior valor: ${pico.ano}, semana ${pico.semana_epi}, ${num1(pico.incidencia_100k)} por 100 mil habitantes.`);
  legendaCores("legenda-calor", FAIXAS_CALOR, "casos por 100 mil hab. na semana");
}

const FAIXAS_RMS = [5, 15, 30, 60, 120]; // incidência somada em 4 semanas, por 100 mil hab.

// malha dos 13 municípios (GeoJSON do IBGE, em rms.geojson): baixa uma vez só
let malhaRms = null;
const carregarMalha = () => (malhaRms ||= fetch("rms.geojson").then((r) => r.json()).catch(() => (malhaRms = null)));

function mapaRms(dados, malha) {
  document.getElementById("painel-rms").hidden = !(dados && malha);
  if (!dados || !malha) return;
  const porGeocode = Object.fromEntries(dados.municipios.map((m) => [String(m.geocode), m]));
  const valor = (m) => (m.incidencia_4sem == null ? "sem dado" : num1(m.incidencia_4sem));
  const classeDe = (m) => (m.incidencia_4sem == null ? "sem" : `n${faixaDe(m.incidencia_4sem, FAIXAS_RMS)}`);
  // posição no ranking (1 = maior incidência da RMS); empatados dividem a mesma posição
  const inc = (m) => m.incidencia_4sem ?? -1;
  const ordem = [...dados.municipios].sort((a, b) => inc(b) - inc(a));
  const posicao = Object.fromEntries(ordem.map((m) => [String(m.geocode), 1 + ordem.filter((o) => inc(o) > inc(m)).length]));

  // projeção simples (longitude x cos(latitude), latitude): numa área pequena como a RMS não distorce
  const aneis = (f) => (f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat());
  const pontos = malha.features.flatMap((f) => aneis(f).flat());
  const lons = pontos.map((p) => p[0]);
  const lats = pontos.map((p) => p[1]);
  const [lonMin, latMin, latMax] = [Math.min(...lons), Math.min(...lats), Math.max(...lats)];
  const cosLat = Math.cos(((latMin + latMax) / 2) * Math.PI / 180);
  const LARGURA = 600;
  const escala = LARGURA / ((Math.max(...lons) - lonMin) * cosLat);
  const xy = ([lon, lat]) => [(lon - lonMin) * cosLat * escala, (latMax - lat) * escala];

  // centro da maior parte de cada município (fórmula da área de Gauss), onde vai o nome
  function centro(anel) {
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < anel.length - 1; i++) {
      const [x0, y0] = anel[i], [x1, y1] = anel[i + 1];
      const c = x0 * y1 - x1 * y0;
      area += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
    const xs = anel.map((p) => p[0]);
    return { x: cx / (3 * area), y: cy / (3 * area), area: Math.abs(area / 2),
             largura: Math.max(...xs) - Math.min(...xs) };
  }

  const areas = [], rotulos = [];
  const centros = {};
  for (const f of malha.features) {
    const geo = f.properties.codarea;
    // município da malha que não veio na API: entra como "sem dado" (e o balão do hover também acha ele)
    const m = (porGeocode[geo] ||= { nome: f.properties.nome, incidencia_4sem: null, casos_4sem: null });
    const projetados = aneis(f).map((anel) => anel.map(xy));
    const d = projetados.map((a) => "M" + a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z").join("");
    areas.push(`<path class="${classeDe(m)}" data-geo="${geo}" d="${d}"></path>`);
    const c = projetados.map(centro).reduce((a, b) => (b.area > a.area ? b : a));
    centros[geo] = c;
    // só escreve o nome se couber na largura do município (o resto aparece no hover e na tabela)
    if (m.nome.length * 8.4 < c.largura * 0.9) { // ~8,4 de largura por letra com fonte 15
      rotulos.push(`<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}">${m.nome}</text>`);
    }
  }

  const svg = document.getElementById("mapa-rms");
  svg.setAttribute("viewBox", `0 0 ${LARGURA} ${((latMax - latMin) * escala).toFixed(0)}`);
  svg.innerHTML = `<g class="areas">${areas.join("")}</g><g class="rotulos" aria-hidden="true">${rotulos.join("")}</g>`;

  const tabela = document.getElementById("tabela-rms");
  tabela.innerHTML = ordem.map((m) =>
    `<tr data-geo="${m.geocode}" tabindex="0"><td><i class="${classeDe(m)}"></i>${m.nome}</td>` +
    `<td>${valor(m)}</td><td>${fmt(m.casos_4sem)}</td></tr>`).join("");

  // ---- interação: destaque + balão, ligando o mapa e a tabela ----
  const dica = document.getElementById("dica-rms");
  const caixa = svg.parentElement; // .rms-mapa, referência pra posição do balão

  function destacar(geo, px, py) {
    svg.querySelectorAll(".ativo").forEach((el) => el.classList.remove("ativo"));
    tabela.querySelectorAll(".ativo").forEach((el) => el.classList.remove("ativo"));
    if (!geo) { dica.hidden = true; return; }
    const area = svg.querySelector(`path[data-geo="${geo}"]`);
    area.classList.add("ativo");
    area.parentNode.appendChild(area); // traz pra frente, senão a borda fica escondida pelos vizinhos
    tabela.querySelector(`tr[data-geo="${geo}"]`)?.classList.add("ativo");

    const m = porGeocode[geo];
    dica.innerHTML = `<strong>${m.nome}</strong>` + (m.incidencia_4sem == null
      ? "<span>sem dado das 4 semanas</span>"
      : `<span>${valor(m)} por 100 mil hab.</span><span>${fmt(m.casos_4sem)} casos estimados</span>` +
        `<span class="suave">${posicao[geo]}º de ${ordem.length} na RMS</span>`);
    dica.hidden = false;
    // sem posição do mouse (veio da tabela): aponta pro centro do município. getScreenCTM converte
    // a coordenada do mapa pra tela já considerando a escala e a centralização do desenho no <svg>
    if (px == null) {
      const tela = new DOMPoint(centros[geo].x, centros[geo].y).matrixTransform(svg.getScreenCTM());
      const r = caixa.getBoundingClientRect();
      [px, py] = [tela.x - r.left, tela.y - r.top];
    }
    // não deixa o balão sair pela direita do mapa
    const x = Math.min(px + 14, caixa.clientWidth - dica.offsetWidth - 4);
    dica.style.left = `${Math.max(4, x)}px`;
    dica.style.top = `${py + 14}px`;
  }

  // atribuição direta (onX = ...) e não addEventListener: o mapa é redesenhado ao trocar
  // de doença e de tema, e assim não acumula ouvintes repetidos
  svg.onpointermove = (e) => {
    const area = e.target.closest("path");
    const r = caixa.getBoundingClientRect();
    destacar(area?.dataset.geo, e.clientX - r.left, e.clientY - r.top);
  };
  svg.onpointerleave = () => destacar(null);
  // no celular o toque dispara pointerleave logo ao soltar o dedo; o click vem depois e reabre o balão
  svg.onclick = svg.onpointermove;
  tabela.onpointerover = (e) => destacar(e.target.closest("tr")?.dataset.geo);
  tabela.onpointerleave = () => destacar(null);
  for (const tr of tabela.rows) { // teclado: Tab pelas linhas também destaca no mapa
    tr.onfocus = () => destacar(tr.dataset.geo);
    tr.onblur = () => destacar(null);
  }

  document.getElementById("legenda-rms").textContent =
    `Casos estimados por 100 mil habitantes, somados nas 4 semanas até ${fmtData(dados.semana_fim)}. ` +
    "Fonte: InfoDengue; malha municipal: IBGE.";
  legendaCores("legenda-cores-rms", FAIXAS_RMS, "casos por 100 mil hab. em 4 semanas");
}

let ultimosDados = null;

function desenharGraficos() {
  if (!ultimosDados) return;
  graficoCurva(ultimosDados.curva, ultimosDados.canal);
  graficoChuva(ultimosDados.chuva);
  graficoDefasagem(ultimosDados.defasagem);
  graficoAnual(ultimosDados.anual);
  mapaCalor(ultimosDados.calor);
  mapaRms(ultimosDados.rms, ultimosDados.malha);
}

// ---------- tema claro/escuro ----------
const botaoTema = document.getElementById("tema");

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  botaoTema.setAttribute("aria-checked", String(tema === "escuro"));
  desenharGraficos(); // os gráficos são canvas: precisam ser redesenhados com as cores novas
}

botaoTema.addEventListener("click", () => {
  const novo = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
  try { localStorage.setItem("tema", novo); } catch (e) {}
  aplicarTema(novo);
});

// sem escolha salva, acompanha o tema do sistema
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  let salvo = null;
  try { salvo = localStorage.getItem("tema"); } catch (err) {}
  if (!salvo) aplicarTema(e.matches ? "escuro" : "claro");
});

botaoTema.setAttribute("aria-checked", String(document.documentElement.dataset.tema === "escuro"));

// cada carregar() ganha um número; se o usuário trocar de doença antes da resposta chegar,
// a resposta velha é ignorada (senão ela poderia chegar depois e desenhar a doença errada)
let ultimoPedido = 0;

async function carregar() {
  const pedido = ++ultimoPedido;
  const doenca = document.querySelector('input[name="doenca"]:checked').value;
  const doisAnosAtras = new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10);
  const umAnoAtras = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  caixaErro.hidden = true;
  // os extras começam a baixar junto com os essenciais
  const extras = Promise.all([
    opcional(`/canal-endemico?doenca=${doenca}`),
    opcional(`/correlacao-defasagem?doenca=${doenca}`),
    opcional(`/mapa-calor?doenca=${doenca}`),
    opcional(`/municipios?doenca=${doenca}`),
    carregarMalha(),
  ]);
  try {
    const [resumo, curva, chuva, anual] = await Promise.all([
      buscar(`/resumo?doenca=${doenca}`),
      buscar(`/casos/semanal?doenca=${doenca}&desde=${umAnoAtras}`),
      buscar(`/clima-vs-casos?doenca=${doenca}&desde=${doisAnosAtras}`),
      buscar(`/anual?doenca=${doenca}`),
    ]);
    const [canal, defasagem, calor, rms, malha] = await extras;
    if (pedido !== ultimoPedido) return; // chegou atrasada: já tem um pedido mais novo
    ultimosDados = { curva, chuva, anual, canal, defasagem, calor, rms, malha };
    preencherKpis(resumo, curva.previsao);
    desenharGraficos();
  } catch (e) {
    if (pedido !== ultimoPedido) return;
    console.error(e);
    caixaErro.hidden = false; // aviso dentro da página, no lugar do alert() que travava a tela
  }
}

const caixaErro = document.getElementById("erro");
document.getElementById("tentar-de-novo").addEventListener("click", carregar);
document.getElementById("doenca").addEventListener("change", carregar);
carregar();
