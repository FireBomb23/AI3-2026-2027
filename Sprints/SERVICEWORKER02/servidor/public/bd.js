// IndexedDB partilhada pela página e pelo service worker.
const NOME_BD = 'sugestoes-bd';
const VERSAO_BD = 2;
const ORDEM_ESTADOS = ['submetida', 'em_analise', 'aceite', 'rejeitada', 'resolvida'];
let ligacao = null;

function abrirBD() {
  if (ligacao) return ligacao;
  ligacao = new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.open(NOME_BD, VERSAO_BD);
    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      if (pedido.oldVersion < 1) {
        const sugestoes = bd.createObjectStore('sugestoes', { keyPath: 'id' });
        sugestoes.createIndex('porEstado', 'estado');
        sugestoes.createIndex('porData', 'dataCriacao');
        bd.createObjectStore('pendentes', { keyPath: 'idLocal', autoIncrement: true });
        bd.createObjectStore('meta', { keyPath: 'chave' });
      }
      if (pedido.oldVersion < 2) {
        const pendentes = pedido.transaction.objectStore('pendentes');
        pendentes.createIndex('porUtilizador', 'utilizador');
        pendentes.openCursor().onsuccess = (evento) => {
          const cursor = evento.target.result;
          if (!cursor) return;
          const valor = cursor.value;
          cursor.update({
            ...valor,
            chave: valor.chave || crypto.randomUUID(),
            tentativas: valor.tentativas || 0,
            ultimaTentativa: valor.ultimaTentativa || null,
          });
          cursor.continue();
        };
      }
    };
    pedido.onblocked = () => console.warn('sugestoes-bd: à espera que outra ligação feche');
    pedido.onsuccess = () => {
      const bd = pedido.result;
      bd.onversionchange = () => {
        bd.close();
        ligacao = null;
        if (typeof document !== 'undefined') {
          const mensagem = document.getElementById('mensagens');
          if (mensagem) mensagem.textContent = 'Há uma versão nova da aplicação. Recarregue a página.';
        }
      };
      resolver(bd);
    };
    pedido.onerror = () => rejeitar(pedido.error);
  }).catch((erro) => {
    ligacao = null;
    throw erro;
  });
  return ligacao;
}

function transacao(lojas, modo, trabalho) {
  return abrirBD().then((bd) => new Promise((resolver, rejeitar) => {
    const tx = bd.transaction(lojas, modo);
    const resultado = trabalho(...lojas.map((nome) => tx.objectStore(nome)));
    tx.oncomplete = () => {
      if (typeof resultado === 'function') resolver(resultado());
      else if (resultado instanceof IDBRequest) resolver(resultado.result);
      else resolver(resultado);
    };
    tx.onerror = () => rejeitar(tx.error);
    tx.onabort = () => rejeitar(tx.error);
  }));
}

function lerSugestoes(ordenacao = 'recentes') {
  return transacao(['sugestoes'], 'readonly', (loja) => {
    if (ordenacao === 'estado') {
      const grupos = ORDEM_ESTADOS.map((estado) => loja.index('porEstado').getAll(IDBKeyRange.only(estado)));
      return () => grupos.flatMap((grupo) => [...grupo.result].sort((a, b) => b.dataCriacao.localeCompare(a.dataCriacao)));
    }
    const lista = [];
    const cursor = loja.index('porData').openCursor(null, 'prev');
    cursor.onsuccess = () => {
      if (cursor.result) {
        lista.push(cursor.result.value);
        cursor.result.continue();
      }
    };
    return () => lista;
  });
}

function guardarSugestao(sugestao) {
  return transacao(['sugestoes'], 'readwrite', (loja) => loja.put(sugestao));
}

function substituirSugestoes(lista) {
  const agora = new Date().toISOString();
  return transacao(['sugestoes', 'meta'], 'readwrite', (sugestoes, meta) => {
    sugestoes.clear();
    for (const sugestao of lista) sugestoes.put(sugestao);
    const dono = meta.get('proprietario');
    dono.onsuccess = () => {
      if (dono.result) meta.put({ ...dono.result, atualizadoEm: agora });
    };
  });
}

