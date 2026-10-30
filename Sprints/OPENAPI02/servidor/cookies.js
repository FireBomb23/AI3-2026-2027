'use strict';

// Procura o cookie `nome` no cabeçalho Cookie (forma: nome1=valor1; nome2=valor2).
// Devolve o valor, ou null se o cookie não existir.
function lerCookie(req, nome) {
  const cabecalho = req.get('Cookie');
  if (!cabecalho) return null;
  for (const par of cabecalho.split(';')) {
    const i = par.indexOf('=');
    if (i === -1) continue;
    if (par.slice(0, i).trim() !== nome) continue;
    const valor = par.slice(i + 1).trim();
    try {
      return decodeURIComponent(valor);
    } catch {
      return valor;
    }
  }
  return null;
}

module.exports = { lerCookie };
