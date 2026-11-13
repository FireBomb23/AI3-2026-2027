import { lerConfiguracoes, guardarConfiguracoes } from './configuracoes.js';

const {
  lerSugestoes, acrescentarPendente, lerPendentes, descartarPendente,
  lerProprietario, guardarProprietario, limparBD, contarPendentes,
} = globalThis;

const $ = (id) => document.getElementById(id);
const CHAVE_RASCUNHO = 'rascunhoSugestao';
const MENSAGEM_EXPIRADA = 'A sessão expirou. Entre de novo.';
const MENSAGEM_REDE = 'Não foi possível contactar o servidor. Verifique a ligação e tente de novo.';
const TEXTO_LIGACAO = {
  'a-verificar': '',
  'sem-sessao': '',
  'com-sessao': '',
  'sem-ligacao': 'Sem ligação ao servidor.',
};

// Já não há token em JavaScript: o cookie HttpOnly é enviado pelo browser.
// "sessao" guarda os dados da sessão: do servidor (com-sessao) ou da cópia local (sem-ligacao).
let sessao = null;
let temporizador = null;
let atualizacaoPedida = false;
let falhasSync = 0;
let agendamentoSync = null;
let suportaBackgroundSync = false;

const estadoAtual = () => document.body.dataset.estado;
const hhmm = (data) => new Date(data).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const plural = (n, um, varios) => (n === 1 ? um : varios);

function mostrarMensagem(texto) {
  $('mensagens').textContent = texto;
}

// Um fetch rejeitado (erro de rede) dá estado 0; qualquer resposta do servidor dá o seu código.
async function api(metodo, url, corpo) {
  const opcoes = { method: metodo, headers: {} };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  try {
    const resposta = await fetch(url, opcoes);
    const dados = resposta.status === 204 ? null : await resposta.json().catch(() => null);
    return { ok: resposta.ok, estado: resposta.status, dados };
  } catch {
    return { ok: false, estado: 0, dados: null };
  }
}

function textoErro(r) {
  if (r.estado === 0) return MENSAGEM_REDE;
  if (!r.dados || !r.dados.mensagem) return `O pedido falhou (código ${r.estado}).`;
  const d = (r.dados.detalhes || []).map((x) => `${x.campo}: ${x.problema}`).join('; ');
  return d ? `${r.dados.mensagem} (${d})` : r.dados.mensagem;
}

// ---------- Estados da interface ----------
// Único sítio onde o estado muda. A cópia local só se mostra em sem-ligacao se mostrarCopia for true.
function mudarEstado(estado, mostrarCopia = false) {
  document.body.dataset.estado = estado;
  const comArea = estado === 'com-sessao' || (estado === 'sem-ligacao' && mostrarCopia);
  const semLigacaoAtiva = estado === 'sem-ligacao';
  $('a-verificar').hidden = estado !== 'a-verificar';
  $('entrada').hidden = estado !== 'sem-sessao';
  $('aviso-ligacao').hidden = !semLigacaoAtiva;
  $('sessao').hidden = !comArea;
  $('btn-terminar').disabled = semLigacaoAtiva;
  $('btn-sugestoes').disabled = semLigacaoAtiva;
  $('nota-terminar').hidden = !semLigacaoAtiva;
  $('ligacao').textContent = TEXTO_LIGACAO[estado];
}

function semSessao(mensagem = '') {
  clearInterval(temporizador);
  sessao = null;
  $('lista-sugestoes').replaceChildren();
  $('info-lista').textContent = '';
  mudarEstado('sem-sessao');
  mostrarMensagem(mensagem);
}

// Sem ligação: mostra a cópia local só se existir proprietário e a sua sessão ainda não tiver expirado.
async function semLigacao() {
  let dono = null;
  try {
    dono = await lerProprietario();
  } catch {
    // sem IndexedDB: não há cópia
  }
  const utilizavel = dono !== null && Date.parse(dono.expiracao) > Date.now();
  sessao = utilizavel ? dono : null;
  mudarEstado('sem-ligacao', utilizavel);
  if (!utilizavel) {
    clearInterval(temporizador);
    $('lista-sugestoes').replaceChildren();
    $('info-lista').textContent = '';
    return;
  }
  desenharCabecalho();
  arrancarTemporizador();
  await prepararFormulario();
  await desenharLista();
  $('info-lista').textContent = dono.atualizadoEm
    ? `Dados de ${dono.nome}. Cópia de ${hhmm(dono.atualizadoEm)} — pode estar desatualizada.`
    : `Dados de ${dono.nome}. Ainda não há cópia da lista — pode estar desatualizada.`;
}

