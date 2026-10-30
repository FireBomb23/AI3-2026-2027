'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { lerCookie } = require('./cookies');

const SEGREDO = process.env.JWT_SECRET;
const PORTA = Number(process.env.PORT) || 3000;
const VALIDADE_S = 900; // 15 minutos, em segundos

if (!SEGREDO) {
  console.error('Falta JWT_SECRET. Crie o .env a partir de .env.exemplo.');
  process.exit(1);
}

// ---------- Dados em memória ----------
const ESTADOS = ['submetida', 'em_analise', 'aceite', 'rejeitada', 'resolvida'];
const TRANSICOES = {
  submetida: ['em_analise'],
  em_analise: ['aceite', 'rejeitada'],
  aceite: ['resolvida'],
  rejeitada: [],
  resolvida: [],
};
const CATEGORIAS = [
  { codigo: 'instalacoes', descricao: 'Instalações e equipamentos' },
  { codigo: 'ensino', descricao: 'Ensino e aprendizagem' },
  { codigo: 'servicos', descricao: 'Serviços e atendimento' },
  { codigo: 'atividades', descricao: 'Atividades e eventos' },
  { codigo: 'outra', descricao: 'Outra categoria' },
];
const CODIGOS = CATEGORIAS.map((c) => c.codigo);

// Utilizadores de teste (substituir pelos da API02, se forem outros).
const UTILIZADORES = [
  { utilizador: '20261234', nome: 'Ana Lopes', papel: 'aluno', palavraPasse: 'ana12345' },
  { utilizador: '20265678', nome: 'Bruno Costa', papel: 'aluno', palavraPasse: 'bruno1234' },
  { utilizador: 'maria.silva', nome: 'Maria Silva', papel: 'servicos', palavraPasse: 'servicos123' },
].map((u) => ({
  utilizador: u.utilizador,
  nome: u.nome,
  papel: u.papel,
  hash: bcrypt.hashSync(u.palavraPasse, 10),
}));
const HASH_FALSO = bcrypt.hashSync('nao-existe', 10);

const sugestoes = [
  { id: 1, titulo: 'Mais tomadas na biblioteca', descricao: 'Seria útil haver mais tomadas junto das mesas de estudo da biblioteca.', categoria: 'instalacoes', numeroAluno: '20261234', estado: 'submetida', dataCriacao: '2026-10-09T14:30:00.000Z', dataAtualizacao: '2026-10-09T14:30:00.000Z', dataResolucao: null },
  { id: 2, titulo: 'Horário alargado do bar', descricao: 'O bar fecha cedo demais nos dias com aulas à tarde, o que obriga a sair do campus.', categoria: 'servicos', numeroAluno: '20265678', estado: 'em_analise', dataCriacao: '2026-10-10T09:00:00.000Z', dataAtualizacao: '2026-10-12T09:15:00.000Z', dataResolucao: null },
  { id: 3, titulo: 'Wi-Fi instável no bloco B', descricao: 'A ligação à rede cai muitas vezes durante as aulas práticas no bloco B.', categoria: 'instalacoes', numeroAluno: '20261234', estado: 'resolvida', dataCriacao: '2026-10-01T10:00:00.000Z', dataAtualizacao: '2026-10-20T16:00:00.000Z', dataResolucao: '2026-10-20T16:00:00.000Z' },
];
let proximoId = 4;
let proximoAcompanhamento = 1;
const acompanhamentos = [];

// ---------- Utilitários ----------
function enviarErro(res, codigo, mensagem, detalhes) {
  const corpo = { codigo, mensagem };
  if (detalhes && detalhes.length) corpo.detalhes = detalhes;
  res.set('Cache-Control', 'no-store').status(codigo).json(corpo);
}

function etagDe(obj) {
  return '"' + crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16) + '"';
}

function inteiro(valor, omissao, min, max) {
  if (valor === undefined) return omissao;
  if (typeof valor !== 'string' || !/^[0-9]+$/.test(valor)) return null;
  const n = Number(valor);
  return n >= min && n <= max ? n : null;
}

function validarCredenciais(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return [{ campo: 'corpo', problema: 'Esperado um objeto JSON' }];
  }
  const d = [];
  if (typeof c.utilizador !== 'string' || !/^([0-9]{5,8}|[a-z]+\.[a-z]+)$/.test(c.utilizador)) {
    d.push({ campo: 'utilizador', problema: 'Número de aluno (5 a 8 algarismos) ou nome.apelido' });
  }
  if (typeof c.palavraPasse !== 'string' || c.palavraPasse.length < 8 || c.palavraPasse.length > 128) {
    d.push({ campo: 'palavraPasse', problema: 'Texto com 8 a 128 caracteres' });
  }
  return d;
}

