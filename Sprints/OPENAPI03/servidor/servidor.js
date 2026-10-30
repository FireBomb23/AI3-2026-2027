import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  enviarErro, validarCredenciais, autenticar, emitirToken, exigirToken, exigirPapel, sessaoDe, sessaoDoToken, VALIDADE,
} from './autenticacao.js';

const sugestoes = JSON.parse(readFileSync(new URL('./dados/sugestoes.json', import.meta.url), 'utf8'));
const contrato = readFileSync(new URL('../sugestoes.openapi.yaml', import.meta.url));
const CATEGORIAS = ['instalacoes', 'ensino', 'servicos', 'atividades', 'outra'];
const PORTA = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
app.set('etag', false);
app.use(express.json());

// POST /v2/tokens (criarToken)
app.post('/v2/tokens', async (req, res, next) => {
  try {
    const detalhes = validarCredenciais(req.body);
    if (detalhes.length > 0) return enviarErro(res, 400, 'Credenciais mal formadas.', detalhes);
    const utilizador = await autenticar(req.body);
    if (!utilizador) return enviarErro(res, 401, 'Utilizador ou palavra-passe incorretos.');
    res.set('Cache-Control', 'no-store').json(emitirToken(utilizador));
  } catch (erro) {
    next(erro);
  }
});

// GET /v2/sugestoes (listarSugestoes): um aluno vê só as suas, os serviços veem todas
app.get('/v2/sugestoes', exigirToken, (req, res) => {
  const visiveis = req.utilizador.papel === 'servicos'
    ? sugestoes
    : sugestoes.filter((s) => s.numeroAluno === req.utilizador.sub);
  res.set('Cache-Control', 'private, no-cache').json({
    pagina: 1,
    tamanhoPagina: 20,
    total: visiveis.length,
    itens: visiveis.slice(0, 20),
  });
});

// ---------- Sessão por cookie ----------
// POST /v2/sessao (criarSessao): verifica as credenciais como /tokens e guarda o token num cookie
app.post('/v2/sessao', async (req, res, next) => {
  try {
    const detalhes = validarCredenciais(req.body);
    if (detalhes.length > 0) return enviarErro(res, 400, 'Credenciais mal formadas.', detalhes);
    const utilizador = await autenticar(req.body);
    if (!utilizador) return enviarErro(res, 401, 'Utilizador ou palavra-passe incorretos.');
    const { token } = emitirToken(utilizador);
    // O maxAge do Express é em MILISSEGUNDOS (VALIDADE está em segundos).
    res.cookie('sessao', token, { httpOnly: true, sameSite: 'strict', path: '/v2', maxAge: VALIDADE * 1000 });
    res.set('Cache-Control', 'no-store').json(sessaoDoToken(token));
  } catch (erro) {
    next(erro);
  }
});

// GET /v2/sessao (obterSessao)
app.get('/v2/sessao', exigirToken, (req, res) => {
  res.set('Cache-Control', 'no-store').json(sessaoDe(req.utilizador));
});

// DELETE /v2/sessao (terminarSessao): pede ao browser que apague o cookie (o token não é revogado)
app.delete('/v2/sessao', (req, res) => {
  res.clearCookie('sessao', { path: '/v2' });
  res.set('Cache-Control', 'no-store').status(204).end();
});

// POST /v2/sugestoes (criarSugestao): só alunos; as novas sugestões ficam apenas em memória
function validarSugestaoNova(corpo) {
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return [{ campo: 'corpo', problema: 'Esperado um objeto JSON' }];
  }
  const detalhes = [];
  const texto = (campo, min, max) => {
    const v = corpo[campo];
    if (typeof v !== 'string' || v.length < min || v.length > max) {
      detalhes.push({ campo, problema: `Texto com ${min} a ${max} caracteres` });
    }
  };
  texto('titulo', 10, 120);
  texto('descricao', 20, 2000);
  if (!CATEGORIAS.includes(corpo.categoria)) detalhes.push({ campo: 'categoria', problema: 'Categoria desconhecida' });
  return detalhes;
}

app.post('/v2/sugestoes', exigirToken, exigirPapel('aluno'), (req, res) => {
  const detalhes = validarSugestaoNova(req.body);
  if (detalhes.length > 0) return enviarErro(res, 400, 'Sugestão inválida.', detalhes);
  const agora = new Date().toISOString();
  const sugestao = {
    titulo: req.body.titulo,
    descricao: req.body.descricao,
    categoria: req.body.categoria,
    id: Math.max(0, ...sugestoes.map((s) => s.id)) + 1,
    numeroAluno: req.utilizador.sub, // vem do token; qualquer numeroAluno do corpo é ignorado
    estado: 'submetida',
    dataCriacao: agora,
    dataAtualizacao: agora,
    dataResolucao: null,
  };
  sugestoes.push(sugestao);
  res.set({ Location: `/v2/sugestoes/${sugestao.id}`, 'Cache-Control': 'no-store' }).status(201).json(sugestao);
});

// Contrato publicado
app.get('/v2/openapi.yaml', (req, res) => {
  res.type('application/yaml').send(contrato);
});

app.use('/v2', (req, res) => enviarErro(res, 404, 'Recurso não encontrado.'));
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

// Tratamento de erros: JSON mal formado -> 400; qualquer outra exceção -> 500 (sem detalhes internos)
app.use((erro, req, res, next) => {
  if (erro.type === 'entity.parse.failed') {
    return enviarErro(res, 400, 'O corpo do pedido não é JSON válido.');
  }
  console.error(erro);
  enviarErro(res, 500, 'Erro interno do servidor.');
});

app.listen(PORTA, () => console.log(`Servidor em http://localhost:${PORTA}`));
