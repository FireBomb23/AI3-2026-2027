# Trabalho prático · PWA de gestão de ocorrências

Neste trabalho, cada grupo desenvolve a aplicação Reporta, uma PWA com a qual qualquer cidadão comunica um problema na via pública (um buraco na estrada, um semáforo avariado, um candeeiro apagado) com fotografia e localização. A aplicação funciona com e sem ligação, sincroniza sem perder nem duplicar dados e, antes de criar uma ocorrência, consulta a API para verificar se o mesmo problema já foi comunicado. Nesse caso, reforça a ocorrência existente, somando uma comunicação, em vez de criar outra. A autenticação com OAuth é opcional, mas valorizada.

**Tags:** PWA · Offline-first · Service Worker · Cache API · IndexedDB · Fila de saída · Background Sync · Idempotency-Key · Geolocalização · Deteção de duplicados · Reforço de ocorrências · Cursor de sincronização · OAuth 2.0 + PKCE · OpenAPI · Express

---

## Enquadramento

### O problema
Um buraco numa avenida movimentada é visto por centenas de pessoas. Hoje, quem o quer comunicar telefona, envia um e-mail ou preenche um formulário, e cada comunicação chega aos serviços municipais como um novo pedido. Esta forma de trabalhar tem três fragilidades:
1. **Sem rede, não há comunicação.** O cidadão vê um semáforo apagado numa estrada sem cobertura. Quando chega a casa, já se esqueceu.
2. **O mesmo problema chega dezenas de vezes.** Cada cópia tem de ser lida, localizada e fundida à mão por alguém nos serviços.
3. **Não há medida de urgência.** Nada distingue um buraco visto por uma pessoa de um buraco que trinta pessoas se deram ao trabalho de comunicar.

| Aspeto | Formulário tradicional | Reporta |
|---|---|---|
| Sem ligação | não é possível comunicar | a comunicação fica no dispositivo e é enviada quando houver rede, mesmo com o separador fechado |
| Mesmo problema comunicado duas vezes | duas ocorrências | uma ocorrência com comunicacoes = 2 |
| Resposta perdida e pedido repetido | duas ocorrências | o servidor reconhece a Idempotency-Key e devolve a mesma resposta |
| Mesma pessoa comunica duas vezes o mesmo problema | duas ocorrências | o contador não sobe: cada cidadão conta uma vez |
| Estado da ocorrência | o cidadão não sabe o que aconteceu | o estado (aberta, em-resolucao, resolvida) chega ao dispositivo na sincronização |
| Localização | morada escrita à mão | coordenadas da Geolocation API, com a precisão indicada |

---

## Arquitetura
A aplicação tem três partes: a PWA no dispositivo do cidadão, um servidor Express com a API /v1 e, opcionalmente, um fornecedor OAuth. A página nunca comunica diretamente com o servidor para gravar. O armazenamento é assegurado pelo IndexedDB e o service worker sincroniza.

1. A página grava a comunicação em IndexedDB, na loja `pendentes`, e mostra-a como «Por enviar».
2. A página pede a sincronização ao service worker: evento `sync` (Chromium) ou `postMessage` (plano B).
3. Quando há rede, o service worker lê a fila de saída.
4. Envia cada pendente com a sua `Idempotency-Key`.
5. O servidor procura semelhantes e responde se a comunicação foi criada, reforçada ou já tinha sido comunicada.
6. Com a fila vazia, o service worker pede o que mudou no servidor desde o último cursor.
7. Confirma as pendentes enviadas e aplica as alterações recebidas, numa única transação.
8. Avisa as páginas abertas, que atualizam a lista sem recarregar.

---

## Offline-first
Numa aplicação offline-first, a interface lê e escreve sempre no dispositivo, e a rede serve apenas para sincronizar. Comunicar um buraco, por exemplo, representa um add em IndexedDB. A lista mostra-o de imediato como «Por enviar».

| Peça | O que faz | Onde fica no Reporta |
|---|---|---|
| Interface em cache | a aplicação abre sem rede | Cache API, pré-carregada no install do service worker |
| Ler local | a lista e o mapa mostram o que está em IndexedDB | loja `ocorrencias` |
| Escrever local | comunicar é gravar; a interface é otimista | loja `pendentes` |
| Fila de saída | cada comunicação espera pela rede, pela ordem em que foi feita | `pendentes`, chave `idLocal` com `autoIncrement` |
| Sincronizar | enviar a fila e trazer o que mudou no servidor | `executarSincronizacao()`, no service worker |
| Fundir duplicados | decidir se uma comunicação é nova ou reforça uma existente | no servidor, sempre; no cliente, quando há rede |
| Mostrar o estado | o cidadão sabe o que ainda não chegou e o que foi fundido | «Por enviar», «Criada», «Juntada à n.º 87», «Erro» |

Regra fundamental: uma comunicação só sai da fila depois de o servidor responder 2xx. Uma falha de rede ou um 5xx nunca apaga uma pendente; um 4xx também não, mas marca-a com erro para que não volte a ser enviada.

---

## A mesma ocorrência: reforçar em vez de duplicar
Duas comunicações referem-se à mesma ocorrência quando:
1. Têm a mesma categoria;
2. A ocorrência existente não está resolvida;
3. A distância entre os dois pontos é menor ou igual ao raio da categoria.