async function aoTerSessao(dados, { foco = false } = {}) {
  try {
    const dono = await lerProprietario();
    if (dono && dono.utilizador !== dados.utilizador) {
      await limparBD(); // outro utilizador no mesmo browser: nada do anterior fica
      apagarRascunho();
    }
    await guardarProprietario(dados);
  } catch {
    // sem IndexedDB: a interface funciona, sem cópia local
  }
  sessao = dados;
  mudarEstado('com-sessao');
  desenharCabecalho();
  arrancarTemporizador();
  if (foco) $('titulo-sessao').focus();
  await prepararFormulario();
  await pedirSync();
  await desenharLista();
}

async function tratarSessao(r) {
  if (r.ok) return aoTerSessao(r.dados);
  if (r.estado === 401) {
    // No arranque, 401 é só "ainda sem sessão"; se havia sessão (ou cópia dela), a sessão expirou.
    return semSessao(estadoAtual() === 'a-verificar' ? '' : MENSAGEM_EXPIRADA);
  }
  if (r.estado === 0) return semLigacao();
  return semSessao(textoErro(r));
}

async function verificarSessao() {
  mostrarMensagem('');
  await tratarSessao(await api('GET', '/v2/sessao'));
}

// ---------- Sessão: cabeçalho e expiração ----------
function desenharCabecalho() {
  const ehAluno = sessao.papel === 'aluno';
  $('sessao-nome').textContent = sessao.nome;
  $('sessao-papel').textContent = ehAluno ? 'aluno' : 'serviços';
  $('sessao-expira').textContent = new Date(sessao.expiracao).toLocaleTimeString('pt-PT');
  $('btn-sugestoes').textContent = ehAluno ? 'As minhas sugestões' : 'Todas as sugestões';
}

function arrancarTemporizador() {
  clearInterval(temporizador);
  atualizarRestante();
  temporizador = setInterval(atualizarRestante, 1000);
}

function atualizarRestante() {
  if (!sessao) return;
  const restante = Math.max(0, Math.ceil((Date.parse(sessao.expiracao) - Date.now()) / 1000));
  const m = String(Math.floor(restante / 60)).padStart(2, '0');
  const s = String(restante % 60).padStart(2, '0');
  $('sessao-restante').textContent = `${m}:${s}`;
  if (restante === 0) {
    clearInterval(temporizador);
    // Expirou: não se apagam rascunho, pendentes nem cópia local.
    if (estadoAtual() === 'sem-ligacao') semLigacao();
    else semSessao(MENSAGEM_EXPIRADA);
  }
}

// ---------- Configurações (localStorage) ----------
function aplicarConfiguracoes(c) {
  document.documentElement.dataset.tema = c.tema;
  $('cfg-tema').value = c.tema;
  $('cfg-ordenacao').value = c.ordenacao;
}

function aoAlterarConfiguracao() {
  const c = { tema: $('cfg-tema').value, ordenacao: $('cfg-ordenacao').value };
  guardarConfiguracoes(c);
  aplicarConfiguracoes(c);
  desenharLista(); // lê a IndexedDB com a nova ordenação, sem novo pedido
}

// ---------- Rascunho (sessionStorage) ----------
function guardarRascunho() {
  try {
    sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({
      titulo: $('titulo').value,
      categoria: $('categoria').value,
      descricao: $('descricao').value,
    }));
  } catch {
    // sem sessionStorage: o rascunho não é guardado
  }
}

function reporRascunho() {
  try {
    const r = JSON.parse(sessionStorage.getItem(CHAVE_RASCUNHO));
    if (!r || typeof r !== 'object') return;
    if (typeof r.titulo === 'string') $('titulo').value = r.titulo;
    if (typeof r.descricao === 'string') $('descricao').value = r.descricao;
    if (typeof r.categoria === 'string') $('categoria').value = r.categoria;
  } catch {
    // rascunho inexistente ou inválido
  }
}

function apagarRascunho() {
  try {
    sessionStorage.removeItem(CHAVE_RASCUNHO);
  } catch {
    // ignorar
  }
  $('form-nova').reset();
}

// ---------- Formulário "Nova sugestão" ----------
// As categorias vêm de GET /v2/categorias (o service worker responde da cache, se existir).
async function garantirCategorias() {
  const select = $('categoria');
  if (select.options.length > 0) return true;
  try {
    const resposta = await fetch('/v2/categorias');
    if (!resposta.ok) return false;
    const categorias = await resposta.json();
    if (!Array.isArray(categorias) || categorias.length === 0) return false;
    select.replaceChildren(...categorias.map((c) => new Option(c.descricao, c.codigo)));
    return true;
  } catch {
    return false;
  }
}

