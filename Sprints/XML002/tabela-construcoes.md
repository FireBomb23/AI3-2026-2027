| Construção | Onde aparece | O que faz | O que continua a valer |
|---|---|---|---|
| `xsd:complexType` | `Product` e `Provider` | Permite definir elementos compostos, com elementos internos e/ou atributos | Os valores internos continuam sujeitos aos seus próprios tipos |
| `xsd:sequence` | Dentro de `Product` | Os elementos têm de aparecer pela ordem declarada | Podem existir as ocorrências permitidas pelas multiplicidades |
| `xsd:attribute` com `use` | `ProductID` | `ProductID` passa a ser obrigatório (`use="required"`) | `Category` continua opcional |
| `minOccurs` / `maxOccurs` | `Provider` | Define entre 0 e 3 ocorrências | O produto pode não ter `Provider` |
| `mixed="true"` | `aviso` | Permite texto juntamente com elementos | Continua a ser obrigatório respeitar os elementos, a ordem, os tipos e as multiplicidades definidos |
