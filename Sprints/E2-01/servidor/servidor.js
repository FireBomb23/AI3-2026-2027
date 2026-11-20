const path = require('path');
const express = require('express');
const { distanciaEmMetros } = require('./geo.js');

const app = express();
const PORTO = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function naoImplementado(req, res) {
  res.set('Cache-Control', 'no-store');
  res.status(501).json({
    erro: `Operação ${req.method} ${req.path} ainda não implementada.`,
    codigo: 'NAO_IMPLEMENTADO',
  });
}

// 8 operações previstas no contrato reporta.openapi.yaml (Sprint E2-01: respostas provisórias 501)
app.get('/v1/categorias', naoImplementado);
app.get('/v1/ocorrencias/semelhantes', naoImplementado);
app.get('/v1/ocorrencias/alteracoes', naoImplementado);
app.get('/v1/ocorrencias', naoImplementado);
app.post('/v1/ocorrencias', naoImplementado);
app.post('/v1/ocorrencias/:id/reforcos', naoImplementado);
app.get('/v1/ocorrencias/:id/fotografia', naoImplementado);
app.patch('/v1/admin/ocorrencias/:id', naoImplementado);

// Qualquer rota inexistente responde 404 com corpo Erro
app.use((req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(404).json({
    erro: `Recurso não encontrado: ${req.method} ${req.originalUrl}`,
    codigo: 'NAO_ENCONTRADO',
  });
});

// Referência silenciosa a distanciaEmMetros para manter o módulo pronto para os próximos sprints
void distanciaEmMetros;

app.listen(PORTO, () => {
  console.log(`Servidor Reporta a correr em http://localhost:${PORTO}`);
});
