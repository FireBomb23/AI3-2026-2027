function erroCom(tipo, porEnviar) {
  const erro = new Error(tipo);
  erro.tipo = tipo;
  erro.porEnviar = porEnviar;
  return erro;
}

function textoErro(dados) {
  if (!dados || !dados.mensagem) return 'O servidor recusou a sugestão.';
  const detalhes = (dados.detalhes || []).map((d) => `${d.campo}: ${d.problema}`).join('; ');
  return detalhes ? `${dados.mensagem} (${detalhes})` : dados.mensagem;
}

async function executarSincronizacao() {
  const proprietario = await lerProprietario();
  const porEnviarInicial = proprietario ? await contarPendentes(proprietario.utilizador) : 0;
  if (!proprietario || Date.parse(proprietario.expiracao) <= Date.now()) {
    return { tipo: 'sessao-expirada', porEnviar: porEnviarInicial };
  }

  let enviadas = 0;
  let recusadas = 0;
  const pendentes = await lerPendentesDe(proprietario.utilizador);
  for (const pendente of pendentes) {
    await registarTentativa(pendente.idLocal);
    let resposta;
    try {
      resposta = await fetch('/v2/sugestoes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': pendente.chave,
        },
        body: JSON.stringify({
          titulo: pendente.titulo,
          descricao: pendente.descricao,
          categoria: pendente.categoria,
        }),
      });
    } catch {
      throw erroCom('sem-rede', await contarPendentes(proprietario.utilizador));
    }

    if (resposta.status === 201) {
      const criada = await resposta.json().catch(() => null);
      if (criada) {
        await confirmarPendente(pendente.idLocal, criada);
        enviadas += 1;
      }
    } else if (resposta.status === 400 || resposta.status === 409) {
      await marcarErro(pendente.idLocal, textoErro(await resposta.json().catch(() => null)));
      recusadas += 1;
    } else if (resposta.status === 401) {
      return {
        tipo: 'sessao-expirada',
        porEnviar: await contarPendentes(proprietario.utilizador),
      };
    } else if (resposta.status >= 500) {
      throw erroCom('erro-servidor', await contarPendentes(proprietario.utilizador));
    }
  }

  const cursorAtual = await lerCursor(proprietario.utilizador);
  let resposta;
  try {
    resposta = await fetch(`/v2/sugestoes/alteracoes?desde=${encodeURIComponent(cursorAtual)}`);
  } catch {
    throw erroCom('sem-rede', await contarPendentes(proprietario.utilizador));
  }
  if (resposta.status === 401) {
    return { tipo: 'sessao-expirada', porEnviar: await contarPendentes(proprietario.utilizador) };
  }
  if (!resposta.ok) throw erroCom('erro-servidor', await contarPendentes(proprietario.utilizador));
  const dados = await resposta.json();
  await aplicarAlteracoes(proprietario.utilizador, dados.alteracoes || [], dados.cursor);
  return {
    tipo: 'sincronizado',
    enviadas,
    recusadas,
    recebidas: (dados.alteracoes || []).length,
    porEnviar: await contarPendentes(proprietario.utilizador),
  };
}

globalThis.executarSincronizacao = executarSincronizacao;
