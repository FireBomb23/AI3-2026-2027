# Sprint E2-01 - Contrato da API e estrutura do projeto

[Issue #16 no repositório cunhaestgv/AI3-2026-2027](https://github.com/cunhaestgv/AI3-2026-2027/issues/16)

O objetivo é escrever o contrato da API e criar a estrutura do projeto. Deve ser instanciado um servidor Express que expõe todas as rotas de /v1 previstas no contrato (com resposta provisória) e serve a PWA, e o esqueleto da PWA com a estrutura de ficheiros pedida, manifesto e service worker registado.

Nenhuma funcionalidade do Reporta (deteção de duplicados, idempotência, IndexedDB, fila de saída, sincronização, OAuth) é implementada neste sprint.

---

## Objetivos

### 1. Diagnóstico inicial
- Responder em `registo.md`, por palavras do grupo, às questões (a) a (d) da secção 2 do enunciado.

### 2. Contrato OpenAPI (etapa 4.1)
- Escrever `reporta.openapi.yaml`, versão 1.0.0, com os esquemas `Categoria`, `Localizacao`, `Ocorrencia` e `Erro`.
- Especificar as 8 operações da tabela 4.1, com parâmetros, cabeçalhos (`X-Cidadao`, `Idempotency-Key`, `X-Admin-Token`) e todos os códigos de resposta.
- Validar o ficheiro num editor OpenAPI (ex.: https://editor.swagger.io) sem erros.
- Preencher em `registo.md` a tabela de pedidos (Cache-Control, quem faz o pedido, funciona sem rede, pode ser repetido) e responder ao «Antes de avançar» da 4.1.

### 3. Esqueleto do servidor
- Criar `servidor/` com `package.json` e apenas a dependência `express`.
- Criar `servidor.js` que arranca com `node --env-file=.env servidor.js` e serve a pasta `public/`.
- Acrescentar `geo.js` do Anexo, tal como fornecido.
- Criar as 8 rotas do contrato, cada uma a responder `501 Not Implemented` com um corpo no formato `Erro`.
- Criar `.env.exemplo` com `ADMIN_TOKEN`, `SIMULAR_PERDA_RESPOSTA` e `SIMULAR_503` (desligadas por omissão).
- Criar `.gitignore` que exclui `node_modules/` e `.env`.

### 4. Esqueleto da PWA
- Criar em `servidor/public/` a estrutura da 4.3: `index.html`, `manifest.webmanifest`, `icones/`, `estilos.css`, `app.js`, `formulario.js`, `bd.js`, `sincronizacao.js` e `sw.js` (os módulos ainda vazios ou com funções provisórias).
- Escrever o `manifest.webmanifest` com nome, ícones de 192 e 512 px, `display: standalone` e `start_url`.
- Registar o service worker em `app.js`, com `install` e `activate` provisórios (ainda sem estratégia de cache).

---

## Critérios de aceitação

1. `registo.md` contém as respostas ao diagnóstico inicial e a tabela da 4.1 preenchida.
2. `reporta.openapi.yaml` valida sem erros e cobre as 8 operações, os 4 esquemas e todos os códigos de resposta da tabela 4.1.
3. O servidor arranca com `npm install` e `node --env-file=.env servidor.js`, sem outras dependências além de `express`.
4. Cada rota de `/v1` responde `501` com um corpo `Erro`; uma rota inexistente responde `404`.
5. `http://localhost:<porto>/` abre a página e o service worker aparece registado em DevTools → Application.
6. O Chrome reconhece o manifesto sem erros (DevTools → Application → Manifest).
7. `node_modules/` e `.env` não estão no repositório; `.env.exemplo` está.