async function prepararFormulario() {
  const ehAluno = sessao.papel === 'aluno';
  $('area-nova').hidden = !ehAluno;
  if (!ehAluno) return;
  const temCategorias = await garantirCategorias();
  $('campos-nova').disabled = !temCategorias;
  $('nota-categorias').hidden = temCategorias;
  reporRascunho();
}

// ---------- Lista (a partir da IndexedDB) ----------
async function atualizarTudo() {
  await pedirSync();
  return desenharLista();
}

async function carregarSugestoes() {
  await pedirSync();
  return desenharLista();
}

function criarItem(titulo, detalhe, classe) {
  const li = document.createElement('li');
  if (classe) li.className = classe;
  const forte = document.createElement('strong');
  forte.textContent = titulo;
  const pequeno = document.createElement('small');
  pequeno.textContent = detalhe;
  li.append(forte, pequeno);
  return li;
}

async function desenharLista() {
  if (!sessao) return;
  let pendentes;
  let lista;
  try {
    [pendentes, lista] = await Promise.all([lerPendentes(), lerSugestoes(lerConfiguracoes().ordenacao)]);
  } catch {
    mostrarMensagem('Não foi possível ler a cópia local.');
    return;
  }
  if (!sessao) return;
  pendentes = pendentes.filter((p) => p.utilizador === sessao.utilizador);
  const ul = $('lista-sugestoes');
  ul.replaceChildren();
  if (pendentes.length === 0 && lista.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Sem sugestões para mostrar.';
    ul.append(li);
    return;
  }
  for (const p of pendentes) {
    const li = criarItem(p.titulo, `${p.erro ? `Erro: ${p.erro}` : 'Por enviar'} · Categoria: ${p.categoria}`, 'pendente');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'secundario';
    botao.textContent = 'Descartar';
    botao.setAttribute('aria-label', `Descartar a sugestão «${p.titulo}»`);
    botao.addEventListener('click', async () => {
      await descartarPendente(p.idLocal);
      await desenharLista();
    });
    li.append(botao);
    ul.append(li);
  }
  for (const s of lista) {
    ul.append(criarItem(
      s.titulo,
      `Categoria: ${s.categoria} · Estado: ${s.estado.replace('_', ' ')} · Aluno: ${s.numeroAluno}`,
    ));
  }
}

// ---------- Terminar sessão ----------
function confirmarTerminar(n) {
  const dialogo = $('dlg-terminar');
  $('dlg-texto').textContent = `Há ${n} ${plural(n, 'sugestão por enviar, que será apagada', 'sugestões por enviar, que serão apagadas')}. Terminar sessão?`;
  return new Promise((resolve) => {
    dialogo.addEventListener('close', () => resolve(dialogo.returnValue === 'confirmar'), { once: true });
    dialogo.returnValue = '';
    dialogo.showModal();
  });
}

// ---------- Service worker ----------
function mostrarAtualizacao(trabalhador) {
  $('atualizacao').hidden = false;
  $('btn-atualizar').onclick = () => {
    atualizacaoPedida = true;
    trabalhador.postMessage({ tipo: 'ativar' });
  };
}

async function pedirSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registo = await navigator.serviceWorker.ready;
    if ('sync' in registo) {
      suportaBackgroundSync = true;
      try {
        await registo.sync.register('sincronizar-sugestoes');
        return;
      } catch {
        // segue para o plano B
      }
    }
    suportaBackgroundSync = false;
    registo.active?.postMessage({ tipo: 'sincronizar' });
  } catch {
    // O service worker ainda não está disponível.
  }
}

function agendarNovaTentativa() {
  if (agendamentoSync || !sessao) return;
  const segundos = Math.min(60, 2 ** falhasSync) * (0.7 + 0.6 * Math.random());
  agendamentoSync = setTimeout(() => {
    agendamentoSync = null;
    pedirSync();
  }, segundos * 1000);
}

