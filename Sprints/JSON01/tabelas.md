# Tabelas da ficha JSON / JSON Schema

## 4.3 · Variantes do turma.json

| Variante | Alteração | Resultado | Mensagem obtida |
|---|---|---|---|
| Válida | Retirar `numeroInscritosTp2` e `docenteTp2` (turno TP2 inteiro) | Válido | sem erro |
| Inválida | Retirar apenas `docenteTp2` | Inválido | `'docenteTp2' is a dependency of 'numeroInscritosTp2'` |

## 4.4 · Alterações introduzidas

| Alteração introduzida | Ficheiro | Sintaxe errada, inválido ou válido? | Mensagem obtida | O que a mensagem permitiu (ou não) concluir |
|---|---|---|---|---|
| Retirar a vírgula entre dois pares | turma.json | Sintaxe errada | `Expecting ',' delimiter: line 4 column 3 (char 72)` | Indica a linha e a coluna do erro. Quem dá o erro é o `json.tool`; o validador de schema nem chega a correr. |
| Pôr texto onde é esperado um número (`"totalAlunos": "vinte"`) | turma.json | Inválido | `'vinte' is not of type 'integer'` | O documento está bem formado, mas o tipo do valor está errado. |
| Retirar uma propriedade obrigatória (`data`) | turma.json | Inválido | `'data' is a required property` | Identifica a propriedade em falta. |
| Trocar a ordem de duas propriedades | turma.json | Válido | sem erro | A ordem das propriedades não conta em JSON, ao contrário do `xsd:sequence` em XML. |

## 4.4 · Construções usadas

| Construção | Onde a usou | O que ficou a ser exigido | O que continua a ser permitido |
|---|---|---|---|
| type / properties | `teorica` em disciplinas.schema.json | Objeto com `horas` (integer) e `nome` (string) | Propriedades não declaradas |
| required | Objeto de cada disciplina | `codigo`, `nome` e `teorica` presentes | Omitir `pratica` e `ano` |
| items + minItems / maxItems | `cursos` em turma.schema.json | Exatamente 2 elementos, cada um pertencente ao enum | Elementos repetidos, como `["tdm","tdm"]` |
| pattern | `disciplina` em turma.schema.json | Começar por `Aplicacoes ` | Qualquer texto a seguir |
| enum | `data` em turma.schema.json | Uma das 3 datas indicadas | Nada fora dessas datas |
| dependencies | `numeroInscritosTp1` / `numeroInscritosTp2` | Se existir o número de inscritos, existe o docente do mesmo turno | O docente existir sem o número de inscritos |
| oneOf (turma.schema.json) | `planoAno1` | Elementos de um único conjunto (nunca misturados) e array não vazio | Elementos repetidos dentro do mesmo conjunto |
