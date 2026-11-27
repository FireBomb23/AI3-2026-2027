const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { distanciaEmMetros } = require('./geo.js');

const app = express();
const PORTO = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'trocar-por-token-admin';
const FICHEIRO_DADOS = path.join(__dirname, 'dados.json');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CATEGORIAS = [
  {
    codigo: 'buraco',
    nome: 'Buraco na via',
    exemplos: 'buraco, abatimento do pavimento, tampa de esgoto solta',
    raio: 15,
  },
  {
    codigo: 'semaforo',
    nome: 'Semáforo avariado',
    exemplos: 'semáforo apagado, intermitente ou fora de tempo',
    raio: 40,
  },
  {
    codigo: 'iluminacao',
    nome: 'Iluminação pública',
    exemplos: 'candeeiro apagado ou intermitente',
    raio: 20,
  },
  {
    codigo: 'sinalizacao',
    nome: 'Sinalização de trânsito',
    exemplos: 'sinal caído, rodado ou ilegível',
    raio: 20,
  },
  {
    codigo: 'outro',
    nome: 'Outro problema',
    exemplos: 'qualquer outro problema na via pública',
    raio: 10,
  },
];

const CODIGOS_CATEGORIA = new Set(CATEGORIAS.map((c) => c.codigo));
const ESTADOS_VALIDOS = new Set(['aberta', 'em-resolucao', 'resolvida']);

// Estruturas de dados em memória
const ocorrencias = new Map();
const fotografias = new Map();
const idempotencia = new Map();
let contadorVersao = 0;

// Simulação de falhas
let simulacoes503 = Number(process.env.SIMULAR_503) || 0;

// Carregar dados persistidos no arranque
function carregarDados() {
  try {
    if (fs.existsSync(FICHEIRO_DADOS)) {
      const conteudo = fs.readFileSync(FICHEIRO_DADOS, 'utf-8');
      const dados = JSON.parse(conteudo);
      contadorVersao = Number(dados.versao) || 0;
      if (Array.isArray(dados.ocorrencias)) {
        for (const occ of dados.ocorrencias) {
          ocorrencias.set(occ.id, occ);
        }
      }
      if (Array.isArray(dados.fotografias)) {
        for (const [id, foto] of dados.fotografias) {
          fotografias.set(id, foto);
        }
      }
    }
  } catch (err) {
    console.error('Aviso: Não foi possível carregar dados.json:', err.message);
  }
}

