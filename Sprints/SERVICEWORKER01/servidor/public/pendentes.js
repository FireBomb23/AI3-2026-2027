// Envio das sugestões criadas sem ligação (loja "pendentes" da IndexedDB).
import { lerPendentes, confirmarPendente, marcarErro } from './bd.js';

let aDecorrer = false;

function descreverErro(dados) {
  if (!dados || !dados.mensagem) return 'O servidor recusou a sugestão.';
  const detalhes = (dados.detalhes || []).map((d) => `${d.campo}: ${d.problema}`).join('; ');
  return detalhes ? `${dados.mensagem} (${detalhes})` : dados.mensagem;
}

// Envia, pela ordem de criação, as pendentes do utilizador da sessão atual que não têm erro.
// Devolve { resultado }: 'ok' | 'ocupado' | 'sem-ligacao' | 'sessao-expirada' | 'erro-servidor'.
export async function enviarPendentes(utilizador) {
  if (aDecorrer) return { resultado: 'ocupado' };
  aDecorrer = true;
  try {
    const porEnviar = (await lerPendentes()).filter((p) => p.utilizador === utilizador && p.erro === null);
    for (const p of porEnviar) {
      let resposta;
      try {
        resposta = await fetch('/v2/sugestoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // sem numeroAluno: o servidor usa o do token
          body: JSON.stringify({ titulo: p.titulo, descricao: p.descricao, categoria: p.categoria }),
        });
      } catch {
        return { resultado: 'sem-ligacao' };
      }
      if (resposta.status === 201) {
        const criada = await resposta.json().catch(() => null);
        if (criada) await confirmarPendente(p.idLocal, criada);
      } else if (resposta.status === 400) {
        const dados = await resposta.json().catch(() => null);
        await marcarErro(p.idLocal, descreverErro(dados));
      } else if (resposta.status === 401) {
        return { resultado: 'sessao-expirada' };
      } else {
        return { resultado: 'erro-servidor' };
      }
    }
    return { resultado: 'ok' };
  } finally {
    aDecorrer = false;
  }
}