function validarSugestaoNova(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return [{ campo: 'corpo', problema: 'Esperado um objeto JSON' }];
  }
  const d = [];
  const texto = (campo, min, max) => {
    const v = b[campo];
    if (typeof v !== 'string' || v.length < min || v.length > max) {
      d.push({ campo, problema: `Texto com ${min} a ${max} caracteres` });
    }
  };
  texto('titulo', 10, 120);
  texto('descricao', 20, 2000);
  if (!CODIGOS.includes(b.categoria)) d.push({ campo: 'categoria', problema: 'Categoria desconhecida' });
  return d;
}

// Verifica utilizador e palavra-passe. Em caso de falha, já respondeu e devolve null.
function verificarCredenciais(req, res) {
  const detalhes = validarCredenciais(req.body);
  if (detalhes.length) {
    enviarErro(res, 400, 'Credenciais mal formadas.', detalhes);
    return null;
  }
  const u = UTILIZADORES.find((x) => x.utilizador === req.body.utilizador);
  // Compara sempre, para a resposta demorar o mesmo com utilizador inexistente.
  const ok = bcrypt.compareSync(req.body.palavraPasse, u ? u.hash : HASH_FALSO);
  if (!u || !ok) {
    enviarErro(res, 401, 'Utilizador ou palavra-passe incorretos.');
    return null;
  }
  return u;
}

function criarToken(u) {
  return jwt.sign({ nome: u.nome, papel: u.papel }, SEGREDO, {
    algorithm: 'HS256',
    subject: u.utilizador,
    expiresIn: VALIDADE_S,
  });
}

const sessaoDe = (id) => ({
  utilizador: id.sub,
  nome: id.nome,
  papel: id.papel,
  expiracao: new Date(id.exp * 1000).toISOString(),
});

// Aceita o token no cabeçalho Authorization ou, se este não existir, no cookie `sessao`.
function exigirToken(...papeis) {
  return (req, res, next) => {
    const auth = req.get('Authorization');
    let token;
    if (auth !== undefined) {
      const m = /^Bearer (\S+)$/.exec(auth);
      token = m ? m[1] : null;
    } else {
      token = lerCookie(req, 'sessao');
    }
    if (!token) {
      res.set('WWW-Authenticate', 'Bearer');
      return enviarErro(res, 401, 'Token ausente, inválido ou expirado.');
    }
    try {
      req.identidade = jwt.verify(token, SEGREDO, { algorithms: ['HS256'] });
    } catch {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return enviarErro(res, 401, 'Token ausente, inválido ou expirado.');
    }
    if (papeis.length && !papeis.includes(req.identidade.papel)) {
      return enviarErro(res, 403, 'O seu papel não permite esta operação.');
    }
    next();
  };
}

// Um aluno só vê as suas sugestões; para as dos outros, a resposta é 404.
function obterAcessivel(req, res) {
  if (!/^[0-9]+$/.test(req.params.id) || Number(req.params.id) < 1) {
    enviarErro(res, 400, 'Identificador inválido.', [{ campo: 'id', problema: 'Inteiro maior ou igual a 1' }]);
    return null;
  }
  const s = sugestoes.find((x) => x.id === Number(req.params.id));
  if (!s || (req.identidade.papel === 'aluno' && s.numeroAluno !== req.identidade.sub)) {
    enviarErro(res, 404, 'Sugestão não encontrada.');
    return null;
  }
  return s;
}

function lerAnoLetivo(req, res) {
  const a = req.query.anoLetivo;
  const m = /^([0-9]{4})-([0-9]{4})$/.exec(typeof a === 'string' ? a : '');
  if (!m || Number(m[2]) !== Number(m[1]) + 1) {
    enviarErro(res, 400, 'Ano letivo inválido.', [{ campo: 'anoLetivo', problema: 'Forma AAAA-AAAA, com anos consecutivos' }]);
    return null;
  }
  const inicio = new Date(Date.UTC(Number(m[1]), 8, 1));
  const fim = new Date(Date.UTC(Number(m[2]), 8, 1));
  return { anoLetivo: a, doAno: sugestoes.filter((s) => { const d = new Date(s.dataCriacao); return d >= inicio && d < fim; }) };
}