function guardarDados() {
  try {
    const dados = {
      versao: contadorVersao,
      ocorrencias: Array.from(ocorrencias.values()),
      fotografias: Array.from(fotografias.entries()),
    };
    fs.writeFileSync(FICHEIRO_DADOS, JSON.stringify(dados, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao persistir dados.json:', err.message);
  }
}

carregarDados();

// Sanitiza a ocorrência para cumprir estritamente o esquema OpenAPI (sem expor cidadaos)
function sanitizarOcorrencia(occ) {
  return {
    id: occ.id,
    categoria: occ.categoria,
    descricao: occ.descricao,
    localizacao: {
      lat: occ.localizacao.lat,
      lng: occ.localizacao.lng,
      precisao: occ.localizacao.precisao !== undefined ? occ.localizacao.precisao : 0,
    },
    temFotografia: Boolean(occ.temFotografia),
    estado: occ.estado,
    comunicacoes: occ.comunicacoes,
    criadaEm: occ.criadaEm,
    atualizadaEm: occ.atualizadaEm,
    versao: occ.versao,
  };
}

// Função pura para procurar semelhantes (usa distanciaEmMetros de geo.js)
function procurarSemelhantes(categoria, localizacao, excluir = [], listaOcorrencias = Array.from(ocorrencias.values())) {
  const cat = CATEGORIAS.find((c) => c.codigo === categoria);
  if (!cat) return [];
  const raioMaximo = cat.raio;
  const excluirSet = new Set((excluir || []).map(String));

  const candidatas = [];
  for (const occ of listaOcorrencias) {
    if (occ.categoria !== categoria) continue;
    if (occ.estado === 'resolvida') continue;
    if (excluirSet.has(String(occ.id))) continue;

    const dist = distanciaEmMetros(occ.localizacao, localizacao);
    if (dist <= raioMaximo) {
      candidatas.push({ ocorrencia: occ, distancia: dist });
    }
  }

  return candidatas.sort((a, b) => a.distancia - b.distancia);
}

// Canonicalização de corpo para comparação semântica estrita
function canonicalizar(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(canonicalizar);
  const ordenado = {};
  for (const chave of Object.keys(obj).sort()) {
    ordenado[chave] = canonicalizar(obj[chave]);
  }
  return ordenado;
}

// Middlewares globais
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware para simulação de 503
app.use((req, res, next) => {
  if (simulacoes503 > 0) {
    simulacoes503 -= 1;
    return res.set({
      'Retry-After': '2',
      'Cache-Control': 'no-store',
    }).status(503).json({
      erro: 'Serviço temporariamente indisponível.',
      codigo: 'SERVICO_INDISPONIVEL',
    });
  }
  next();
});

// Middleware para validar X-Cidadao nas rotas protegidas do cidadão
function exigirCidadao(req, res, next) {
  const cidadao = req.headers['x-cidadao'];
  if (!cidadao || !UUID_REGEX.test(cidadao)) {
    return res.set('Cache-Control', 'no-store').status(401).json({
      erro: 'Identificação do cidadão (X-Cidadao) ausente ou inválida.',
      codigo: 'NAO_AUTENTICADO',
    });
  }
  req.cidadao = cidadao;
  next();
}

// Middleware de verificação prévia de Idempotency-Key
function verificarIdempotencia(req, res, next) {
  const chave = req.headers['idempotency-key'];
  if (!chave) {
    return next();
  }

  if (!UUID_REGEX.test(chave)) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'O cabeçalho Idempotency-Key deve ser um UUID válido.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  const cidadao = req.cidadao;
  if (!idempotencia.has(cidadao)) {
    idempotencia.set(cidadao, new Map());
  }

  const mapaCidadao = idempotencia.get(cidadao);
  const agora = Date.now();

  // Limpeza de registos expirados (> 24 h)
  for (const [k, v] of mapaCidadao.entries()) {
    if (agora - v.timestamp > 24 * 60 * 60 * 1000) {
      mapaCidadao.delete(k);
    }
  }

  if (mapaCidadao.has(chave)) {
    const registo = mapaCidadao.get(chave);
    const corpoAtualCanonico = JSON.stringify(canonicalizar(req.body || {}));

    if (corpoAtualCanonico === registo.corpoCanonico) {
      const headers = {
        'Cache-Control': 'no-store',
        'Idempotent-Replayed': 'true',
      };
      if (registo.location) {
        headers.Location = registo.location;
      }
      return res.set(headers).status(registo.status).json(registo.resposta);
    }

    return res.set('Cache-Control', 'no-store').status(409).json({
      erro: 'Idempotency-Key já utilizada anteriormente com corpo diferente.',
      codigo: 'CONFLITO_IDEMPOTENCIA',
    });
  }

  next();
}

// Gravação de idempotência e simulação de perda de resposta
function concluirPedidoIdempotente(req, res, status, resposta, location = null) {
  const chave = req.headers['idempotency-key'];
  const cidadao = req.cidadao;

  if (chave && cidadao) {
    let mapaCidadao = idempotencia.get(cidadao);
    if (!mapaCidadao) {
      mapaCidadao = new Map();
      idempotencia.set(cidadao, mapaCidadao);
    }

    mapaCidadao.set(chave, {
      timestamp: Date.now(),
      corpoCanonico: JSON.stringify(canonicalizar(req.body || {})),
      status,
      resposta,
      location,
      perdaSimulada: false,
    });

    if (process.env.SIMULAR_PERDA_RESPOSTA === '1') {
      const reg = mapaCidadao.get(chave);
      if (!reg.perdaSimulada) {
        reg.perdaSimulada = true;
        return req.socket.destroy();
      }
    }
  }

  const headers = { 'Cache-Control': 'no-store' };
  if (location) headers.Location = location;
  return res.set(headers).status(status).json(resposta);
}

// 1. GET /v1/categorias
app.get('/v1/categorias', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400').status(200).json(CATEGORIAS);
});

// 2. GET /v1/ocorrencias/semelhantes
app.get('/v1/ocorrencias/semelhantes', (req, res) => {
  const { categoria, lat, lng } = req.query;

  if (!categoria || !CODIGOS_CATEGORIA.has(categoria)) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Categoria inválida ou não suportada.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || numLat < -90 || numLat > 90 || isNaN(numLng) || numLng < -180 || numLng > 180) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Coordenadas geográficas inválidas.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  const semelhantes = procurarSemelhantes(categoria, { lat: numLat, lng: numLng }, []);
  const candidatas = semelhantes.slice(0, 5).map((item) => ({
    ocorrencia: sanitizarOcorrencia(item.ocorrencia),
    distancia: item.distancia,
  }));

  res.set('Cache-Control', 'no-store').status(200).json({ candidatas });
});

