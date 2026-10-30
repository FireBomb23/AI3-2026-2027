# Registo · API03 (cookies e armazenamento no browser)

Grupo / Nome: ______________________  Data: ____________  *(preencher)*

Utilizadores de teste (os mesmos da API02): `12345` / `Ana#2026ok` (aluno), `67890` / `Bruno#2026ok` (aluno), `rita.sousa` / `Rita#2026ok` (serviços).

## 16 · Verificação do servidor (curl -i)

Executado com `node --env-file=.env servidor.js`; cookie guardado com `-c cookies.txt` e enviado com `-b cookies.txt`. O valor do cookie aparece abreviado (`…`).

| # | Pedido | Código | Cabeçalhos relevantes | Resultado |
|---|---|---|---|---|
| T1 | `POST /v2/sessao` (Ana) | **200** | `Set-Cookie: sessao=eyJhbGciOiJIUzI1NiIs…; Max-Age=900; Path=/v2; Expires=…; HttpOnly; SameSite=Strict`; `Cache-Control: no-store` | Corpo `Sessao` da Ana; o token não vem no corpo |
| T2 | `POST /v2/sessao` (palavra-passe errada) | **401** | sem `Set-Cookie`; `Cache-Control: no-store` | `Utilizador ou palavra-passe incorretos.` |
| T3 | `GET /v2/sessao` com cookie | **200** | `Cache-Control: no-store` | `{"utilizador":"12345","nome":"Ana Silva","papel":"aluno","expiracao":"…"}` |
| T4 | `GET /v2/sugestoes` com cookie | **200** | `Cache-Control: private, no-cache` | `total: 2`, só `numeroAluno: "12345"` |
| T5 | `GET /v2/sugestoes` sem cookie | **401** | `WWW-Authenticate: Bearer`; `no-store` | `Token ausente, inválido ou expirado.` |
| T6 | `POST /v2/sugestoes` com cookie da Ana (corpo com `"numeroAluno":"99999"`) | **201** | `Location: /v2/sugestoes/5`; `no-store` | `numeroAluno` = `12345`: o valor do corpo é ignorado, usa-se o do token |
| T7 | `DELETE /v2/sessao` | **204** | `Set-Cookie: sessao=; Path=/v2; Expires=Thu, 01 Jan 1970 00:00:00 GMT`; `no-store` | O browser apaga o cookie |
| T8 | `GET /v2/sugestoes` com o valor do cookie copiado antes de T7 | **200** | `private, no-cache` | **O servidor aceitou o cookie** (ver ponto 19.2) |

Verificações extra: o cabeçalho `Authorization: Bearer` continua a ser aceite em `GET /v2/sessao` (200); `POST /v2/sugestoes` com o cookie da Rita (serviços) dá **403**; com corpo inválido dá **400** com `detalhes`.

## 17 · Verificação no browser (a fazer por vocês)

Abrir as ferramentas de programador (separadores Rede e Aplicação), fazer cada passo no browser e escrever em «Observado» o que realmente aparece, juntando uma captura de ecrã por linha (guardar em `capturas/`).

| | O que fazer | Resultado esperado | Observado |
|---|---|---|---|
| (a) | Entrar e ver Aplicação → Cookies | Existe `sessao`, com **HttpOnly** marcado, `Path=/v2`, `SameSite=Strict` |  *(preencher + captura de ecrã)* |
| (b) | Escrever `document.cookie` na consola | Não mostra o cookie `sessao` (string vazia): o JavaScript não o consegue ler |  *(preencher + captura de ecrã)* |
| (c) | Recarregar a página | A sessão mantém-se: `GET /v2/sessao` dá 200 e aparece a área de sessão sem novo login |  *(preencher + captura de ecrã)* |
| (d) | Mudar o tema, fechar e reabrir o browser | O tema mantém-se (localStorage dura até ser apagado) |  *(preencher + captura de ecrã)* |
| (e) | Em Local Storage, mudar `configuracoes` para `{"tema":"roxo"}` e recarregar | A página usa os valores por omissão (claro / recentes), sem erros |  *(preencher + captura de ecrã)* |
| (f) | Escrever um rascunho e recarregar; depois abrir a página noutro separador | Depois de recarregar, o rascunho volta; no novo separador, o formulário está vazio |  *(preencher + captura de ecrã)* |

## 18 · Escolha do mecanismo

| Dado | Mecanismo usado | Quanto tempo dura | Porque não se usou outro mecanismo |
|---|---|---|---|
| token | cookie (`HttpOnly`) | 900 s (15 min), até expirar ou ser apagado | Em localStorage/sessionStorage o JavaScript leria o token e teria de o enviar em cada pedido; o cookie `HttpOnly` é enviado pelo browser e o JavaScript não o lê |
| configurações | localStorage | até ser apagado | O sessionStorage perder-se-ia ao fechar o separador; um cookie seria enviado ao servidor em cada pedido sem necessidade |
| rascunho | sessionStorage | até o separador ser fechado | O localStorage guardá-lo-ia para sempre e partilhá-lo-ia entre separadores; um cookie seria enviado ao servidor sem necessidade |

## 19 · Reflexão

> Responder por palavras próprias. As perguntas abaixo são o que se pergunta na avaliação oral.

**19.1 Que vantagem tem o cookie em relação à variável usada na API02? E que desvantagem?**
*Pistas:* o que acontece ao recarregar a página? Quem envia o token em cada pedido? O que passou a ser impossível ao JavaScript do cliente (ver HttpOnly), e que pedido é preciso para saber o nome do utilizador?

A minha resposta:

**19.2 Em T8, o servidor aceitou o cookie depois de terminada a sessão? Porquê?**
*Pistas:* o que faz `DELETE /v2/sessao` e onde? O que verifica o servidor num JWT (assinatura, `exp`)? O servidor guarda alguma lista de sessões ou tokens? O que seria preciso para o invalidar antes de expirar?

A minha resposta:

**19.3 Se a Ana mudar de computador, as suas configurações acompanham-na? O que seria necessário?**
*Pistas:* a quem pertence o localStorage, ao utilizador ou ao browser? E se a Ana e o Bruno usarem o mesmo computador? Onde teriam de ficar guardadas, e com que operação da API?

A minha resposta:

## Notas

- O contrato 2.1.0 valida com `npx @redocly/cli lint sugestoes.openapi.yaml`: sem erros, 3 avisos (licença em falta; `listarCategorias` e `terminarSessao` sem resposta 4XX).
- O `maxAge` do Express é em **milissegundos**; o servidor usa `VALIDADE * 1000` (900 s = 15 min).
- Mudança de versão 2.0.0 → 2.1.0 (e não 3.0.0): só se acrescentam operações e um esquema de segurança alternativo; um cliente da API02, que envia `Authorization`, continua a funcionar.
