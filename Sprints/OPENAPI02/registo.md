# Registo · API03 (cookies e armazenamento no browser)

Grupo: ______________________  Data: ____________

## 16 · Verificação do servidor (curl -i)

Executado com `node --env-file=.env servidor.js`; cookie guardado com `-c cookies.txt` e enviado com `-b cookies.txt`. O valor do cookie aparece abreviado (`…`).

| # | Pedido | Código | Cabeçalhos relevantes | Resultado |
|---|---|---|---|---|
| T1 | `POST /v2/sessao` (Ana) | **200** | `Set-Cookie: sessao=eyJhbGciOiJIUzI1NiIs…; Max-Age=900; Path=/v2; Expires=…; HttpOnly; SameSite=Strict` e `Cache-Control: no-store` | Corpo `Sessao` da Ana; o token não vem no corpo |
| T2 | `POST /v2/sessao` (palavra-passe errada) | **401** | sem `Set-Cookie`; `Cache-Control: no-store` | `Utilizador ou palavra-passe incorretos.` |
| T3 | `GET /v2/sessao` com cookie | **200** | `Cache-Control: no-store` | `{"utilizador":"20261234","nome":"Ana Lopes","papel":"aluno","expiracao":"…"}` |
| T4 | `GET /v2/sugestoes` com cookie | **200** | `Cache-Control: private, no-cache` | `total: 2`, só sugestões do aluno 20261234 |
| T5 | `GET /v2/sugestoes` sem cookie | **401** | `WWW-Authenticate: Bearer` | `Token ausente, inválido ou expirado.` |
| T6 | `POST /v2/sugestoes` com cookie | **201** | `Location: /v2/sugestoes/4` | `numeroAluno` = `20261234` (vem do token) |
| T7 | `DELETE /v2/sessao` | **204** | `Set-Cookie: sessao=; Path=/v2; Expires=Thu, 01 Jan 1970 00:00:00 GMT` | O browser apaga o cookie |
| T8 | `GET /v2/sugestoes` com o valor copiado antes de T7 | **200** | `Cache-Control: private, no-cache` | **O servidor aceitou o cookie** (ver ponto 19.2) |

## 17 · Verificação no browser

Fazer com as ferramentas de programador abertas (separadores Rede e Aplicação) e preencher a coluna «Observado» com o que viu (e juntar capturas de ecrã).

| | O que fazer | Resultado esperado | Observado |
|---|---|---|---|
| (a) | Entrar e ver Aplicação → Cookies | Existe `sessao`, com a caixa **HttpOnly** marcada, `Path=/v2`, `SameSite=Strict` | |
| (b) | Escrever `document.cookie` na consola | Não aparece o cookie `sessao` (string vazia): o JavaScript não o consegue ler | |
| (c) | Recarregar a página | A sessão mantém-se: `GET /v2/sessao` devolve 200 e a área de sessão aparece sem novo login | |
| (d) | Mudar o tema, fechar e reabrir o browser | O tema mantém-se (localStorage persiste até ser apagado) | |
| (e) | Em Aplicação → Local Storage, mudar `configuracoes` para `{"tema":"roxo"}` e recarregar | A página usa os valores por omissão (claro / recentes), sem erros | |
| (f) | Escrever um rascunho, recarregar; depois abrir a página noutro separador | Após recarregar, o rascunho volta; no novo separador, o formulário está vazio | |

## 18 · Escolha do mecanismo

| Dado | Mecanismo usado | Quanto tempo dura | Porque não se usou outro mecanismo |
|---|---|---|---|
| token | cookie (`HttpOnly`) | 900 s (15 min), até expirar ou ser apagado | Em localStorage/sessionStorage o JavaScript leria o token e o código teria de o enviar em cada pedido; o cookie `HttpOnly` é enviado pelo browser e o JavaScript não o lê |
| configurações | localStorage | até ser apagado | O sessionStorage perder-se-ia ao fechar o separador; um cookie seria enviado ao servidor em cada pedido sem necessidade |
| rascunho | sessionStorage | até o separador ser fechado | O localStorage guardaria o rascunho para sempre e partilhá-lo-ia entre separadores; um cookie seria enviado ao servidor sem necessidade |

## 19 · Reflexão

> Estas respostas são um ponto de partida. Reescrevam-nas por palavras vossas: na avaliação oral têm de as saber explicar.

**19.1 Vantagem e desvantagem do cookie face à variável da API02.**
Vantagem: sobrevive ao recarregamento da página e o browser envia-o sozinho, por isso o cliente deixa de tratar do token. Com `HttpOnly`, o JavaScript também não o consegue roubar. Desvantagem: o cliente já não consegue ler o token (por isso precisa de `GET /v2/sessao` para saber quem é o utilizador) e, como o browser o envia automaticamente, é preciso proteger o servidor de pedidos que o utilizador não quis fazer (assunto de uma ficha posterior).

**19.2 Em T8, o servidor aceitou o cookie depois de terminada a sessão?**
Sim. O token é um JWT: o servidor só verifica a assinatura e o `exp`, e não guarda estado de sessões. `DELETE /v2/sessao` limpa o cookie *no browser*, mas o token copiado continua válido até expirar (15 minutos). Para o invalidar antes, o servidor teria de manter uma lista de tokens revogados (ou sessões no servidor).

**19.3 Se a Ana mudar de computador, as configurações acompanham-na?**
Não. O localStorage pertence ao browser (e ao site) naquele computador, não à Ana. Se a Ana e o Bruno usarem o mesmo browser, partilham as configurações. Para as configurações acompanharem a Ana, teriam de ser guardadas no servidor, associadas ao utilizador autenticado (por exemplo, `GET`/`PUT /v2/configuracoes`).

## Notas sobre a entrega

- Utilizadores de teste: `20261234` / `ana12345` (aluno, Ana Lopes), `20265678` / `bruno1234` (aluno), `maria.silva` / `servicos123` (serviços). Foram escolhidos por mim; troquem pelos da API02 se forem outros.
- `maxAge` do Express é em **milissegundos**; o servidor usa `900 * 1000` para 15 minutos.
- Linter: `npx @redocly/cli lint sugestoes.openapi.yaml` sem erros (3 avisos: licença em falta e dois endpoints sem resposta 4XX).
