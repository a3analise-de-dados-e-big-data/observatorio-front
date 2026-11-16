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

function desenhar(id, config) {
  if (graficos[id]) graficos[id].destroy();
  graficos[id] = new Chart(document.getElementById(id), config);
}

function preencherKpis(r) {
  const p = r.previsao_4_semanas;
  document.getElementById("kpi-previsao").textContent = fmt(p.total);
  document.getElementById("kpi-previsao-faixa").textContent =
    p.total ? `entre ${fmt(p.minimo)} e ${fmt(p.maximo)}` : "previsão indisponível";

  document.getElementById("kpi-semana").textContent = fmt(r.casos_semana);
  const media = r.media_historica_semana;
  document.getElementById("kpi-semana-comparacao").textContent = media
    ? `média dessa semana nos anos anteriores: ${fmt(media)}`
    : `semana de ${fmtData(r.semana_atual)}`;

  // linguagem simples: "X a cada 100 mil moradores"
  document.getElementById("kpi-incidencia").textContent =
    r.incidencia_100k == null ? "–" : r.incidencia_100k.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  document.getElementById("kpi-incidencia-texto").textContent = "casos a cada 100 mil moradores";

  const nivel = NIVEL_TEXTO[r.nivel_alerta] || NIVEL_TEXTO.indefinido;
  const card = document.getElementById("kpi-alerta-card");
  card.className = `kpi nivel-${r.nivel_alerta}`;
  document.getElementById("kpi-alerta").textContent = nivel.titulo;
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
        { label: "Casos registrados", data: [...obs.map((o) => o.estimados), ...vazio(prev.length)],
          borderColor: "#2563eb", borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: "Previsão", data: [...vazio(obs.length - 1), ultimo, ...prev.map((p) => p.previstos)],
          borderColor: "#dc2626", borderDash: [6, 4], borderWidth: 2, pointRadius: 3 },
        { label: "Mínimo", data: [...vazio(obs.length), ...prev.map((p) => p.minimo)],
          borderColor: "transparent", pointRadius: 0 },
        { label: "Máximo", data: [...vazio(obs.length), ...prev.map((p) => p.maximo)],
          borderColor: "transparent", backgroundColor: "rgba(220,38,38,0.15)", fill: "-1", pointRadius: 0 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { filter: (i) => i.datasetIndex < 2 } } },
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
          backgroundColor: "rgba(37,99,235,0.35)", yAxisID: "chuva" },
        { type: "line", label: "Casos", data: dados.map((d) => d.casos),
          borderColor: "#dc2626", borderWidth: 2, pointRadius: 0, tension: 0.2, yAxisID: "casos" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 10 } },
        chuva: { position: "left", beginAtZero: true, title: { display: true, text: "Chuva (mm)" } },
        casos: { position: "right", beginAtZero: true, grid: { drawOnChartArea: false },
                 title: { display: true, text: "Casos" } },
      },
    },
  });
}

function graficoAnual(dados) {
  desenhar("graf-anual", {
    type: "bar",
    data: {
      labels: dados.map((d) => d.ano),
      datasets: [{ label: "Casos", data: dados.map((d) => d.casos), backgroundColor: "#2563eb" }],
    },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
               scales: { y: { beginAtZero: true } } },
  });
}

async function carregar() {
  const doenca = document.getElementById("doenca").value;
  const doisAnosAtras = new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10);
  const umAnoAtras = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  try {
    const [resumo, curva, chuva, anual] = await Promise.all([
      buscar(`/resumo?doenca=${doenca}`),
      buscar(`/casos/semanal?doenca=${doenca}&desde=${umAnoAtras}`),
      buscar(`/clima-vs-casos?doenca=${doenca}&desde=${doisAnosAtras}`),
      buscar(`/anual?doenca=${doenca}`),
    ]);
    preencherKpis(resumo);
    graficoCurva(curva);
    graficoChuva(chuva);
    graficoAnual(anual);
  } catch (e) {
    console.error(e);
    alert("Não consegui carregar os dados. A API está no ar e o ETL já rodou?");
  }
}

document.getElementById("doenca").addEventListener("change", carregar);
carregar();
