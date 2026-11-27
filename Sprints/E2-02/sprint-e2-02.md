# Sprint E2-02 · Servidor: API, deteção de duplicados e idempotência

[Issue #17 no repositório cunhaestgv/AI3-2026-2027](https://github.com/cunhaestgv/AI3-2026-2027/issues/17)

Este sprint implementa o servidor do Reporta. As 8 rotas `/v1`, que no sprint anterior respondiam `501`, passam a cumprir o contrato `reporta.openapi.yaml`. As operações principais incluem: criar e reforçar ocorrências com deteção de duplicados, servir as leituras para o mapa e para as candidatas, expor as alterações com cursor e aceitar a mudança de estado pelo administrador. Os pedidos de criação e reforço tornam-se idempotentes com `Idempotency-Key`.

**Neste sprint não é preciso configurar nenhuma base de dados.** No servidor, os dados ficam em memória, com uma cópia num ficheiro JSON. No cliente, a base de dados IndexedDB `reporta-bd` e o `bd.js` serão criadas no sprint seguinte. A PWA não é alterada.

[Ilustração](https://github.com/user-attachments/files/35084613/Sprint.E2-02.Servidor.Reporta_.duplicados.e.idempotencia.html)

## Objetivos

1. **Dados em memória, categorias e identidade**
   - Guardar as ocorrências em estruturas em memória (por exemplo, um `Map`), com cópia num ficheiro JSON lido no arranque e excluído pelo `.gitignore`. Não usar base de dados nem acrescentar dependências para persistência
   - Gerar os IDs com `crypto.randomUUID()`; manter `express` como única dependência
   - Implementar `GET /v1/categorias` com as cinco categorias e os respetivos raios; se o grupo alterar algum raio, justificar em `registo.md`
   - Identificar o cidadão pelo cabeçalho `X-Cidadao` (UUID) e recusar pedidos sem cabeçalho válido, conforme o contrato
   - Todas as respostas de erro usam o esquema `Erro`
2. **Criar e reforçar (deteção de duplicados)**
   - Escrever a função pura `procurarSemelhantes(categoria, localizacao, excluir)`, com `distanciaEmMetros` de `geo.js`: mesma categoria, ocorrência não `resolvida` e distância menor ou igual ao raio da categoria
   - `POST /v1/ocorrencias`: validar o corpo (categoria, descrição de 10 a 500 caracteres, localização) e responder `400` se for inválido
   - Sem semelhante, criar e responder `201` com `comunicacoes = 1`; com semelhante, responder `200` `reforcada` e somar uma unidade a `comunicacoes`; se o mesmo cidadão já a tiver comunicado, responder `200` `ja-comunicada` sem alterar o contador
   - Tratar o campo opcional `recusadas`, passando-o a `procurarSemelhantes` como `excluir`
   - Não usar `await` entre a procura e a escrita
   - `POST /v1/ocorrencias/{id}/reforcos`: reforço direto, com `404` se não existir e `410` se estiver resolvida
   - Guardar a fotografia à parte, como data URL JPEG até 300 KB; acima disso, `400`
3. **Leituras**
   - `GET /v1/ocorrencias/semelhantes`: até 5 candidatas, ordenadas por distância
   - `GET /v1/ocorrencias?bbox=`: ocorrências não resolvidas dentro da caixa
   - `GET /v1/ocorrencias/{id}/fotografia`: devolve `image/jpeg`, ou `404` se não houver fotografia
   - Enviar em cada resposta o `Cache-Control` decidido na tabela da 4.1 em `registo.md`
4. **Versão, alterações e administração**
   - Manter um contador `versao` no servidor, atribuído à ocorrência em cada criação, reforço ou mudança de estado, juntamente com `atualizadaEm`
   - `GET /v1/ocorrencias/alteracoes?desde=`: devolver só as ocorrências comunicadas ou reforçadas pelo cidadão com `versao` posterior a `desde`, e o `cursor` a usar no pedido seguinte
   - `PATCH /v1/admin/ocorrencias/{id}`: mudar o estado, exigindo `X-Admin-Token` igual a `ADMIN_TOKEN`
5. **Idempotência**
   - Aceitar `Idempotency-Key` nos dois `POST`; chave que não seja UUID dá `400`
   - Guardar por cidadão, durante 24 h, a chave com o corpo e a resposta, e só depois de o pedido ter sucesso
   - Mesma chave e mesmo corpo: devolver a resposta guardada com `Idempotent-Replayed: true`, sem voltar a executar
   - A mesma chave e corpo diferente: `409`
6. **Simulação de falhas**
   - `SIMULAR_PERDA_RESPOSTA=1`: fechar a ligação na primeira resposta bem-sucedida, depois de o pedido ter sido executado e guardado
   - `SIMULAR_503=<n>`: responder `503` com `Retry-After: 2`, conforme o enunciado
   - Com as duas variáveis desligadas, o comportamento do servidor não muda
7. **Evidência em `registo.md`**
   - Registar os comandos `curl` e as respostas de cada critério de aceitação
   - Responder ao «Antes de avançar» da 4.2

## Critérios de aceitação

- [ ] Nenhuma rota de `/v1` responde `501`; todas as respostas, incluindo as de erro, seguem o `reporta.openapi.yaml`
- [ ] `GET /v1/categorias` devolve as cinco categorias com os raios, e os raios alterados estão justificados em `registo.md`
- [ ] Dois cidadãos diferentes a comunicar um `buraco` a menos de 15 m: o primeiro recebe `201` e o segundo `200` `reforcada` com `comunicacoes = 2`
- [ ] O mesmo cidadão a repetir a comunicação recebe `200` `ja-comunicada` e o contador não sobe
- [ ] Categoria diferente, distância acima do raio ou ocorrência `resolvida` dão origem a uma ocorrência nova (`201`)
- [ ] Descrição com menos de 10 caracteres ou fotografia acima de 300 KB são recusadas com `400`
- [ ] Repetir um `POST` com a mesma `Idempotency-Key` e o mesmo corpo devolve a mesma resposta com `Idempotent-Replayed: true` e não altera `comunicacoes`; com corpo diferente devolve `409`
- [ ] Com `SIMULAR_PERDA_RESPOSTA=1`, o primeiro `POST` fica sem resposta e a repetição com a mesma chave devolve o resultado sem criar uma segunda ocorrência
- [ ] Com `SIMULAR_503` ativo, a resposta é `503` com `Retry-After: 2`
- [ ] Depois de um `PATCH` de administração para `resolvida`, a ocorrência aparece em `alteracoes?desde=<cursor anterior>` do cidadão que a comunicou, não aparece na de outro cidadão, e o reforço direto devolve `410`
- [ ] Os dados sobrevivem a um reinício do servidor através do ficheiro JSON, sem nenhuma base de dados instalada ou configurada; `express` continua a ser a única dependência
