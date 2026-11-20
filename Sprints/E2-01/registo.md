# Registo · Reporta (PWA de Gestão de Ocorrências)

**Sprint:** E2-01 · Contrato da API e estrutura do projeto  
**Repositório / Issue:** [#16](https://github.com/cunhaestgv/AI3-2026-2027/issues/16)

---

## 1 · Diagnóstico inicial (Secção 2 do enunciado)

### (a) Ana e Bruno comunicam, sem rede e com dez minutos de diferença, o mesmo buraco. A Ana sincroniza primeiro. O que deve acontecer quando o Bruno sincronizar? E se for a Ana a comunicá-lo duas vezes?

Quando a Ana sincroniza primeiro, ainda não existe nenhuma ocorrência semelhante no servidor; por isso, o servidor cria uma nova ocorrência com `comunicacoes = 1` e responde `201 Created` (`resultado: "criada"`).  
Quando o Bruno sincroniza a seguir, o pedido `POST /v1/ocorrencias` chega ao servidor, que executa a deteção de duplicados (mesma categoria, ocorrência não resolvida e distância $\le$ raio da categoria). Encontrando a ocorrência criada pela Ana, o servidor não cria outra: acrescenta o reforço do Bruno, sobe o contador para `comunicacoes = 2` e responde `200 OK` com `resultado: "reforcada"` e o `Location` da ocorrência existente.

Se for a própria Ana a comunicar duas vezes o mesmo buraco (mesmo cidadão identificado por `X-Cidadao` ou sessão OAuth), o servidor deteta que essa cidadã já comunicou ou reforçou aquela ocorrência, mantém `comunicacoes = 1` (cada pessoa conta apenas uma vez) e responde `200 OK` com `resultado: "ja-comunicada"`.

### (b) O GPS do telemóvel indica uma precisão de 60 m e o raio da categoria `buraco` é 15 m. O que pode correr mal na deteção de duplicados, nos dois sentidos? Como deve a interface reagir?

Com um erro de posicionamento de 60 m (quatro vezes superior ao raio de 15 m), podem ocorrer falhas nos dois sentidos:
- **Falso negativo (duplicado não detetado):** dois cidadãos estão junto ao mesmo buraco, mas as coordenadas obtidas pelo GPS ficam desviadas mais de 15 m entre si. O servidor conclui que são locais distintos e cria duas ocorrências para o mesmo problema.
- **Falso positivo (fusão indevida):** um buraco diferente fica a 30–50 m de distância real, mas o desvio do GPS coloca a nova comunicação dentro do raio de 15 m de uma ocorrência existente, fundindo dois problemas distintos numa só ocorrência.

**Reação da interface:** deve apresentar sempre a precisão devolvida pela Geolocation API e, quando a precisão for pior (maior) do que o raio da categoria selecionada, mostrar um aviso claro ao cidadão. Existindo ligação à rede, deve pedir-lhe que ajuste manualmente o marcador no mapa para a posição exata antes de submeter.

### (c) O Rui comunica um semáforo sem rede. Quando a comunicação chega ao servidor, é fundida na ocorrência 87. O que tem o dispositivo do Rui de fazer ao registo local, que nunca teve um `id` do servidor?

Enquanto está offline, a comunicação existe apenas na loja `pendentes` com uma chave local (`idLocal`), sem identificador do servidor. Quando o service worker recebe a resposta `200 OK` (`resultado: "reforcada"`, ocorrência `87`), executa numa **única transação** em IndexedDB:
1. Remove o registo da fila `pendentes` (pelo `idLocal`);
2. Grava na loja `minhas` o mapeamento entre o `idLocal` e `ocorrenciaId: 87`, registando o `resultado: "reforcada"` e a data de envio;
3. Faz `put` da ocorrência `87` atualizada na loja `ocorrencias`.

Desta forma, o registo local deixa de estar pendente e passa a apontar para a ocorrência `87` já existente, permitindo à interface mostrar «Juntada à n.º 87» e acompanhar futuras mudanças de estado dessa ocorrência.

### (d) Porque não basta o cliente perguntar `GET /v1/ocorrencias/semelhantes` antes de criar? Dê dois exemplos em que essa verificação não evita o duplicado.

A consulta no cliente é apenas uma ajuda para o cidadão, não uma garantia de consistência, porque não vê o estado futuro nem funciona sem rede. Dois exemplos em que falha:
1. **Comunicação sem rede (offline):** dois cidadãos reportam o mesmo problema sem ligação à internet; nenhum deles consegue consultar `/semelhantes`, pelo que ambos gravam uma pendente de criação. Só o servidor, ao receber os pedidos na sincronização, consegue fundir o segundo no primeiro.
2. **Condição de corrida (concorrência):** dois cidadãos com rede consultam `/semelhantes` ao mesmo tempo e ambos recebem uma lista vazia; ambos submetem `POST /v1/ocorrencias` logo de seguida. Sem a verificação autoritativa e síncrona no servidor, nasceriam duas ocorrências duplicadas.

---

## 2 · Estratégia de cache, origem e idempotência (Etapa 4.1)

| Pedido | Cache-Control | Quem o faz (página / SW) | Funciona sem rede? | Pode ser repetido sem efeitos adicionais? |
|---|---|---|---|---|
| `GET /v1/categorias` | `public, max-age=86400` | Página (com cópia local na loja `meta` em IndexedDB) | Sim (lê as categorias guardadas em IndexedDB / `meta`; a rede só atualiza) | Sim (leitura segura e idempotente) |
| `GET /v1/ocorrencias/semelhantes` | `no-store` | Página (antes de gravar pendente) | Não (se falhar ou exceder 3 s, a página grava diretamente na fila `pendentes`) | Sim (leitura segura e idempotente) |
| `GET /v1/ocorrencias?bbox=` | `no-cache` (ou `no-store`) | Página (para o mapa) | Não (a app continua a funcionar mostrando a lista local de IndexedDB) | Sim (leitura segura e idempotente) |
| `POST /v1/ocorrencias` sem `Idempotency-Key` | `no-store` | Não usado pela PWA (apenas via cliente externo / testes) | Não | Não (sem chave, uma repetição pode criar duplicado ou devolver `ja-comunicada` apenas por acaso, falhando se houver alterações concorrentes) |
| `POST /v1/ocorrencias` com `Idempotency-Key` | `no-store` | Service Worker (`executarSincronizacao`) | O pedido HTTP não; a operação na PWA sim (fica na fila `pendentes` e o SW envia quando houver rede) | Sim (com a mesma chave e o mesmo corpo, o servidor devolve a resposta guardada com `Idempotent-Replayed: true`, sem repetir o efeito) |
| `POST /v1/ocorrencias/{id}/reforcos` com `Idempotency-Key` | `no-store` | Service Worker (`executarSincronizacao`) | O pedido HTTP não; a operação na PWA sim (fica na fila `pendentes` e o SW envia quando houver rede) | Sim (a chave de idempotência garante que a repetição devolve a resposta original sem voltar a incrementar) |
| `GET /v1/ocorrencias/alteracoes` | `private, no-store` | Service Worker (`executarSincronizacao`, após esvaziar a fila) | Não (só sincroniza quando há rede; offline a interface lê da loja `ocorrencias`) | Sim (leitura segura e idempotente para o mesmo `desde`) |

---

## 3 · Antes de avançar (Etapa 4.1)

### Que identifica o cidadão em cada pedido protegido, com e sem OAuth?
- **Sem OAuth (modo obrigatório):** um UUID gerado no dispositivo na primeira utilização, guardado na loja `meta` do IndexedDB e enviado em cada pedido protegido no cabeçalho HTTP `X-Cidadao`.
- **Com OAuth (opcional):** um cookie de sessão `HttpOnly; Secure; SameSite=Lax` emitido pelo servidor Express (backend-for-frontend) após trocar o código de autorização junto do fornecedor OAuth. O browser envia o cookie automaticamente e o token do fornecedor nunca é exposto ao cliente.

### Pode uma resposta de `GET /v1/ocorrencias/semelhantes` ser servida da Cache API? Porquê?
**Não.** Primeiro, porque o contrato e o modelo offline-first do Reporta proíbem colocar qualquer resposta da API `/v1/` na Cache API (a Cache API serve apenas os ficheiros estáticos da interface). Segundo, porque os dados de ocorrências semelhantes mudam constantemente (novos problemas comunicados, contadores atualizados ou ocorrências entretanto resolvidas): servir uma resposta em cache levaria o cidadão a reforçar ocorrências já resolvidas ou a não ver ocorrências recém-criadas por outros utilizadores.
