// IndexedDB: cópia local das sugestões, sugestões por enviar e dono da cópia.
// Só a página lhe acede (o service worker não).
const NOME_BD = 'sugestoes-bd';
const VERSAO_BD = 1;
const ORDEM_ESTADOS = ['submetida', 'em_analise', 'aceite', 'rejeitada', 'resolvida'];

let ligacao = null;

// A estrutura só pode ser criada no evento upgradeneeded.
export function abrirBD() {
  if (ligacao) return ligacao;
  ligacao = new Promise((resolve, reject) => {
    const pedido = indexedDB.open(NOME_BD, VERSAO_BD);
    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      const sugestoes = bd.createObjectStore('sugestoes', { keyPath: 'id' });
      sugestoes.createIndex('porEstado', 'estado');
      sugestoes.createIndex('porData', 'dataCriacao');
      bd.createObjectStore('pendentes', { keyPath: 'idLocal', autoIncrement: true });
      bd.createObjectStore('meta', { keyPath: 'chave' });
    };
    pedido.onsuccess = () => {
      const bd = pedido.result;
      bd.onversionchange = () => { bd.close(); ligacao = null; };
      resolve(bd);
    };
    pedido.onerror = () => reject(pedido.error);
  }).catch((erro) => {
    ligacao = null;
    throw erro;
  });
  return ligacao;
}

// Executa o trabalho numa transação e só resolve no evento complete (e não quando o último pedido termina).
// "trabalho" recebe as lojas pedidas e devolve um pedido IDB, uma função ou um valor.
async function transacao(lojas, modo, trabalho) {
  const bd = await abrirBD();
  return new Promise((resolve, reject) => {
    const tx = bd.transaction(lojas, modo);
    const resultado = trabalho(...lojas.map((nome) => tx.objectStore(nome)));
    tx.oncomplete = () => {
      if (typeof resultado === 'function') resolve(resultado());
      else if (resultado instanceof IDBRequest) resolve(resultado.result);
      else resolve(resultado);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const maisRecentePrimeiro = (a, b) => b.dataCriacao.localeCompare(a.dataCriacao);

// ---------- Lista de sugestões (cópia de GET /v2/sugestoes) ----------
// Apaga e volta a preencher numa única transação: se algo falhar, fica a cópia anterior.
export function substituirSugestoes(lista) {
  const agora = new Date().toISOString();
  return transacao(['sugestoes', 'meta'], 'readwrite', (sugestoes, meta) => {
    sugestoes.clear();
    for (const s of lista) sugestoes.put(s);
    const atual = meta.get('proprietario');
    atual.onsuccess = () => {
      if (atual.result) meta.put({ ...atual.result, atualizadoEm: agora });
    };
  });
}

export function lerSugestoes(ordenacao) {
  return transacao(['sugestoes'], 'readonly', (loja) => {
    if (ordenacao === 'estado') {
      // um grupo por estado, na ordem do ciclo de vida, através do índice porEstado
      const grupos = ORDEM_ESTADOS.map((e) => loja.index('porEstado').getAll(IDBKeyRange.only(e)));
      return () => grupos.flatMap((g) => [...g.result].sort(maisRecentePrimeiro));
    }
    // recentes: percorre o índice porData em sentido decrescente
    const lista = [];
    const cursor = loja.index('porData').openCursor(null, 'prev');
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        lista.push(c.value);
        c.continue();
      }
    };
    return () => lista;
  });
}

export function guardarSugestao(sugestao) {
  return transacao(['sugestoes'], 'readwrite', (loja) => loja.put(sugestao));
}

// ---------- Sugestões por enviar ----------
export function acrescentarPendente(dados, utilizador) {
  return transacao(['pendentes'], 'readwrite', (loja) => loja.add({
    utilizador,
    titulo: dados.titulo,
    descricao: dados.descricao,
    categoria: dados.categoria,
    criadaEm: new Date().toISOString(),
    erro: null,
  }));
}

// A chave é autoIncrement: a ordem de leitura é a ordem de criação.
export function lerPendentes() {
  return transacao(['pendentes'], 'readonly', (loja) => loja.getAll());
}

export function marcarErro(idLocal, mensagem) {
  return transacao(['pendentes'], 'readwrite', (loja) => {
    const atual = loja.get(idLocal);
    atual.onsuccess = () => {
      if (atual.result) loja.put({ ...atual.result, erro: mensagem });
    };
  });
}

export function descartarPendente(idLocal) {
  return transacao(['pendentes'], 'readwrite', (loja) => loja.delete(idLocal));
}

// Remove a pendente e acrescenta a Sugestao criada: ou as duas coisas, ou nenhuma.
export function confirmarPendente(idLocal, sugestao) {
  return transacao(['pendentes', 'sugestoes'], 'readwrite', (pendentes, sugestoes) => {
    pendentes.delete(idLocal);
    sugestoes.put(sugestao);
  });
}

// ---------- Proprietário da cópia local ----------
export async function lerProprietario() {
  return (await transacao(['meta'], 'readonly', (meta) => meta.get('proprietario'))) ?? null;
}

export function guardarProprietario(sessao) {
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

export function limparBD() {
  return transacao(['sugestoes', 'pendentes', 'meta'], 'readwrite', (a, b, c) => {
    a.clear();
    b.clear();
    c.clear();
  });
}
