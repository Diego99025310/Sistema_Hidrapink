const db = require('../database');

const VERSAO_TERMO_ATUAL = '1.0';

const selectAceiteStmt = db.prepare(
  'SELECT versao_termo, data_aceite FROM aceite_termos WHERE user_id = ? ORDER BY data_aceite DESC LIMIT 1'
);
const selectContractWaiverStmt = db.prepare(
  'SELECT contract_signature_waived FROM influenciadoras WHERE user_id = ? LIMIT 1'
);

const resolveMaybePromise = async (value) => {
  if (value && typeof value.then === 'function') {
    return value;
  }
  return value;
};

const shouldRespondWithJson = (req) => {
  const accept = (req.headers?.accept || '').toLowerCase();
  const contentType = (req.headers?.['content-type'] || '').toLowerCase();
  if (req.xhr) return true;
  if (req.originalUrl && req.originalUrl.startsWith('/api/')) return true;
  if (contentType.includes('application/json')) return true;
  if (!accept) return true;
  if (!accept.includes('text/html')) return true;
  return accept.includes('application/json');
};

const verificarAceite = async (req, res, next) => {
  try {
    if (db.ready) {
      await db.ready;
    }
  } catch (error) {
    return next(error);
  }

  const user = req.auth?.user || req.user;
  if (!user || user.role !== 'influencer') {
    return next();
  }

  try {
    const waiver = await resolveMaybePromise(selectContractWaiverStmt.get(user.id));
    if (waiver && Number(waiver.contract_signature_waived) === 1) {
      return next();
    }

    const aceite = await resolveMaybePromise(selectAceiteStmt.get(user.id));
    if (!aceite || aceite.versao_termo !== VERSAO_TERMO_ATUAL) {
      if (shouldRespondWithJson(req)) {
        return res
          .status(428)
          .json({ error: 'Aceite do termo de parceria pendente.', redirect: '/aceite-termos' });
      }
      return res.redirect('/aceite-termos');
    }
  } catch (error) {
    return next(error);
  }

  return next();
};

module.exports = verificarAceite;
module.exports.VERSAO_TERMO_ATUAL = VERSAO_TERMO_ATUAL;
