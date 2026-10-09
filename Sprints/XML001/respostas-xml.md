# Nós da estrutura XML

| **Nó** | **Tipo** | **Pai** | **Irmãos** | **Justificação** |
| :---: | :---: | :---: | :---: | :--- |
| `<fatura>` | raiz | — | — | Contém toda a estrutura da fatura. |
| `<cliente>` | intermédio | `<cabecalho>` | `<data>` | Contém `nome`, `morada` e `telefone`. |
| `<telefone>` | terminal | `<cliente>` | `<nome>`, `<morada>` | Não contém elementos filhos; contém apenas texto. |
| `id` | atributo | `<fatura>` | — | Identifica a fatura a que pertence. |
| `"912345678"` | texto | `<telefone>` | — | É o valor textual de `<telefone>`. |
