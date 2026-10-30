// Configurações da interface, guardadas no localStorage.
// O localStorage pertence ao browser (neste computador), não ao utilizador.
const CHAVE = 'configuracoes';
const OMISSAO = { tema: 'claro', ordenacao: 'recentes' };
const VALIDAS = {
  tema: ['claro', 'escuro'],
  ordenacao: ['recentes', 'estado'],
};

// Devolve as configurações guardadas ou, se não existirem, não forem JSON válido
// ou tiverem valores fora da tabela, os valores por omissão.
export function lerConfiguracoes() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto !== null) {
      const c = JSON.parse(bruto);
      if (c && typeof c === 'object' && VALIDAS.tema.includes(c.tema) && VALIDAS.ordenacao.includes(c.ordenacao)) {
        return { tema: c.tema, ordenacao: c.ordenacao };
      }
    }
  } catch {
    // JSON inválido ou localStorage indisponível: usa os valores por omissão
  }
  return { ...OMISSAO };
}

export function guardarConfiguracoes(configuracoes) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(configuracoes));
  } catch {
    // sem armazenamento disponível: as configurações aplicam-se só nesta visita
  }
}
