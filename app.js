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
  const media = r.media_historica_semana;
  document.getElementById("kpi-semana-comparacao").innerHTML = media != null
    ? `<span class="suave">Média dessa semana em outros anos:</span> ${fmt(media)}`
    : "";

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

function graficoCurva(dados) {
  const obs = dados.observados;
  const prev = dados.previsao;
  const labels = [...obs.map((o) => o.semana_inicio), ...prev.map((p) => p.semana_inicio)].map(fmtData);
  const vazio = (n) => Array(n).fill(null);
  const ultimo = obs.length ? obs[obs.length - 1].estimados : null;

  desenhar("graf-curva", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Casos notificados", data: [...obs.map((o) => o.notificados), ...vazio(prev.length)],
          borderColor: cor("--serie-azul"), borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: "Estimativa InfoDengue (atraso de notificação)",
          data: [...obs.map((o) => o.estimados), ...vazio(prev.length)],
          borderColor: cor("--serie-azul-2"), borderDash: [2, 3], borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: "Previsão do nosso modelo", data: [...vazio(obs.length - 1), ultimo, ...prev.map((p) => p.previstos)],
          borderColor: cor("--serie-vermelha"), borderDash: [6, 4], borderWidth: 2, pointRadius: 3 },
        { label: "Mínimo", data: [...vazio(obs.length), ...prev.map((p) => p.minimo)],
          borderColor: "transparent", pointRadius: 0 },
        { label: "Máximo", data: [...vazio(obs.length), ...prev.map((p) => p.maximo)],
          borderColor: "transparent", backgroundColor: transparente(cor("--serie-vermelha"), 0.15), fill: "-1", pointRadius: 0 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { filter: (i) => i.datasetIndex < 3 } } },
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

let ultimosDados = null;

function desenharGraficos() {
  if (!ultimosDados) return;
  graficoCurva(ultimosDados.curva);
  graficoChuva(ultimosDados.chuva);
  graficoAnual(ultimosDados.anual);
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
  try {
    const [resumo, curva, chuva, anual] = await Promise.all([
      buscar(`/resumo?doenca=${doenca}`),
      buscar(`/casos/semanal?doenca=${doenca}&desde=${umAnoAtras}`),
      buscar(`/clima-vs-casos?doenca=${doenca}&desde=${doisAnosAtras}`),
      buscar(`/anual?doenca=${doenca}`),
    ]);
    if (pedido !== ultimoPedido) return; // chegou atrasada: já tem um pedido mais novo
    ultimosDados = { curva, chuva, anual };
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