function tratarResultadoSync(resultado) {
  if (!resultado) return;
  if (resultado.tipo === 'sincronizado') {
    falhasSync = 0;
    const total = (resultado.enviadas || 0) + (resultado.recebidas || 0);
    mostrarMensagem(total ? `Sincronizado: ${resultado.enviadas || 0} enviadas, ${resultado.recebidas || 0} recebidas` : 'Sincronizado');
    desenharLista();
    setTimeout(() => {
      if (document.body.dataset.estado === 'com-sessao') mostrarMensagem('');
    }, 5000);
  } else if (resultado.tipo === 'sessao-expirada') {
    const n = resultado.porEnviar || 0;
    if (n > 0) semSessao(`Há ${n} ${plural(n, 'sugestão por enviar. Entre de novo para a enviar.', 'sugestões por enviar. Entre de novo para as enviar.')}`);
    else semSessao(MENSAGEM_EXPIRADA);
  } else if (resultado.tipo === 'sem-rede' || resultado.tipo === 'erro-servidor') {
    falhasSync += 1;
    mostrarMensagem(`Por enviar: ${resultado.porEnviar || 0}. Nova tentativa automática.`);
    if (!suportaBackgroundSync) agendarNovaTentativa();
  }
}

async function registarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registo = await navigator.serviceWorker.register('/sw.js');
    if (registo.waiting && navigator.serviceWorker.controller) mostrarAtualizacao(registo.waiting);
    registo.addEventListener('updatefound', () => {
      const novo = registo.installing;
      novo.addEventListener('statechange', () => {
        if (novo.state === 'installed' && navigator.serviceWorker.controller) mostrarAtualizacao(novo);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (atualizacaoPedida) location.reload();
    });
  } catch {
    // sem service worker: a interface funciona, mas não abre sem ligação
  }
}

// ---------- Eventos ----------
$('cfg-tema').addEventListener('change', aoAlterarConfiguracao);
$('cfg-ordenacao').addEventListener('change', aoAlterarConfiguracao);

$('form-entrada').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarMensagem('');
  const botao = evento.target.querySelector('button[type="submit"]');
  const textoBotao = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'A entrar…';
  const r = await api('POST', '/v2/sessao', {
    utilizador: $('utilizador').value.trim(),
    palavraPasse: $('palavraPasse').value,
  });
  botao.disabled = false;
  botao.textContent = textoBotao;
  if (r.ok) {
    $('palavraPasse').value = '';
    await aoTerSessao(r.dados, { foco: true });
  } else if (r.estado === 0) {
    await semLigacao();
    mostrarMensagem('Sem ligação: não é possível entrar.');
  } else {
    mostrarMensagem(textoErro(r));
    $('palavraPasse').value = '';
    $('palavraPasse').focus();
  }
});

$('btn-sugestoes').addEventListener('click', () => {
  mostrarMensagem('');
  carregarSugestoes();
});

$('btn-terminar').addEventListener('click', async () => {
  mostrarMensagem('');
  let n = 0;
  try {
    n = (await lerPendentes()).length;
  } catch {
    // sem IndexedDB: não há pendentes
  }
  if (n > 0 && !(await confirmarTerminar(n))) return;
  const r = await api('DELETE', '/v2/sessao');
  if (r.estado === 0) {
    await semLigacao();
    mostrarMensagem('Sem ligação: não foi possível terminar a sessão.');
    return;
  }
  if (!r.ok) return mostrarMensagem(textoErro(r));
  try {
    await limparBD();
  } catch {
    // ignorar
  }
  apagarRascunho();
  semSessao();
  $('utilizador').focus();
});

$('btn-tentar').addEventListener('click', verificarSessao);

$('form-nova').addEventListener('input', guardarRascunho);

$('form-nova').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarMensagem('');
  const corpo = {
    titulo: $('titulo').value.trim(),
    descricao: $('descricao').value.trim(),
    categoria: $('categoria').value,
  };
  const guardarComoPendente = async () => {
    const eraVazia = (await lerPendentes()).length === 0;
    await acrescentarPendente(corpo, sessao.utilizador);
    if (eraVazia && navigator.storage?.persist) {
      const persistente = await navigator.storage.persist();
      console.info('storage.persist', persistente, await navigator.storage.estimate());
    }
    apagarRascunho();
    await pedirSync();
  };
  await guardarComoPendente();
  return desenharLista();
});

// O evento offline só atualiza a indicação; passar a sem-ligacao resulta sempre de um fetch rejeitado.
window.addEventListener('offline', () => {
  $('ligacao').textContent = 'O navegador indica que está sem rede.';
});
window.addEventListener('online', () => {
  $('ligacao').textContent = TEXTO_LIGACAO[estadoAtual()] ?? '';
  if (estadoAtual() === 'sem-ligacao' || estadoAtual() === 'com-sessao') pedirSync();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && estadoAtual() === 'com-sessao') pedirSync();
});
navigator.serviceWorker?.addEventListener('message', (evento) => tratarResultadoSync(evento.data));

// ---------- Arranque ----------
aplicarConfiguracoes(lerConfiguracoes());
registarServiceWorker();
mudarEstado('a-verificar');
await verificarSessao();