// 3. GET /v1/ocorrencias (mapa / bbox)
app.get('/v1/ocorrencias', (req, res) => {
  const { bbox } = req.query;
  const BBOX_REGEX = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

  if (!bbox || !BBOX_REGEX.test(bbox)) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Parâmetro bbox ausente ou em formato inválido (minLng,minLat,maxLng,maxLat).',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
  const resultado = [];

  for (const occ of ocorrencias.values()) {
    if (occ.estado === 'resolvida') continue;
    const { lat, lng } = occ.localizacao;
    if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
      resultado.push(sanitizarOcorrencia(occ));
    }
  }

  res.set('Cache-Control', 'no-store').status(200).json(resultado);
});

// 4. POST /v1/ocorrencias (criar ou reforçar com deteção de duplicados)
app.post('/v1/ocorrencias', exigirCidadao, verificarIdempotencia, (req, res) => {
  const { categoria, descricao, localizacao, fotografia, recusadas } = req.body || {};

  // Validação de categoria
  if (!categoria || !CODIGOS_CATEGORIA.has(categoria)) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Categoria inválida ou não suportada.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  // Validação de descrição (10 a 500 caracteres)
  if (typeof descricao !== 'string' || descricao.length < 10 || descricao.length > 500) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'A descrição deve ter entre 10 e 500 caracteres.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  // Validação de localização
  if (!localizacao || typeof localizacao !== 'object') {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Objeto de localização obrigatório.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  const lat = Number(localizacao.lat);
  const lng = Number(localizacao.lng);
  if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Latitude ou longitude inválidas.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  const precisao = localizacao.precisao !== undefined ? Number(localizacao.precisao) : 0;
  if (isNaN(precisao) || precisao < 0) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Precisão de localização inválida.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  // Validação de fotografia (data URL JPEG até 300 KB)
  if (fotografia !== undefined && fotografia !== null) {
    if (typeof fotografia !== 'string' || !fotografia.startsWith('data:image/jpeg;base64,')) {
      return res.set('Cache-Control', 'no-store').status(400).json({
        erro: 'A fotografia deve ser um data URL no formato data:image/jpeg;base64,',
        codigo: 'PEDIDO_INVALIDO',
      });
    }

    const base64Parte = fotografia.slice('data:image/jpeg;base64,'.length);
    const bytesFoto = Buffer.byteLength(base64Parte, 'base64');
    if (bytesFoto > 300 * 1024) {
      return res.set('Cache-Control', 'no-store').status(400).json({
        erro: 'A fotografia excede o limite máximo de 300 KB.',
        codigo: 'PEDIDO_INVALIDO',
      });
    }
  }

  // Validação de recusadas
  if (recusadas !== undefined && !Array.isArray(recusadas)) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'O campo recusadas deve ser uma lista de identificadores.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  // Deteção atómica síncrona sem await entre procura e escrita
  const locNormalizada = { lat, lng, precisao };
  const semelhantes = procurarSemelhantes(categoria, locNormalizada, recusadas || []);

  if (semelhantes.length === 0) {
    // Nova ocorrência
    const novaId = crypto.randomUUID();
    const agoraIso = new Date().toISOString();
    contadorVersao += 1;

    const novaOcorrencia = {
      id: novaId,
      categoria,
      descricao,
      localizacao: locNormalizada,
      temFotografia: Boolean(fotografia),
      estado: 'aberta',
      comunicacoes: 1,
      criadaEm: agoraIso,
      atualizadaEm: agoraIso,
      versao: contadorVersao,
      cidadaos: [req.cidadao],
    };

    ocorrencias.set(novaId, novaOcorrencia);
    if (fotografia) {
      fotografias.set(novaId, fotografia);
    }
    guardarDados();

    const locationUrl = `/v1/ocorrencias/${novaId}`;
    const respostaCorpo = {
      resultado: 'criada',
      ocorrencia: sanitizarOcorrencia(novaOcorrencia),
    };

    return concluirPedidoIdempotente(req, res, 201, respostaCorpo, locationUrl);
  }

  // Ocorrência semelhante existente mais próxima
  const maisProxima = semelhantes[0].ocorrencia;
  const locationUrl = `/v1/ocorrencias/${maisProxima.id}`;

  if (maisProxima.cidadaos && maisProxima.cidadaos.includes(req.cidadao)) {
    // O mesmo cidadão já comunicou ou reforçou esta ocorrência
    const respostaCorpo = {
      resultado: 'ja-comunicada',
      ocorrencia: sanitizarOcorrencia(maisProxima),
    };
    return concluirPedidoIdempotente(req, res, 200, respostaCorpo, locationUrl);
  }

  // Cidadão diferente reforça ocorrência existente
  maisProxima.comunicacoes += 1;
  maisProxima.cidadaos.push(req.cidadao);
  contadorVersao += 1;
  maisProxima.versao = contadorVersao;
  maisProxima.atualizadaEm = new Date().toISOString();
  guardarDados();

  const respostaCorpo = {
    resultado: 'reforcada',
    ocorrencia: sanitizarOcorrencia(maisProxima),
  };

  return concluirPedidoIdempotente(req, res, 200, respostaCorpo, locationUrl);
});

// 5. POST /v1/ocorrencias/{id}/reforcos (reforço direto)
app.post('/v1/ocorrencias/:id/reforcos', exigirCidadao, verificarIdempotencia, (req, res) => {
  const { id } = req.params;
  const ocorrencia = ocorrencias.get(id);

  if (!ocorrencia) {
    return res.set('Cache-Control', 'no-store').status(404).json({
      erro: 'Ocorrência não encontrada.',
      codigo: 'NAO_ENCONTRADO',
    });
  }

  if (ocorrencia.estado === 'resolvida') {
    return res.set('Cache-Control', 'no-store').status(410).json({
      erro: 'A ocorrência já se encontra resolvida e não pode ser reforçada.',
      codigo: 'OCORRENCIA_RESOLVIDA',
    });
  }

  if (ocorrencia.cidadaos && ocorrencia.cidadaos.includes(req.cidadao)) {
    const respostaCorpo = {
      resultado: 'ja-comunicada',
      ocorrencia: sanitizarOcorrencia(ocorrencia),
    };
    return concluirPedidoIdempotente(req, res, 200, respostaCorpo);
  }

  ocorrencia.comunicacoes += 1;
  ocorrencia.cidadaos.push(req.cidadao);
  contadorVersao += 1;
  ocorrencia.versao = contadorVersao;
  ocorrencia.atualizadaEm = new Date().toISOString();
  guardarDados();

  const respostaCorpo = {
    resultado: 'reforcada',
    ocorrencia: sanitizarOcorrencia(ocorrencia),
  };

  return concluirPedidoIdempotente(req, res, 201, respostaCorpo);
});

// 6. GET /v1/ocorrencias/{id}/fotografia
app.get('/v1/ocorrencias/:id/fotografia', (req, res) => {
  const { id } = req.params;
  const fotoDataUrl = fotografias.get(id);

  if (!fotoDataUrl) {
    return res.set('Cache-Control', 'no-store').status(404).json({
      erro: 'Fotografia não encontrada para esta ocorrência.',
      codigo: 'NAO_ENCONTRADO',
    });
  }

  const base64Parte = fotoDataUrl.replace(/^data:image\/jpeg;base64,/, '');
  const bufferFoto = Buffer.from(base64Parte, 'base64');

  res.set({
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'no-store',
  }).status(200).send(bufferFoto);
});

// 7. GET /v1/ocorrencias/alteracoes?desde=
app.get('/v1/ocorrencias/alteracoes', exigirCidadao, (req, res) => {
  const { desde } = req.query;

  if (desde === undefined || !/^\d+$/.test(String(desde))) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Parâmetro desde ausente ou deve ser um inteiro não-negativo.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  const cursorDesde = Number(desde);
  const alteracoes = [];

  for (const occ of ocorrencias.values()) {
    if (occ.cidadaos && occ.cidadaos.includes(req.cidadao) && occ.versao > cursorDesde) {
      alteracoes.push(sanitizarOcorrencia(occ));
    }
  }

  // Ordenar por versão crescente
  alteracoes.sort((a, b) => a.versao - b.versao);

  res.set('Cache-Control', 'private, no-store').status(200).json({
    alteracoes,
    cursor: contadorVersao,
  });
});

// 8. PATCH /v1/admin/ocorrencias/{id}
app.patch('/v1/admin/ocorrencias/:id', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_TOKEN) {
    return res.set('Cache-Control', 'no-store').status(403).json({
      erro: 'Acesso proibido: token de administração inválido ou ausente.',
      codigo: 'ACESSO_PROIBIDO',
    });
  }

  const { id } = req.params;
  const ocorrencia = ocorrencias.get(id);
  if (!ocorrencia) {
    return res.set('Cache-Control', 'no-store').status(404).json({
      erro: 'Ocorrência não encontrada.',
      codigo: 'NAO_ENCONTRADO',
    });
  }

  const { estado } = req.body || {};
  if (!estado || !ESTADOS_VALIDOS.has(estado)) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Estado inválido. Valores aceites: aberta, em-resolucao, resolvida.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }

  ocorrencia.estado = estado;
  contadorVersao += 1;
  ocorrencia.versao = contadorVersao;
  ocorrencia.atualizadaEm = new Date().toISOString();
  guardarDados();

  res.set('Cache-Control', 'no-store').status(200).json(sanitizarOcorrencia(ocorrencia));
});

// Middleware 404 para rotas inexistentes
app.use((req, res) => {
  res.set('Cache-Control', 'no-store').status(404).json({
    erro: `Recurso não encontrado: ${req.method} ${req.originalUrl}`,
    codigo: 'NAO_ENCONTRADO',
  });
});

// Tratamento de erros gerais e JSON malformado
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return res.set('Cache-Control', 'no-store').status(400).json({
      erro: 'Corpo do pedido não é um JSON válido.',
      codigo: 'PEDIDO_INVALIDO',
    });
  }
  console.error('Erro não tratado:', err);
  res.set('Cache-Control', 'no-store').status(500).json({
    erro: 'Erro interno do servidor.',
    codigo: 'ERRO_INTERNO',
  });
});

// Exporta para testes se for exigido por require, ou corre listen
if (require.main === module) {
  app.listen(PORTO, () => {
    console.log(`Servidor Reporta ativo em http://localhost:${PORTO}`);
  });
}

module.exports = {
  app,
  procurarSemelhantes,
  CATEGORIAS,
  ocorrencias,
  fotografias,
  idempotencia,
};