const arredondar = (n) => Math.round(n * 100) / 100;

// ---------- Rotas ----------
const app = express();
app.disable('x-powered-by');
app.set('etag', false);

const api = express.Router();

// Públicas
api.post('/tokens', (req, res) => {
  const u = verificarCredenciais(req, res);
  if (!u) return;
  res.set('Cache-Control', 'no-store').json({ token: criarToken(u), tipo: 'Bearer', expiraEm: VALIDADE_S });
});

api.get('/categorias', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400').json(CATEGORIAS);
});

api.get('/estatisticas/resolucao', (req, res) => {
  const a = lerAnoLetivo(req, res);
  if (!a) return;
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, a.doAno.filter((s) => s.estado === e).length]));
  const resolvidas = a.doAno.filter((s) => s.dataResolucao);
  const dias = resolvidas.map((s) => (new Date(s.dataResolucao) - new Date(s.dataCriacao)) / 86400000);
  res.set('Cache-Control', 'public, max-age=3600').json({
    anoLetivo: a.anoLetivo,
    totalSugestoes: a.doAno.length,
    porEstado,
    taxaResolucao: a.doAno.length ? arredondar(resolvidas.length / a.doAno.length) : 0,
    tempoMedioResolucaoDias: dias.length ? arredondar(dias.reduce((x, y) => x + y, 0) / dias.length) : null,
  });
});

api.get('/estatisticas/categorias', (req, res) => {
  const a = lerAnoLetivo(req, res);
  if (!a) return;
  const categorias = CODIGOS.map((c) => {
    const doGrupo = a.doAno.filter((s) => s.categoria === c);
    const resolvidas = doGrupo.filter((s) => s.estado === 'resolvida').length;
    return { categoria: c, total: doGrupo.length, resolvidas, taxaResolucao: doGrupo.length ? arredondar(resolvidas / doGrupo.length) : 0 };
  });
  res.set('Cache-Control', 'public, max-age=3600').json({ anoLetivo: a.anoLetivo, categorias });
});

// Sessão por cookie
api.post('/sessao', (req, res) => {
  const u = verificarCredenciais(req, res);
  if (!u) return;
  const token = criarToken(u);
  // maxAge do Express é em MILISSEGUNDOS (por isso VALIDADE_S * 1000).
  res.cookie('sessao', token, { httpOnly: true, sameSite: 'strict', path: '/v2', maxAge: VALIDADE_S * 1000 });
  res.set('Cache-Control', 'no-store').status(200).json(sessaoDe(jwt.decode(token)));
});

api.get('/sessao', exigirToken(), (req, res) => {
  res.set('Cache-Control', 'no-store').json(sessaoDe(req.identidade));
});

api.delete('/sessao', (req, res) => {
  res.clearCookie('sessao', { path: '/v2' });
  res.set('Cache-Control', 'no-store').status(204).end();
});

// Sugestões
api.get('/sugestoes', exigirToken('aluno', 'servicos'), (req, res) => {
  const { estado, categoria } = req.query;
  const detalhes = [];
  if (estado !== undefined && !ESTADOS.includes(estado)) detalhes.push({ campo: 'estado', problema: 'Estado desconhecido' });
  if (categoria !== undefined && !CODIGOS.includes(categoria)) detalhes.push({ campo: 'categoria', problema: 'Categoria desconhecida' });
  const pagina = inteiro(req.query.pagina, 1, 1, Infinity);
  const tamanhoPagina = inteiro(req.query.tamanhoPagina, 10, 1, 50);
  if (pagina === null) detalhes.push({ campo: 'pagina', problema: 'Inteiro maior ou igual a 1' });
  if (tamanhoPagina === null) detalhes.push({ campo: 'tamanhoPagina', problema: 'Inteiro entre 1 e 50' });
  if (detalhes.length) return enviarErro(res, 400, 'Parâmetros inválidos.', detalhes);

  const visiveis = sugestoes.filter((s) =>
    (req.identidade.papel === 'servicos' || s.numeroAluno === req.identidade.sub) &&
    (estado === undefined || s.estado === estado) &&
    (categoria === undefined || s.categoria === categoria));
  const itens = visiveis.slice((pagina - 1) * tamanhoPagina, pagina * tamanhoPagina);
  res.set('Cache-Control', 'private, no-cache').json({ pagina, tamanhoPagina, total: visiveis.length, itens });
});

