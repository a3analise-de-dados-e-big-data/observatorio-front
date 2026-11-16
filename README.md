# Observatório de Arboviroses de Salvador · Painel

Front do trabalho A3 (Análise de Dados e Big Data · UNIFACS). HTML, CSS e JavaScript puros,
com gráficos em Chart.js. Não tem build: a Vercel serve os arquivos como estão.

Os dados vêm da API, que roda na VPS e fica no repositório
[`observatorio-api`](https://github.com/a3analise-de-dados-e-big-data/observatorio-api).

| Arquivo | O que é |
| --- | --- |
| `index.html` | Estrutura do painel |
| `app.js` | Busca os dados em `/api/...` e desenha os gráficos |
| `style.css` | Visual |
| `vercel.json` | Repassa `/api/*` pra API na VPS |

## Como o front chega na API

O `app.js` chama `/api/...` no próprio domínio do front. A Vercel repassa essas chamadas
pra `https://observatorio-api.rafaelrangelalmeida.com/api/...` (regra em `vercel.json`).

Assim o navegador acha que front e API são o mesmo site: não precisa de CORS, e trocar
o endereço da API é mudar uma linha no `vercel.json`.

## Publicar na Vercel

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório `observatorio-front`.
   Se ele não aparecer, clique em *Adjust GitHub App Permissions* e dê acesso à
   organização `a3analise-de-dados-e-big-data`.
2. **Framework Preset:** `Other`. Deixe *Build Command* e *Output Directory* vazios.
3. *Deploy*. A cada push na `main` a Vercel publica de novo sozinha.

## Rodar no seu PC

O `vercel.json` só vale na Vercel. Localmente, use a CLI dela, que aplica a mesma regra:

```bash
npx vercel dev
```