Nesse caso, a segunda comunicação não cria uma ocorrência: acrescenta um reforço à existente e o contador comunicacoes sobe uma unidade.

| Categoria | Exemplos | Raio inicial |
|---|---|---|
| buraco | buraco, abatimento do pavimento, tampa de esgoto solta | 15 m |
| semaforo | semáforo apagado, intermitente ou fora de tempo | 40 m (um cruzamento) |
| iluminacao | candeeiro apagado ou intermitente | 20 m |
| sinalizacao | sinal caído, rodado ou ilegível | 20 m |
| outro | qualquer outro problema na via pública | 10 m |

### Respostas de `POST /v1/ocorrencias`:
- `201`, Location: `/v1/ocorrencias/112` → `{ "resultado": "criada", "ocorrencia": {...} }`
- `200`, Location: `/v1/ocorrencias/87` → `{ "resultado": "reforcada", "ocorrencia": {..., "comunicacoes": 6} }`
- `200`, Location: `/v1/ocorrencias/87` → `{ "resultado": "ja-comunicada", "ocorrencia": {..., "comunicacoes": 5} }`

---

## Sincronizar sem perder nem duplicar
- UUID por pendente gerado na criação e enviado no cabeçalho `Idempotency-Key`.
- Push seguido de pull (`GET /v1/ocorrencias/alteracoes?desde=<cursor>`). O cursor é o campo `versao`, um inteiro do servidor.
- Backoff exponencial com aleatoriedade no plano B.

---

## Identidade: Identificador do dispositivo vs OAuth
| Aspeto | Identificador do dispositivo (obrigatório) | OAuth 2.0 (opcional, valorizado) |
|---|---|---|
| Como se obtém | UUID gerado na primeira utilização e guardado na loja `meta` | Authorization Code com PKCE |
| Como chega ao servidor | cabeçalho `X-Cidadao` | cookie de sessão HttpOnly |
| Uma pessoa, dois dispositivos | conta duas vezes | conta uma vez |
| Apagar os dados do browser | passa a ser outra pessoa | volta a entrar e mantém o histórico |

---

## 1 · Objetivos
- PWA instalável com manifesto e service worker offline-first.
- Contrato OpenAPI e API REST Express.
- Deteção de duplicados (cliente e servidor).
- Idempotência com `Idempotency-Key` e backoff com jitter.
- Sincronização nos dois sentidos com cursor e fusão de ocorrências.
- (Valorizado) OAuth 2.0 com PKCE.

---

## 2 · Âmbito e pré-requisitos
- **Servidor:** apenas `express` e opcionalmente `jsonwebtoken`. IDs via `crypto.randomUUID()`, `fetch` nativo do Node.
- **Cliente:** sem bibliotecas. Única exceção: Leaflet com mosaicos OpenStreetMap.
- Proibidos: Workbox, idb, Dexie, localForage, Passport, etc.
- Dados em memória com cópia num ficheiro JSON.

### Diagnóstico inicial:
(a) A Ana e o Bruno comunicam, sem rede e com dez minutos de diferença, o mesmo buraco. A Ana sincroniza primeiro. O que deve acontecer quando o Bruno sincronizar? E se for a Ana a comunicá-lo duas vezes?  
(b) O GPS do telemóvel indica uma precisão de 60 m e o raio da categoria buraco é 15 m. O que pode correr mal na deteção de duplicados, nos dois sentidos? Como deve a interface reagir?  
(c) O Rui comunica um semáforo sem rede. Quando a comunicação chega ao servidor, é fundida na ocorrência 87. O que tem o dispositivo do Rui de fazer ao registo local, que nunca teve um id do servidor?  
(d) Porque não basta o cliente perguntar GET /v1/ocorrencias/semelhantes antes de criar? Dê dois exemplos em que essa verificação não evita o duplicado.

---

## 3 · Critérios de aceitação
- **CA1 · PWA e funcionamento sem ligação** (3,5)
- **CA2 · Deteção de duplicados e reforço** (5,0)
- **CA3 · Fila de saída, idempotência e falhas** (4,5)
- **CA4 · Sincronização nos dois sentidos** (3,5)
- **CA5 · Autenticação OAuth (valorizado)** (+2,0)
- Contrato OpenAPI, testes e registo.md (2,0)
- Interface (1,5)

---

## 4 · Etapas
- 4.1 · Contrato e estratégia
- 4.2 · Servidor
- 4.3 · IndexedDB
- 4.4 · Service worker e manifesto
- 4.5 · Página
- 4.6 · Autenticação OAuth (opcional)
- 4.7 · Verificação (testes curl T1-T7 e cenários a-j)
- 4.8 · Reflexão

---

## Anexo · Código de apoio

### `servidor/geo.js`:
```javascript
function distanciaEmMetros(a, b) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

module.exports = { distanciaEmMetros };
```

### `app.js` (tempo de espera com aleatoriedade):
```javascript
function tempoDeEspera(falhas) {
  const segundos = [1, 2, 4, 8, 16, 32, 60];
  const base = segundos[Math.min(falhas, segundos.length) - 1];
  const variacao = 0.7 + Math.random() * 0.6; // entre 70 % e 130 % do valor base
  return Math.round(base * variacao * 1000);
}
```
