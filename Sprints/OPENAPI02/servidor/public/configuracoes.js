'use strict';

// Configurações da interface, guardadas no localStorage (pertencem ao browser, não ao utilizador).
const CHAVE_CONFIGURACOES = 'configuracoes';
const CONFIGURACOES_OMISSAO = { tema: 'claro', ordenacao: 'recentes' };
const CONFIGURACOES_VALIDAS = {
  tema: ['claro', 'escuro'],
  ordenacao: ['recentes', 'estado'],
};

// Devolve as configurações guardadas ou, se não existirem, não forem JSON válido
// ou tiverem valores fora da tabela, os valores por omissão.
function lerConfiguracoes() {
  try {
    const bruto = localStorage.getItem(CHAVE_CONFIGURACOES);
    if (bruto !== null) {
      const c = JSON.parse(bruto);
      if (c && typeof c === 'object' &&
          CONFIGURACOES_VALIDAS.tema.includes(c.tema) &&
          CONFIGURACOES_VALIDAS.ordenacao.includes(c.ordenacao)) {
        return { tema: c.tema, ordenacao: c.ordenacao };
      }
    }
  } catch {
    // JSON inválido ou localStorage indisponível: usa os valores por omissão
  }
  return { ...CONFIGURACOES_OMISSAO };
}

function guardarConfiguracoes(configuracoes) {
  try {
    localStorage.setItem(CHAVE_CONFIGURACOES, JSON.stringify(configuracoes));
  } catch {
    // sem armazenamento disponível: as configurações aplicam-se só nesta visita
  }
}