api.post('/sugestoes', exigirToken('aluno'), (req, res) => {
  const detalhes = validarSugestaoNova(req.body);
  if (detalhes.length) return enviarErro(res, 400, 'Sugestão inválida.', detalhes);
  const agora = new Date().toISOString();
  const s = {
    id: proximoId++,
    titulo: req.body.titulo,
    descricao: req.body.descricao,
    categoria: req.body.categoria,
    numeroAluno: req.identidade.sub, // vem sempre do token, nunca do corpo
    estado: 'submetida',
    dataCriacao: agora,
    dataAtualizacao: agora,
    dataResolucao: null,
  };
  sugestoes.push(s);
  res.set({ Location: `/v2/sugestoes/${s.id}`, 'Cache-Control': 'no-store' }).status(201).json(s);
});

api.get('/sugestoes/:id', exigirToken('aluno', 'servicos'), (req, res) => {
  const s = obterAcessivel(req, res);
  if (!s) return;
  const etag = etagDe(s);
  res.set({ ETag: etag, 'Cache-Control': 'private, no-cache' });
  if (req.get('If-None-Match') === etag) return res.status(304).end();
  res.json(s);
});

api.put('/sugestoes/:id', exigirToken('aluno'), (req, res) => {
  const s = obterAcessivel(req, res);
  if (!s) return;
  const ifMatch = req.get('If-Match');
  if (!ifMatch) return enviarErro(res, 400, 'Falta o cabeçalho If-Match.', [{ campo: 'If-Match', problema: 'Obrigatório' }]);
  const detalhes = validarSugestaoNova(req.body);
  if (detalhes.length) return enviarErro(res, 400, 'Sugestão inválida.', detalhes);
  if (s.estado !== 'submetida') return enviarErro(res, 409, 'Só uma sugestão submetida pode ser editada.');
  if (ifMatch !== '*' && ifMatch !== etagDe(s)) return enviarErro(res, 412, 'A sugestão foi alterada entretanto.');
  s.titulo = req.body.titulo;
  s.descricao = req.body.descricao;
  s.categoria = req.body.categoria;
  s.dataAtualizacao = new Date().toISOString();
  res.set({ ETag: etagDe(s), 'Cache-Control': 'no-store' }).json(s);
});

api.delete('/sugestoes/:id', exigirToken('aluno'), (req, res) => {
  const s = obterAcessivel(req, res);
  if (!s) return;
  if (s.estado !== 'submetida') return enviarErro(res, 409, 'Só uma sugestão submetida pode ser retirada.');
  sugestoes.splice(sugestoes.indexOf(s), 1);
  res.set('Cache-Control', 'no-store').status(204).end();
});

api.post('/sugestoes/:id/acompanhamentos', exigirToken('servicos'), (req, res) => {
  const s = obterAcessivel(req, res);
  if (!s) return;
  const b = req.body;
  const detalhes = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    detalhes.push({ campo: 'corpo', problema: 'Esperado um objeto JSON' });
  } else {
    if (!ESTADOS.includes(b.novoEstado)) detalhes.push({ campo: 'novoEstado', problema: 'Estado desconhecido' });
    if (typeof b.nota !== 'string' || b.nota.length < 5 || b.nota.length > 500) detalhes.push({ campo: 'nota', problema: 'Texto com 5 a 500 caracteres' });
  }
  if (detalhes.length) return enviarErro(res, 400, 'Acompanhamento inválido.', detalhes);
  if (!TRANSICOES[s.estado].includes(b.novoEstado)) return enviarErro(res, 409, 'Transição de estado não permitida.');
  const agora = new Date().toISOString();
  const a = { id: proximoAcompanhamento++, novoEstado: b.novoEstado, nota: b.nota, responsavel: req.identidade.nome, estadoAnterior: s.estado, data: agora };
  acompanhamentos.push({ sugestaoId: s.id, ...a });
  s.estado = b.novoEstado;
  s.dataAtualizacao = agora;
  if (b.novoEstado === 'resolvida') s.dataResolucao = agora;
  res.set('Cache-Control', 'no-store').status(201).json(a);
});

api.use((req, res) => enviarErro(res, 404, 'Recurso não encontrado.'));

app.use('/v2', express.json({ limit: '100kb' }), api);
app.use('/v2', (err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return enviarErro(res, 400, 'O corpo do pedido não é JSON válido.');
  }
  console.error(err);
  enviarErro(res, 500, 'Erro interno do servidor.');
});

// Cliente (ficheiros estáticos)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORTA, () => console.log(`Servidor em http://localhost:${PORTA}`));
