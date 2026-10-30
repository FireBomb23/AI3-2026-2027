import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { lerCookie } from './cookies.js';

// ---------- Configuração (o servidor não arranca se for inválida) ----------
const SEGREDO = process.env.JWT_SEGREDO;
if (!SEGREDO || SEGREDO.length < 32) {
  console.error('Erro: defina JWT_SEGREDO no ficheiro .env com pelo menos 32 caracteres aleatórios (ver .env.exemplo).');
  process.exit(1);
}
export const VALIDADE = process.env.JWT_VALIDADE === undefined ? 900 : Number(process.env.JWT_VALIDADE);
if (!Number.isInteger(VALIDADE) || VALIDADE < 1) {
  console.error('Erro: JWT_VALIDADE tem de ser um número inteiro positivo de segundos.');
  process.exit(1);
}

const utilizadores = JSON.parse(readFileSync(new URL('./dados/utilizadores.json', import.meta.url), 'utf8'));
// Hash fixo, usado quando o utilizador não existe, para o tempo de resposta não o revelar.
const HASH_FIXO = bcrypt.hashSync('palavra-passe-que-ninguem-usa', 10);

// ---------- Erros ----------
export function enviarErro(res, codigo, mensagem, detalhes) {
  const corpo = { codigo, mensagem };
  if (detalhes && detalhes.length > 0) corpo.detalhes = detalhes;
  res.set('Cache-Control', 'no-store').status(codigo).json(corpo);
}

// ---------- Credenciais e emissão de tokens ----------
export function validarCredenciais(corpo) {
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return [{ campo: 'corpo', problema: 'Esperado um objeto JSON' }];
  }
  const detalhes = [];
  if (typeof corpo.utilizador !== 'string' || !/^([0-9]{5,8}|[a-z]+\.[a-z]+)$/.test(corpo.utilizador)) {
    detalhes.push({ campo: 'utilizador', problema: 'Número de aluno (5 a 8 algarismos) ou identificador nome.apelido' });
  }
  if (typeof corpo.palavraPasse !== 'string' || corpo.palavraPasse.length < 8 || corpo.palavraPasse.length > 128) {
    detalhes.push({ campo: 'palavraPasse', problema: 'Texto com 8 a 128 caracteres' });
  }
  return detalhes;
}

// Devolve o utilizador se as credenciais estiverem certas, ou null.
export async function autenticar({ utilizador, palavraPasse }) {
  const u = utilizadores.find((x) => x.utilizador === utilizador);
  // A comparação faz-se sempre, exista ou não o utilizador.
  const correta = await bcrypt.compare(palavraPasse, u ? u.hashPalavraPasse : HASH_FIXO);
  return u && correta ? u : null;
}

export function emitirToken(u) {
  const token = jwt.sign({ nome: u.nome, papel: u.papel }, SEGREDO, {
    algorithm: 'HS256',
    subject: u.utilizador,
    expiresIn: VALIDADE,
  });
  return { token, tipo: 'Bearer', expiraEm: VALIDADE };
}

export function sessaoDe(p) {
  return { utilizador: p.sub, nome: p.nome, papel: p.papel, expiracao: new Date(p.exp * 1000).toISOString() };
}

export function sessaoDoToken(token) {
  return sessaoDe(jwt.decode(token));
}

// ---------- Middleware ----------
// O token vem do cabeçalho Authorization ou, se este não existir, do cookie `sessao`.
export function exigirToken(req, res, next) {
  const cabecalho = req.get('Authorization');
  let token;
  if (cabecalho !== undefined) {
    const m = /^Bearer (\S+)$/.exec(cabecalho);
    token = m ? m[1] : null;
  } else {
    token = lerCookie(req, 'sessao');
  }
  if (!token) {
    res.set('WWW-Authenticate', 'Bearer');
    return enviarErro(res, 401, 'Token ausente, inválido ou expirado.');
  }
  try {
    // algorithms: só HS256 é aceite (exclui "none" e qualquer outro algoritmo).
    // A assinatura e o claim exp são verificados por omissão.
    const p = jwt.verify(token, SEGREDO, { algorithms: ['HS256'] });
    req.utilizador = { sub: p.sub, nome: p.nome, papel: p.papel, exp: p.exp };
    next();
  } catch {
    res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
    enviarErro(res, 401, 'Token ausente, inválido ou expirado.');
  }
}

export function exigirPapel(papel) {
  return (req, res, next) => {
    if (req.utilizador.papel !== papel) {
      return enviarErro(res, 403, 'O seu papel não permite esta operação.');
    }
    next();
  };
}
