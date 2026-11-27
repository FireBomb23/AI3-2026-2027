# Registo · Reporta (PWA de Gestão de Ocorrências)

**Sprint:** E2-02 · Servidor: API, deteção de duplicados e idempotência  
**Repositório / Issue:** [#17](https://github.com/cunhaestgv/AI3-2026-2027/issues/17)

---

## 1 · Justificação dos Raios das Categorias (`GET /v1/categorias`)

O grupo optou por manter os raios de referência definidos no contrato e no enunciado, por se adequarem com rigor à realidade física e à dispersão típica do GPS em dispositivos móveis:

| Categoria | Raio | Justificação |
|---|---|---|
| `buraco` | 15 m | Um buraco no pavimento é pontual. 15 metros cobrem a largura típica de uma via com passeios e a incerteza do GPS móvel em céu aberto, sem fundir indevidamente dois buracos distintos na mesma rua. |
| `semaforo` | 40 m | Um cruzamento ou entroncamento com semáforos tem postes em vários cantos a distâncias de 20 a 35 metros entre si. 40 metros garantem que qualquer poste do mesmo cruzamento funde na mesma ocorrência. |
| `iluminacao` | 20 m | A distância padrão entre postes consecutivos de iluminação pública urbana é de cerca de 25 a 30 metros. Um raio de 20 m isola cada poste individual, prevenindo a fusão errónea de candeeiros vizinhos. |
| `sinalizacao` | 20 m | Acomoda a dispersão de aproximação ao sinal de trânsito e assegura que sinais verticais próximos não sejam fundidos se pertencerem a sentidos opostos. |
| `outro` | 10 m | Sendo uma categoria genérica sem topologia pré-definida, exige maior proximidade física para evitar falsos positivos de fusão. |

---

## 2 · Antes de avançar (Etapa 4.2)

### (a) Porque não pode haver nenhum `await` entre a chamada a `procurarSemelhantes()` e a escrita da ocorrência / reforço?

O Node.js executa JavaScript num modelo cooperativo *single-threaded* assente no *event loop*. Uma sequência síncrona de instruções (procurar no `Map` em memória, avaliar semelhança e escrever a nova ocorrência ou atualizar o contador) é atómica: nenhum outro pedido HTTP pode intercalar a sua execução durante esse bloco de código.  
Se existisse um `await` entre a leitura/procura e a gravação (por exemplo, aguardando um temporizador ou uma operação assíncrona desnecessária), o controlo seria devolvido ao *event loop*. Nesse intervalo, um segundo pedido de outro cidadão com localização próxima poderia ser processado, não encontrando ainda a ocorrência no `Map`, o que resultaria na criação de duas ocorrências duplicadas para o mesmo problema (condição de corrida / *race condition*).

### (b) Por que razão a resposta guardada para idempotência (`Idempotency-Key`) só deve ser registada após o pedido ter sucesso (2xx) e ser guardada durante 24 horas por cidadão?

1. **Apenas em 2xx (sucesso):** Se registássemos a chave antes de executar ou em respostas de erro transitório (como `503 Service Unavailable`, quebra de rede com `SIMULAR_PERDA_RESPOSTA=1` ou falha de infraestrutura), qualquer repetição legítima da PWA (via *backoff* ou sincronização de saída) ficaria condenada a receber perpetuamente o erro gravado ou um conflito indevido, sem que a ocorrência tivesse alguma vez sido criada. Guardar exclusivamente após sucesso garante que a repetição reproduz o resultado da operação que efetivamente se concretizou.
2. **24 horas por cidadão:** O ciclo de vida da fila de pendentes em dispositivos móveis cobre períodos razoáveis em que o utilizador está offline (viagens, zonas sem cobertura, noite). Guardar a chave por 24 horas oferece janela suficiente para descarregar a fila sem risco de duplicados, limitando em simultâneo a memória consumida pelo servidor, que liberta os registos obsoletos.

### (c) Como é assegurada a consistência dos dados com estruturas em memória e persistência em ficheiro JSON sem SGBD?

O estado autoritativo reside em estruturas nativas em memória (`Map` de ocorrências e `Map` de fotografias), acessíveis em tempo constante $O(1)$ por identificador. Após qualquer mutação de estado (criação de nova ocorrência, reforço de contadores, ou mudança de estado administrativo via `PATCH`), o servidor invoca sincronamente `fs.writeFileSync` para serializar o estado completo num ficheiro `dados.json`.  
No arranque, a função `carregarDados()` verifica a existência de `dados.json` e repõe as estruturas e o cursor `contadorVersao`. Desta forma, o servidor recupera o estado exato após qualquer reinício sem recorrer a bases de dados externas nem dependências adicionais além do `express`.

---

## 3 · Evidências dos Critérios de Aceitação (Comandos `curl` e Respostas)

O servidor foi executado com:
```bash
node --env-file=.env servidor.js
```

### Critério 1 · Nenhuma rota de `/v1` responde 501; respostas seguem `reporta.openapi.yaml` e 404 em rotas inexistentes

**Comando:**
```bash
curl -i http://localhost:3000/v1/rota-inexistente
```
**Resposta:**
```http
HTTP/1.1 404 Not Found
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{"erro":"Recurso não encontrado: GET /v1/rota-inexistente","codigo":"NAO_ENCONTRADO"}
```

---

### Critério 2 · `GET /v1/categorias` devolve as 5 categorias com os raios e `Cache-Control` público

**Comando:**
```bash
curl -i http://localhost:3000/v1/categorias
```
**Resposta:**
```http
HTTP/1.1 200 OK
Cache-Control: public, max-age=86400
Content-Type: application/json; charset=utf-8

[
  {"codigo":"buraco","nome":"Buraco na via","exemplos":"buraco, abatimento do pavimento, tampa de esgoto solta","raio":15},
  {"codigo":"semaforo","nome":"Semáforo avariado","exemplos":"semáforo apagado, intermitente ou fora de tempo","raio":40},
  {"codigo":"iluminacao","nome":"Iluminação pública","exemplos":"candeeiro apagado ou intermitente","raio":20},
  {"codigo":"sinalizacao","nome":"Sinalização de trânsito","exemplos":"sinal caído, rodado ou ilegível","raio":20},
  {"codigo":"outro","nome":"Outro problema","exemplos":"qualquer outro problema na via pública","raio":10}
]
```

---

### Critério 3 · Dois cidadãos diferentes a comunicar um buraco a menos de 15 m: 1º recebe 201 e 2º recebe 200 `reforcada` com `comunicacoes = 2`

**1. Cidadão A cria buraco:**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 11111111-1111-4111-8111-111111111111" \
  -H "Idempotency-Key: c1111111-1111-4111-8111-111111111111" \
  -d '{"categoria":"buraco","descricao":"Buraco profundo junto ao passeio em frente ao n 24","localizacao":{"lat":40.65700,"lng":-7.91400,"precisao":5}}'
```
**Resposta:**
```http
HTTP/1.1 201 Created
Location: /v1/ocorrencias/a9171a8f-ada6-4596-86ed-a8a791a1ea5a
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{
  "resultado": "criada",
  "ocorrencia": {
    "id": "a9171a8f-ada6-4596-86ed-a8a791a1ea5a",
    "categoria": "buraco",
    "descricao": "Buraco profundo junto ao passeio em frente ao n 24",
    "localizacao": {"lat":40.657,"lng":-7.914,"precisao":5},
    "temFotografia": false,
    "estado": "aberta",
    "comunicacoes": 1,
    "criadaEm": "2026-11-26T14:59:40.468Z",
    "atualizadaEm": "2026-11-26T14:59:40.468Z",
    "versao": 1
  }
}
```

**2. Cidadão B comunica buraco a ~9 m de distância (lat 40.65708):**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 22222222-2222-4222-8222-222222222222" \
  -d '{"categoria":"buraco","descricao":"Buraco na estrada visto por outro cidadao","localizacao":{"lat":40.65708,"lng":-7.91400,"precisao":4}}'
```
**Resposta:**
```http
HTTP/1.1 200 OK
Location: /v1/ocorrencias/a9171a8f-ada6-4596-86ed-a8a791a1ea5a
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{
  "resultado": "reforcada",
  "ocorrencia": {
    "id": "a9171a8f-ada6-4596-86ed-a8a791a1ea5a",
    "categoria": "buraco",
    "descricao": "Buraco profundo junto ao passeio em frente ao n 24",
    "localizacao": {"lat":40.657,"lng":-7.914,"precisao":5},
    "temFotografia": false,
    "estado": "aberta",
    "comunicacoes": 2,
    "criadaEm": "2026-11-26T14:59:40.468Z",
    "atualizadaEm": "2026-11-26T14:59:40.610Z",
    "versao": 2
  }
}
```

---

### Critério 4 · O mesmo cidadão a repetir a comunicação recebe 200 `ja-comunicada` e o contador não sobe

**Comando (Cidadão A repete comunicação para o mesmo buraco):**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 11111111-1111-4111-8111-111111111111" \
  -d '{"categoria":"buraco","descricao":"Buraco comunicado novamente pelo cidadao A","localizacao":{"lat":40.65704,"lng":-7.91400}}'
```
**Resposta:**
```http
HTTP/1.1 200 OK
Location: /v1/ocorrencias/a9171a8f-ada6-4596-86ed-a8a791a1ea5a
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{
  "resultado": "ja-comunicada",
  "ocorrencia": {
    "id": "a9171a8f-ada6-4596-86ed-a8a791a1ea5a",
    "categoria": "buraco",
    "descricao": "Buraco profundo junto ao passeio em frente ao n 24",
    "localizacao": {"lat":40.657,"lng":-7.914,"precisao":5},
    "temFotografia": false,
    "estado": "aberta",
    "comunicacoes": 2,
    "criadaEm": "2026-11-26T14:59:40.468Z",
    "atualizadaEm": "2026-11-26T14:59:40.610Z",
    "versao": 2
  }
}
```

---

### Critério 5 · Categoria diferente, distância acima do raio ou ocorrência resolvida dão origem a ocorrência nova (201)

**1. Categoria diferente (`iluminacao`) no mesmo local:**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 33333333-3333-4333-8333-333333333333" \
  -d '{"categoria":"iluminacao","descricao":"Poste de iluminacao sem lampada no mesmo local","localizacao":{"lat":40.65700,"lng":-7.91400}}'
```
**Resposta:**
```http
HTTP/1.1 201 Created
Location: /v1/ocorrencias/5f48de6a-5c50-4339-b0f9-2765ff9d6992
Cache-Control: no-store

{"resultado":"criada","ocorrencia":{"id":"5f48de6a-5c50-4339-b0f9-2765ff9d6992","categoria":"iluminacao","comunicacoes":1,...}}
```

**2. Mesma categoria (`buraco`) mas a > 15 m (lat 40.65730 -> ~33 m):**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 33333333-3333-4333-8333-333333333333" \
  -d '{"categoria":"buraco","descricao":"Outro buraco mais a frente a mais de 30 metros","localizacao":{"lat":40.65730,"lng":-7.91400}}'
```
**Resposta:**
```http
HTTP/1.1 201 Created
Location: /v1/ocorrencias/05b8f168-ca5e-4e33-8a5c-7d40c4397f7d
Cache-Control: no-store

{"resultado":"criada","ocorrencia":{"id":"05b8f168-ca5e-4e33-8a5c-7d40c4397f7d","categoria":"buraco","comunicacoes":1,...}}
```

**3. Nova ocorrência no mesmo local onde a anterior já se encontra `resolvida`:**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 33333333-3333-4333-8333-333333333333" \
  -d '{"categoria":"buraco","descricao":"Novo buraco no mesmo sitio apos conclusao da obra anterior","localizacao":{"lat":40.65700,"lng":-7.91400}}'
```
**Resposta:**
```http
HTTP/1.1 201 Created
Location: /v1/ocorrencias/0e3019b3-a3e0-46a3-848f-b70cede93f4d
Cache-Control: no-store

{"resultado":"criada","ocorrencia":{"id":"0e3019b3-a3e0-46a3-848f-b70cede93f4d","categoria":"buraco","comunicacoes":1,...}}
```

---

### Critério 6 · Descrição com menos de 10 caracteres ou fotografia acima de 300 KB são recusadas com 400

**1. Descrição com menos de 10 caracteres:**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 11111111-1111-4111-8111-111111111111" \
  -d '{"categoria":"buraco","descricao":"Curto","localizacao":{"lat":40.657,"lng":-7.914}}'
```
**Resposta:**
```http
HTTP/1.1 400 Bad Request
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{"erro":"A descrição deve ter entre 10 e 500 caracteres.","codigo":"PEDIDO_INVALIDO"}
```

**2. Fotografia acima de 300 KB:**
```bash
# Envio de payload com JPEG base64 superior a 300 KB
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 11111111-1111-4111-8111-111111111111" \
  -d '{"categoria":"buraco","descricao":"Buraco com imagem demasiado grande","localizacao":{"lat":40.657,"lng":-7.914},"fotografia":"data:image/jpeg;base64,..."}'
```
**Resposta:**
```http
HTTP/1.1 400 Bad Request
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{"erro":"A fotografia excede o limite máximo de 300 KB.","codigo":"PEDIDO_INVALIDO"}
```

---

### Critério 7 · Repetir POST com mesma `Idempotency-Key` e mesmo corpo devolve `Idempotent-Replayed: true`; corpo diferente devolve 409

**1. Repetição com a mesma chave e mesmo corpo:**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 11111111-1111-4111-8111-111111111111" \
  -H "Idempotency-Key: c1111111-1111-4111-8111-111111111111" \
  -d '{"categoria":"buraco","descricao":"Buraco profundo junto ao passeio em frente ao n 24","localizacao":{"lat":40.65700,"lng":-7.91400,"precisao":5}}'
```
**Resposta:**
```http
HTTP/1.1 201 Created
Cache-Control: no-store
Idempotent-Replayed: true
Location: /v1/ocorrencias/a9171a8f-ada6-4596-86ed-a8a791a1ea5a
Content-Type: application/json; charset=utf-8

{"resultado":"criada","ocorrencia":{"id":"a9171a8f-ada6-4596-86ed-a8a791a1ea5a","comunicacoes":1,...}}
```

**2. Mesma chave com corpo diferente:**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 11111111-1111-4111-8111-111111111111" \
  -H "Idempotency-Key: c1111111-1111-4111-8111-111111111111" \
  -d '{"categoria":"buraco","descricao":"Outra descricao qualquer com corpo modificado","localizacao":{"lat":40.65700,"lng":-7.91400}}'
```
**Resposta:**
```http
HTTP/1.1 409 Conflict
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{"erro":"Idempotency-Key já utilizada anteriormente com corpo diferente.","codigo":"CONFLITO_IDEMPOTENCIA"}
```

---

### Critério 8 · Com `SIMULAR_PERDA_RESPOSTA=1`, o 1º POST fica sem resposta e a repetição devolve o resultado sem duplicar

**Arranque com:**
```env
SIMULAR_PERDA_RESPOSTA=1
```

**1. 1º Envio (servidor executa, grava e fecha socket):**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 44444444-4444-4444-8444-444444444444" \
  -H "Idempotency-Key: 55555555-5555-4555-8555-555555555555" \
  -d '{"categoria":"semaforo","descricao":"Semáforo intermitente no cruzamento da avenida principal","localizacao":{"lat":40.658,"lng":-7.915,"precisao":5}}'
```
**Resultado no cliente:**
`curl: (52) Empty reply from server` (Ligação fechada pelo servidor antes de enviar resposta)

**2. Repetição com a mesma chave e mesmo corpo:**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias \
  -H "Content-Type: application/json" \
  -H "X-Cidadao: 44444444-4444-4444-8444-444444444444" \
  -H "Idempotency-Key: 55555555-5555-4555-8555-555555555555" \
  -d '{"categoria":"semaforo","descricao":"Semáforo intermitente no cruzamento da avenida principal","localizacao":{"lat":40.658,"lng":-7.915,"precisao":5}}'
```
**Resposta:**
```http
HTTP/1.1 201 Created
Cache-Control: no-store
Idempotent-Replayed: true
Location: /v1/ocorrencias/0523ec33-b1d5-4573-90d0-fbda32ab95c8
Content-Type: application/json; charset=utf-8

{"resultado":"criada","ocorrencia":{"id":"0523ec33-b1d5-4573-90d0-fbda32ab95c8","categoria":"semaforo","comunicacoes":1,...}}
```
*Total de ocorrências criadas no servidor: 1 (sem duplicação).*

---

### Critério 9 · Com `SIMULAR_503` ativo, a resposta é 503 com `Retry-After: 2`

**Arranque com:**
```env
SIMULAR_503=1
```

**Comando:**
```bash
curl -i http://localhost:3000/v1/categorias
```
**Resposta:**
```http
HTTP/1.1 503 Service Unavailable
Retry-After: 2
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{"erro":"Serviço temporariamente indisponível.","codigo":"SERVICO_INDISPONIVEL"}
```

---

### Critério 10 · `PATCH` admin para resolvida: surge em `alteracoes?desde=` do autor, não de outros, e reforço dá 410

**1. PATCH pelo administrador com `X-Admin-Token`:**
```bash
curl -i -X PATCH http://localhost:3000/v1/admin/ocorrencias/a9171a8f-ada6-4596-86ed-a8a791a1ea5a \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: token-admin-reporta" \
  -d '{"estado":"resolvida"}'
```
**Resposta:**
```http
HTTP/1.1 200 OK
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{"id":"a9171a8f-ada6-4596-86ed-a8a791a1ea5a","categoria":"buraco","estado":"resolvida","versao":5,...}
```

**2. Consulta de alterações pelo Cidadão A (`alteracoes?desde=0`):**
```bash
curl -i http://localhost:3000/v1/ocorrencias/alteracoes?desde=0 \
  -H "X-Cidadao: 11111111-1111-4111-8111-111111111111"
```
**Resposta:**
```http
HTTP/1.1 200 OK
Cache-Control: private, no-store
Content-Type: application/json; charset=utf-8

{"alteracoes":[{"id":"a9171a8f-ada6-4596-86ed-a8a791a1ea5a","estado":"resolvida","versao":5,...}],"cursor":5}
```
*(Aparece a ocorrência com estado resolvida).*

**3. Consulta de alterações pelo Cidadão C (`alteracoes?desde=0` - não comunicou o buraco):**
```bash
curl -i http://localhost:3000/v1/ocorrencias/alteracoes?desde=0 \
  -H "X-Cidadao: 33333333-3333-4333-8333-333333333333"
```
**Resposta:**
```http
HTTP/1.1 200 OK
Cache-Control: private, no-store
Content-Type: application/json; charset=utf-8

{"alteracoes":[{"id":"5f48de6a-5c50-4339-b0f9-2765ff9d6992",...},{"id":"05b8f168-ca5e-4e33-8a5c-7d40c4397f7d",...}],"cursor":5}
```
*(Não contém o buraco `a9171a8f...` do Cidadão A).*

**4. Reforço direto `POST /v1/ocorrencias/{id}/reforcos` na ocorrência resolvida:**
```bash
curl -i -X POST http://localhost:3000/v1/ocorrencias/a9171a8f-ada6-4596-86ed-a8a791a1ea5a/reforcos \
  -H "X-Cidadao: 33333333-3333-4333-8333-333333333333"
```
**Resposta:**
```http
HTTP/1.1 410 Gone
Cache-Control: no-store
Content-Type: application/json; charset=utf-8

{"erro":"A ocorrência já se encontra resolvida e não pode ser reforçada.","codigo":"OCORRENCIA_RESOLVIDA"}
```

---

### Critério 11 · Sobrevivência a reinício via ficheiro JSON sem BD instalada (`express` única dependência)

1. Uma ocorrência criada gera registo imediato em `dados.json`.
2. O processo Node.js é terminado (`SIGINT` ou `kill`).
3. O servidor arranca novamente (`node --env-file=.env servidor.js`).
4. Um pedido `GET /v1/ocorrencias?bbox=-7.92,40.65,-7.90,40.67` devolve com sucesso a ocorrência persistida com todas as propriedades, o cursor `versao` e fotografias preservadas.
5. O `package.json` possui unicamente `"dependencies": { "express": "^4.21.2" }`.
