'use strict';

const CHAVE_RASCUNHO = 'rascunhoSugestao';
const ORDEM_ESTADOS = ['submetida', 'em_analise', 'aceite', 'rejeitada', 'resolvida'];
const $ = (id) => document.getElementById(id);

let sessao = null;
let sugestoes = [];

// ---------- Pedidos à API (o browser envia o cookie sozinho) ----------
async function api(metodo, url, corpo) {
  const opcoes = { method: metodo, headers: {} };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  const resp = await fetch(url, opcoes);
  const dados = resp.status === 204 ? null : await resp.json().catch(() => null);
  return { ok: resp.ok, estado: resp.status, dados };
}

function textoErro(r) {
  if (!r.dados || !r.dados.mensagem) return 'Não foi possível contactar o servidor.';
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
  } catch { /* sem sessionStorage */ }
}

function reporRascunho() {
  try {
    const r = JSON.parse(sessionStorage.getItem(CHAVE_RASCUNHO));
    if (!r || typeof r !== 'object') return;
    if (typeof r.titulo === 'string') $('titulo').value = r.titulo;
    if (typeof r.descricao === 'string') $('descricao').value = r.descricao;
    if (typeof r.categoria === 'string') $('categoria').value = r.categoria;
  } catch { /* rascunho inexistente ou inválido */ }
}

function apagarRascunho() {
  try { sessionStorage.removeItem(CHAVE_RASCUNHO); } catch { /* ignorar */ }
  $('form-nova').reset();
}

// ---------- Ecrãs ----------
function mostrarEntrada() {
  sessao = null;
  $('a-carregar').hidden = true;
  $('sessao').hidden = true;
  $('entrada').hidden = false;
}

function terminouSessao() {
  apagarRascunho();
  mostrarEntrada();
}

async function mostrarSessao() {
  $('a-carregar').hidden = true;
  $('entrada').hidden = true;
  $('sessao').hidden = false;
  $('dados-sessao').textContent =
    `${sessao.nome} (${sessao.papel === 'aluno' ? 'aluno' : 'serviços'}) · sessão válida até ` +
    new Date(sessao.expiracao).toLocaleTimeString('pt-PT');
  const ehAluno = sessao.papel === 'aluno';
  $('area-nova').hidden = !ehAluno;
  if (ehAluno) {
    await carregarCategorias();
    reporRascunho();
  }
  await carregarSugestoes();
}

async function carregarCategorias() {
  if ($('categoria').options.length) return;
  const r = await api('GET', '/v2/categorias');
  if (!r.ok) return;
  for (const c of r.dados) {
    const o = document.createElement('option');
    o.value = c.codigo;
    o.textContent = c.descricao;
    $('categoria').append(o);
  }
}

async function carregarSugestoes() {
  const r = await api('GET', '/v2/sugestoes?tamanhoPagina=50');
  if (r.estado === 401) return terminouSessao();
  sugestoes = r.ok ? r.dados.itens : [];
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
  const ul = $('lista');
  ul.replaceChildren();
  for (const s of lista) {
    const li = document.createElement('li');
    const titulo = document.createElement('strong');
    titulo.textContent = s.titulo;
    const meta = document.createElement('small');
    const estado = document.createElement('span');
    estado.className = 'estado';
    estado.textContent = s.estado.replace('_', ' ');
    meta.append(estado, ` · ${s.categoria} · aluno ${s.numeroAluno} · ${new Date(s.dataCriacao).toLocaleDateString('pt-PT')}`);
    const desc = document.createElement('div');
    desc.textContent = s.descricao;
    li.append(titulo, document.createElement('br'), meta, desc);
    ul.append(li);
  }
  $('lista-vazia').hidden = lista.length > 0;
}

// ---------- Eventos ----------
$('cfg-tema').addEventListener('change', aoAlterarConfiguracao);
$('cfg-ordenacao').addEventListener('change', aoAlterarConfiguracao);

$('form-entrada').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('erro-entrada').textContent = '';
  const r = await api('POST', '/v2/sessao', {
    utilizador: $('utilizador').value.trim(),
    palavraPasse: $('palavraPasse').value,
  });
  if (!r.ok) {
    $('erro-entrada').textContent = textoErro(r);
    return;
  }
  $('palavraPasse').value = '';
  sessao = r.dados;
  await mostrarSessao();
});

$('btn-terminar').addEventListener('click', async () => {
  await api('DELETE', '/v2/sessao');
  terminouSessao();
});

$('form-nova').addEventListener('input', guardarRascunho);

$('form-nova').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('erro-nova').textContent = '';
  const r = await api('POST', '/v2/sugestoes', {
    titulo: $('titulo').value.trim(),
    descricao: $('descricao').value.trim(),
    categoria: $('categoria').value,
  });
  if (r.estado === 401) return terminouSessao();
  if (!r.ok) {
    $('erro-nova').textContent = textoErro(r);
    return;
  }
  apagarRascunho();
  await carregarSugestoes();
});

// ---------- Arranque ----------
(async function iniciar() {
  aplicarConfiguracoes(lerConfiguracoes());
  const r = await api('GET', '/v2/sessao');
  if (r.ok) {
    sessao = r.dados;
    await mostrarSessao();
  } else {
    mostrarEntrada();
  }
})();
