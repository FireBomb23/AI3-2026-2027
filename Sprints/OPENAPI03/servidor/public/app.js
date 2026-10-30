import { lerConfiguracoes, guardarConfiguracoes } from './configuracoes.js';

const $ = (id) => document.getElementById(id);
const CHAVE_RASCUNHO = 'rascunhoSugestao';
const ORDEM_ESTADOS = ['submetida', 'em_analise', 'aceite', 'rejeitada', 'resolvida'];
const MENSAGEM_EXPIRADA = 'Sessão expirada. É necessária nova autenticação.';
const MENSAGEM_REDE = 'Não foi possível contactar o servidor. Verifique a ligação e tente de novo.';

// Já não há token em JavaScript: o cookie HttpOnly é enviado pelo browser.
// Esta variável guarda só os dados da sessão, obtidos em GET /v2/sessao.
let sessao = null;
let sugestoes = [];
let temporizador = null;

function mostrarMensagem(texto) {
  $('mensagens').textContent = texto;
}

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
  desenharSugestoes();
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

// ---------- Sessão ----------
function atualizarRestante() {
  const restante = Math.max(0, Math.ceil((Date.parse(sessao.expiracao) - Date.now()) / 1000));
  const m = String(Math.floor(restante / 60)).padStart(2, '0');
  const s = String(restante % 60).padStart(2, '0');
  $('sessao-restante').textContent = `${m}:${s}`;
  if (restante === 0) terminouSessao(MENSAGEM_EXPIRADA);
}

async function mostrarSessao() {
  $('a-verificar').hidden = true;
  $('entrada').hidden = true;
  $('sessao').hidden = false;
  const ehAluno = sessao.papel === 'aluno';
  $('sessao-nome').textContent = sessao.nome;
  $('sessao-papel').textContent = ehAluno ? 'aluno' : 'serviços';
  $('sessao-expira').textContent = new Date(sessao.expiracao).toLocaleTimeString('pt-PT');
  $('btn-sugestoes').textContent = ehAluno ? 'As minhas sugestões' : 'Todas as sugestões';
  $('area-nova').hidden = !ehAluno;
  if (ehAluno) reporRascunho();
  clearInterval(temporizador);
  atualizarRestante();
  temporizador = setInterval(atualizarRestante, 1000);
  await carregarSugestoes();
}

function mostrarEntrada(mensagem = '') {
  clearInterval(temporizador);
  sessao = null;
  sugestoes = [];
  $('lista-sugestoes').replaceChildren();
  $('a-verificar').hidden = true;
  $('sessao').hidden = true;
  $('entrada').hidden = false;
  mostrarMensagem(mensagem);
}

// A sessão terminou (por ação do utilizador ou por expiração): o rascunho é apagado.
function terminouSessao(mensagem = '') {
  apagarRascunho();
  mostrarEntrada(mensagem);
}

async function carregarSugestoes() {
  const r = await api('GET', '/v2/sugestoes');
  if (r.estado === 401) return terminouSessao(MENSAGEM_EXPIRADA);
  if (!r.ok) return mostrarMensagem(textoErro(r));
  sugestoes = r.dados.itens;
  desenharSugestoes();
}

function desenharSugestoes() {
  const ordenacao = lerConfiguracoes().ordenacao;
  const lista = [...sugestoes].sort((a, b) => {
    const maisRecente = b.dataCriacao.localeCompare(a.dataCriacao);
    if (ordenacao === 'estado') {
      return ORDEM_ESTADOS.indexOf(a.estado) - ORDEM_ESTADOS.indexOf(b.estado) || maisRecente;
    }
    return maisRecente;
  });
  const ul = $('lista-sugestoes');
  ul.replaceChildren();
  if (sessao === null) return;
  if (lista.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Sem sugestões para mostrar.';
    ul.append(li);
    return;
  }
  for (const s of lista) {
    const li = document.createElement('li');
    const titulo = document.createElement('strong');
    titulo.textContent = s.titulo;
    const detalhe = document.createElement('small');
    detalhe.textContent = `Categoria: ${s.categoria} · Estado: ${s.estado.replace('_', ' ')} · Aluno: ${s.numeroAluno}`;
    li.append(titulo, detalhe);
    ul.append(li);
  }
}

// ---------- Eventos ----------
$('cfg-tema').addEventListener('change', aoAlterarConfiguracao);
$('cfg-ordenacao').addEventListener('change', aoAlterarConfiguracao);

$('form-entrada').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarMensagem('');
  const r = await api('POST', '/v2/sessao', {
    utilizador: $('utilizador').value.trim(),
    palavraPasse: $('palavraPasse').value,
  });
  if (!r.ok) return mostrarMensagem(textoErro(r));
  $('palavraPasse').value = '';
  sessao = r.dados;
  await mostrarSessao();
});

$('btn-sugestoes').addEventListener('click', () => {
  mostrarMensagem('');
  carregarSugestoes();
});

$('btn-terminar').addEventListener('click', async () => {
  await api('DELETE', '/v2/sessao');
  terminouSessao();
});

$('form-nova').addEventListener('input', guardarRascunho);

$('form-nova').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mostrarMensagem('');
  const r = await api('POST', '/v2/sugestoes', {
    titulo: $('titulo').value.trim(),
    descricao: $('descricao').value.trim(),
    categoria: $('categoria').value,
  });
  if (r.estado === 401) return terminouSessao(MENSAGEM_EXPIRADA);
  if (!r.ok) return mostrarMensagem(textoErro(r));
  apagarRascunho();
  await carregarSugestoes();
});

// ---------- Arranque ----------
aplicarConfiguracoes(lerConfiguracoes());
const inicial = await api('GET', '/v2/sessao');
if (inicial.ok) {
  sessao = inicial.dados;
  await mostrarSessao();
} else if (inicial.estado === 401) {
  mostrarEntrada();
} else {
  mostrarEntrada(textoErro(inicial));
}
