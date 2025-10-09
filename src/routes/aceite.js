const express = require('express');
const path = require('path');
const db = require('../database');
const { gerarHashTermo } = require('../utils/hash');
const { VERSAO_TERMO_ATUAL } = require('../middlewares/verificarAceite');
const bcrypt = require('bcryptjs');

const TERMO_PATH = path.resolve(__dirname, '..', '..', 'public', 'termos', 'parceria-v1.html');
const insertAceiteStmt = db.prepare(
  `INSERT INTO aceite_termos (
      user_id,
      versao_termo,
      hash_termo,
      data_aceite,
      ip_usuario,
      user_agent,
      canal_autenticacao,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const selectAceiteStmt = db.prepare(
  'SELECT versao_termo, data_aceite, hash_termo FROM aceite_termos WHERE user_id = ? ORDER BY data_aceite DESC LIMIT 1'
);
const findSignatureStmt = db.prepare(
  'SELECT contract_signature_code_hash, contract_signature_code_generated_at FROM influenciadoras WHERE user_id = ?'
);

const resolveMaybePromise = async (value) => {
  if (value && typeof value.then === 'function') {
    return value;
  }
  return value;
};

const obterUsuarioAutenticado = (req) => req.auth?.user || req.user || null;

const limparCodigo = (codigo) => String(codigo || '').replace(/\D/g, '').slice(0, 6);

const obterIp = (req) => {
  const header = req.headers['x-forwarded-for'];
  if (Array.isArray(header)) {
    return header[0] || req.ip;
  }
  if (typeof header === 'string' && header.trim()) {
    return header.split(',')[0].trim();
  }
  return req.ip;
};

const callStmt = async (stmt, method, ...args) => {
  const result = stmt[method](...args);
  if (result && typeof result.then === 'function') {
    return result;
  }
  return result;
};

const buildRouter = ({ authenticate }) => {
  if (typeof authenticate !== 'function') {
    throw new Error('Middleware de autenticacao nao fornecido.');
  }

  const router = express.Router();

  router.post('/enviar-token', authenticate, async (req, res, next) => {
    try {
      if (db.ready) {
        await db.ready;
      }

      const user = obterUsuarioAutenticado(req);
      if (!user) {
        return res.status(401).json({ error: 'Usuario nao autenticado.' });
      }

      if (user.role !== 'influencer') {
        return res.status(403).json({ error: 'Somente influenciadoras precisam confirmar o aceite.' });
      }

      const aceiteAtual = await resolveMaybePromise(selectAceiteStmt.get(user.id));
      if (aceiteAtual && aceiteAtual.versao_termo === VERSAO_TERMO_ATUAL) {
        return res.status(200).json({ message: 'Termo de parceria ja foi aceito.' });
      }

      const assinatura = await resolveMaybePromise(findSignatureStmt.get(user.id));
      if (!assinatura?.contract_signature_code_hash) {
        return res.status(409).json({
          error: 'Codigo de assinatura nao encontrado. Entre em contato com a equipe HidraPink.'
        });
      }

      return res.json({
        message: 'Digite o código de assinatura informado pela equipe HidraPink para finalizar o aceite.'
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/validar-token', authenticate, async (req, res, next) => {
    try {
      if (db.ready) {
        await db.ready;
      }

      const user = obterUsuarioAutenticado(req);
      if (!user) {
        return res.status(401).json({ error: 'Usuario nao autenticado.' });
      }

      if (user.role !== 'influencer') {
        return res.status(403).json({ error: 'Somente influenciadoras precisam confirmar o aceite.' });
      }

      const codigo = limparCodigo(req.body?.codigo || req.body?.token);
      if (!codigo || codigo.length !== 6) {
        return res.status(400).json({ error: 'Informe o codigo de assinatura com 6 digitos.' });
      }

      const aceiteAtual = await resolveMaybePromise(selectAceiteStmt.get(user.id));
      if (aceiteAtual && aceiteAtual.versao_termo === VERSAO_TERMO_ATUAL) {
        return res.status(200).json({ message: 'Termo de parceria ja foi aceito.' });
      }

      const assinatura = await resolveMaybePromise(findSignatureStmt.get(user.id));
      if (!assinatura?.contract_signature_code_hash) {
        return res.status(409).json({
          error: 'Codigo de assinatura nao encontrado. Entre em contato com a equipe HidraPink.'
        });
      }

      const codigoValido = await bcrypt.compare(codigo, assinatura.contract_signature_code_hash);
      if (!codigoValido) {
        return res.status(400).json({ error: 'Codigo de assinatura invalido.' });
      }

      const hashTermo = gerarHashTermo(TERMO_PATH);
      const dataAceite = new Date().toISOString();
      const ipUsuario = obterIp(req);
      const userAgent = req.headers['user-agent'] || null;

      await callStmt(
        insertAceiteStmt,
        'run',
        user.id,
        VERSAO_TERMO_ATUAL,
        hashTermo,
        dataAceite,
        ipUsuario || null,
        userAgent,
        'codigo_assinatura',
        'aceito'
      );

      return res.json({
        message: 'Aceite registrado com sucesso.',
        redirect: '/influencer.html'
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/verificar-aceite', authenticate, async (req, res, next) => {
    try {
      if (db.ready) {
        await db.ready;
      }

      const user = obterUsuarioAutenticado(req);
      if (!user) {
        return res.status(401).json({ error: 'Usuario nao autenticado.' });
      }

      if (user.role !== 'influencer') {
        return res.json({ aceito: true, versaoAtual: VERSAO_TERMO_ATUAL, role: user.role });
      }

      const aceite = await resolveMaybePromise(selectAceiteStmt.get(user.id));
      const aceito = Boolean(aceite && aceite.versao_termo === VERSAO_TERMO_ATUAL);

      return res.json({
        aceito,
        versaoAtual: VERSAO_TERMO_ATUAL,
        registro: aceito
          ? {
              dataAceite: aceite.data_aceite,
              hashTermo: aceite.hash_termo
            }
          : null
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

module.exports = buildRouter;