function acrescentarPendente(dados, utilizador) {
  return transacao(['pendentes'], 'readwrite', (loja) => loja.add({
    utilizador,
    titulo: dados.titulo,
    descricao: dados.descricao,
    categoria: dados.categoria,
    criadaEm: new Date().toISOString(),
    chave: crypto.randomUUID(),
    tentativas: 0,
    ultimaTentativa: null,
    erro: null,
  }));
}

function lerPendentes() {
  return transacao(['pendentes'], 'readonly', (loja) => loja.getAll());
}

function lerPendentesDe(utilizador) {
  return transacao(['pendentes'], 'readonly', (loja) => loja.index('porUtilizador').getAll(IDBKeyRange.only(utilizador)))
    .then((lista) => lista.filter((p) => p.erro === null).sort((a, b) => a.idLocal - b.idLocal));
}

function contarPendentes(utilizador) {
  return lerPendentesDe(utilizador).then((lista) => lista.length);
}

function registarTentativa(idLocal) {
  return transacao(['pendentes'], 'readwrite', (loja) => {
    const pedido = loja.get(idLocal);
    pedido.onsuccess = () => {
      if (pedido.result) {
        loja.put({
          ...pedido.result,
          tentativas: (pedido.result.tentativas || 0) + 1,
          ultimaTentativa: new Date().toISOString(),
        });
      }
    };
  });
}

function marcarErro(idLocal, mensagem) {
  return transacao(['pendentes'], 'readwrite', (loja) => {
    const pedido = loja.get(idLocal);
    pedido.onsuccess = () => {
      if (pedido.result) loja.put({ ...pedido.result, erro: mensagem });
    };
  });
}

function descartarPendente(idLocal) {
  return transacao(['pendentes'], 'readwrite', (loja) => loja.delete(idLocal));
}

function confirmarPendente(idLocal, sugestao) {
  return transacao(['pendentes', 'sugestoes'], 'readwrite', (pendentes, sugestoes) => {
    pendentes.delete(idLocal);
    sugestoes.put(sugestao);
  });
}

function lerProprietario() {
  return transacao(['meta'], 'readonly', (meta) => meta.get('proprietario')).then((dono) => dono || null);
}

function guardarProprietario(sessao) {
  return transacao(['meta'], 'readwrite', (meta) => {
    const atual = meta.get('proprietario');
    atual.onsuccess = () => {
      const anterior = atual.result;
      const mesmo = anterior && anterior.utilizador === sessao.utilizador;
      meta.put({
        chave: 'proprietario',
        utilizador: sessao.utilizador,
        nome: sessao.nome,
        papel: sessao.papel,
        expiracao: sessao.expiracao,
        atualizadoEm: mesmo ? anterior.atualizadoEm : null,
      });
    };
  });
}

function lerCursor(utilizador) {
  return transacao(['meta'], 'readonly', (meta) => meta.get(`cursor:${utilizador}`))
    .then((registo) => registo ? registo.valor : 0);
}

function aplicarAlteracoes(utilizador, alteracoes, cursor) {
  return transacao(['sugestoes', 'meta'], 'readwrite', (sugestoes, meta) => {
    for (const sugestao of alteracoes) {
      if (sugestao.numeroAluno === utilizador) sugestoes.put(sugestao);
    }
    meta.put({ chave: `cursor:${utilizador}`, valor: cursor });
  });
}

function limparBD() {
  return transacao(['sugestoes', 'pendentes', 'meta'], 'readwrite', (sugestoes, pendentes, meta) => {
    sugestoes.clear();
    pendentes.clear();
    meta.clear();
  });
}

Object.assign(globalThis, {
  abrirBD, lerSugestoes, guardarSugestao, substituirSugestoes, acrescentarPendente,
  lerPendentes, lerPendentesDe, contarPendentes, registarTentativa, marcarErro,
  descartarPendente, confirmarPendente, lerProprietario, guardarProprietario,
  lerCursor, aplicarAlteracoes, limparBD,
});
