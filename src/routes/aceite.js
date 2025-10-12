const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { gerarHashTermo } = require('../utils/hash');
const { VERSAO_TERMO_ATUAL } = require('../middlewares/verificarAceite');

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
const selectContractWaiverByUserStmt = db.prepare(
  'SELECT contract_signature_waived FROM influenciadoras WHERE user_id = ? LIMIT 1'
);
const selectContractWaiverByInfluencerStmt = db.prepare(
  'SELECT contract_signature_waived FROM influenciadoras WHERE id = ? LIMIT 1'
);
const contratoAssinadoSelectBase = `
  SELECT
    a.id AS aceite_id,
    a.user_id AS aceite_user_id,
    a.versao_termo AS aceite_versao,
    a.hash_termo AS aceite_hash,
    a.data_aceite AS aceite_data,
    a.ip_usuario AS aceite_ip,
    a.user_agent AS aceite_user_agent,
    a.canal_autenticacao AS aceite_canal,
    a.status AS aceite_status,
    i.id AS influencer_id,
    i.nome AS influencer_nome,
    i.cpf AS influencer_cpf,
    i.email AS influencer_email,
    i.contato AS influencer_contato,
    i.cupom AS influencer_cupom,
    i.cidade AS influencer_cidade,
    i.estado AS influencer_estado,
    i.instagram AS influencer_instagram,
    i.contract_signature_code_generated_at AS codigo_gerado_em,
    u.email AS login_email
  FROM aceite_termos a
  JOIN influenciadoras i ON i.user_id = a.user_id
  LEFT JOIN users u ON u.id = a.user_id
`;
const findSignedContractByUserStmt = db.prepare(
  `${contratoAssinadoSelectBase} WHERE a.user_id = ? ORDER BY a.data_aceite DESC LIMIT 1`
);
const findSignedContractByInfluencerStmt = db.prepare(
  `${contratoAssinadoSelectBase} WHERE i.id = ? ORDER BY a.data_aceite DESC LIMIT 1`
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

const isContractWaivedValue = (value) => {
  if (value == null) {
    return false;
  }
  if (typeof value === 'object' && value.contract_signature_waived != null) {
    return isContractWaivedValue(value.contract_signature_waived);
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric === 1;
  }
  return false;
};

const isContractWaivedForUser = async (userId) => {
  if (!userId) {
    return false;
  }
  const waiver = await callStmt(selectContractWaiverByUserStmt, 'get', userId);
  return isContractWaivedValue(waiver);
};

const isContractWaivedForInfluencer = async (influencerId) => {
  if (!influencerId) {
    return false;
  }
  const waiver = await callStmt(selectContractWaiverByInfluencerStmt, 'get', influencerId);
  return isContractWaivedValue(waiver);
};

const respondContractWaived = (res, scope = 'master') => {
  const message =
    scope === 'own'
      ? 'A assinatura do contrato foi dispensada para sua conta.'
      : 'A assinatura do contrato foi dispensada para esta influenciadora.';
  return res.status(404).json({ error: message });
};

const MAX_USER_AGENT_LENGTH = 512;

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const maskCpf = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length !== 11) {
    return value || '';
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

const slugify = (value) => {
  const normalized = String(value || 'contrato')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return normalized || 'contrato';
};

const sanitizeFilename = (value) => {
  const fallback = 'contrato-hidrapink.html';
  if (!value) return fallback;
  const cleaned = String(value)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .trim();
  return cleaned || fallback;
};

const describeCanal = (canal) => {
  switch (canal) {
    case 'codigo_assinatura':
      return 'Código de assinatura informado pela influenciadora';
    case 'token_email':
      return 'Token enviado por e-mail';
    default:
      return canal ? canal.replace(/_/g, ' ') : 'Não informado';
  }
};

const trimUserAgent = (value) => {
  if (!value) return '';
  const normalized = String(value).trim();
  if (normalized.length <= MAX_USER_AGENT_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_USER_AGENT_LENGTH)}…`;
};

const formatDateRepresentations = (value) => {
  if (!value) {
    return { raw: '', iso: '', br: '', utc: '' };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const raw = String(value);
    return { raw, iso: raw, br: raw, utc: raw };
  }
  const iso = date.toISOString();
  let br = iso;
  try {
    br = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium',
      hour12: false,
      timeZone: 'America/Sao_Paulo'
    }).format(date);
  } catch (error) {
    br = date.toLocaleString('pt-BR', { hour12: false });
  }
  const utc = iso.replace('T', ' ').replace('Z', ' UTC');
  return { raw: String(value), iso, br, utc };
};

const SIGNATURE_STYLES = `
.hidrapink-assinatura {
  margin-top: 48px;
  padding: 28px 24px 36px;
  border-top: 3px solid #e5007d;
  background: linear-gradient(135deg, rgba(255, 236, 246, 0.85), rgba(255, 255, 255, 0.98));
  font-family: 'Segoe UI', Roboto, Arial, sans-serif;
  color: #333;
}
.hidrapink-assinatura h2 {
  margin-top: 0;
  color: #e5007d;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 1.1rem;
}
.hidrapink-assinatura p {
  margin: 0 0 16px 0;
  line-height: 1.6;
}
.hidrapink-assinatura dl {
  margin: 24px 0;
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.hidrapink-assinatura dt {
  font-weight: 700;
  font-size: 0.86rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #e5007d;
}
.hidrapink-assinatura dd {
  margin: 6px 0 0 0;
  font-size: 1.02rem;
  color: #333;
  word-break: break-word;
}
.hidrapink-assinatura code {
  font-family: 'Fira Code', 'SFMono-Regular', 'Roboto Mono', monospace;
  font-size: 0.92rem;
  background: rgba(229, 0, 125, 0.1);
  padding: 2px 6px;
  border-radius: 6px;
  display: inline-block;
  word-break: break-all;
}
.hidrapink-assinatura .assinatura-ua {
  margin-top: 18px;
  background: rgba(229, 0, 125, 0.06);
  border-radius: 12px;
  padding: 16px;
}
.hidrapink-assinatura .assinatura-ua span {
  display: block;
  font-weight: 600;
  color: #e5007d;
  margin-bottom: 6px;
  text-transform: uppercase;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
}
.hidrapink-assinatura .assinatura-ua pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Fira Code', 'SFMono-Regular', 'Roboto Mono', monospace;
  font-size: 0.9rem;
  color: #333;
}
.hidrapink-assinatura footer {
  margin-top: 24px;
  font-size: 0.85rem;
  color: #666;
  line-height: 1.5;
}
`;

const loadContractTemplate = () => {
  try {
    return fs.readFileSync(TERMO_PATH, 'utf8');
  } catch (cause) {
    const error = new Error('Nao foi possivel carregar o arquivo do termo de parceria.');
    error.cause = cause;
    throw error;
  }
};

const injectSignatureIntoTemplate = (template, signatureSection) => {
  let withStyles = template;
  if (template.includes('</head>')) {
    withStyles = template.replace('</head>', `<style>${SIGNATURE_STYLES}</style></head>`);
  } else {
    withStyles = `<style>${SIGNATURE_STYLES}</style>${template}`;
  }
  if (withStyles.includes('</body>')) {
    return withStyles.replace('</body>', `${signatureSection}</body>`);
  }
  return `${withStyles}${signatureSection}`;
};

const mapSignedContractRow = (row) => {
  if (!row) return null;
  return {
    acceptance: {
      id: row.aceite_id,
      userId: row.aceite_user_id,
      versao: row.aceite_versao,
      hash: row.aceite_hash,
      data: row.aceite_data,
      ip: row.aceite_ip,
      userAgent: row.aceite_user_agent,
      canal: row.aceite_canal,
      status: row.aceite_status
    },
    influencer: {
      id: row.influencer_id,
      nome: row.influencer_nome,
      cpf: row.influencer_cpf,
      email: row.influencer_email,
      contato: row.influencer_contato,
      cupom: row.influencer_cupom,
      cidade: row.influencer_cidade,
      estado: row.influencer_estado,
      instagram: row.influencer_instagram,
      loginEmail: row.login_email,
      signatureCodeGeneratedAt: row.codigo_gerado_em
    }
  };
};

const buildSignatureSection = (contract) => {
  const { acceptance, influencer } = contract;
  const acceptanceDates = formatDateRepresentations(acceptance.data);
  const signatureCodeDates = formatDateRepresentations(influencer.signatureCodeGeneratedAt);
  const nome = influencer.nome || 'Influenciadora cadastrada';
  const cidadeUf = [influencer.cidade, influencer.estado].filter(Boolean).join(' / ');
  const canalDescricao = describeCanal(acceptance.canal);
  const userAgent = trimUserAgent(acceptance.userAgent);
  const codigoGeradoEm = signatureCodeDates.br
    ? `${signatureCodeDates.br} (${signatureCodeDates.utc})`
    : 'Não informado';

  return `
    <section class="hidrapink-assinatura">
      <h2>Registro de assinatura eletrônica</h2>
      <p>
        Documento assinado eletronicamente por <strong>${escapeHtml(nome)}</strong>
        em <strong>${escapeHtml(acceptanceDates.br)}</strong> (horário de Brasília).
      </p>
      <p>
        Registro nº <strong>${escapeHtml(String(acceptance.id || '-'))}</strong> — Versão do termo <strong>${escapeHtml(
    acceptance.versao
  )}</strong>.
      </p>
      <dl>
        <div>
          <dt>Nome completo</dt>
          <dd>${escapeHtml(influencer.nome || '-')}</dd>
        </div>
        <div>
          <dt>CPF</dt>
          <dd>${escapeHtml(maskCpf(influencer.cpf) || '-')}</dd>
        </div>
        <div>
          <dt>E-mail de acesso</dt>
          <dd>${escapeHtml(influencer.loginEmail || '-')}</dd>
        </div>
        <div>
          <dt>E-mail de contato</dt>
          <dd>${escapeHtml(influencer.email || '-')}</dd>
        </div>
        <div>
          <dt>Conta Instagram</dt>
          <dd>${escapeHtml(influencer.instagram || '-')}</dd>
        </div>
        <div>
          <dt>Cidade / UF</dt>
          <dd>${escapeHtml(cidadeUf || '-')}</dd>
        </div>
        <div>
          <dt>Data e hora (Brasília)</dt>
          <dd>${escapeHtml(acceptanceDates.br)}</dd>
        </div>
        <div>
          <dt>Data e hora (UTC)</dt>
          <dd>${escapeHtml(acceptanceDates.utc)}</dd>
        </div>
        <div>
          <dt>Hash SHA-256 do termo</dt>
          <dd><code>${escapeHtml(acceptance.hash || '-')}</code></dd>
        </div>
        <div>
          <dt>Endereço IP registrado</dt>
          <dd>${escapeHtml(acceptance.ip || 'Não informado')}</dd>
        </div>
        <div>
          <dt>Canal de autenticação</dt>
          <dd>${escapeHtml(canalDescricao)}</dd>
        </div>
        <div>
          <dt>Status do aceite</dt>
          <dd>${escapeHtml(acceptance.status || '-')}</dd>
        </div>
        <div>
          <dt>Código de assinatura gerado em</dt>
          <dd>${escapeHtml(codigoGeradoEm)}</dd>
        </div>
        <div>
          <dt>Cupom exclusivo</dt>
          <dd>${escapeHtml(influencer.cupom || '-')}</dd>
        </div>
      </dl>
      <div class="hidrapink-assinatura assinatura-ua">
        <span>User agent registrado</span>
        <pre>${escapeHtml(userAgent || 'Não informado')}</pre>
      </div>
      <footer>
        <p>
          O aceite eletrônico possui validade jurídica nos termos da MP 2.200-2/2001 e do Código Civil Brasileiro.
          Este documento foi gerado automaticamente pelo sistema HidraPink Parcerias e inclui os metadados necessários
          para auditoria e comprovação do consentimento.
        </p>
      </footer>
    </section>
  `;
};

const buildSignedContract = (row) => {
  const mapped = mapSignedContractRow(row);
  if (!mapped) return null;
  const template = loadContractTemplate();
  const signatureSection = buildSignatureSection(mapped);
  const html = injectSignatureIntoTemplate(template, signatureSection);

  const acceptanceDates = formatDateRepresentations(mapped.acceptance.data);
  const filenameDate = acceptanceDates.iso ? acceptanceDates.iso.replace(/[-:]/g, '').slice(0, 15) : 'registro';
  const rawFilename = `Termo_HidraPink_${slugify(mapped.influencer.nome)}_${filenameDate}.html`;

  return {
    html,
    filename: sanitizeFilename(rawFilename),
    acceptance: mapped.acceptance,
    influencer: mapped.influencer,
    dates: {
      aceite: acceptanceDates,
      codigoGerado: formatDateRepresentations(mapped.influencer.signatureCodeGeneratedAt)
    }
  };
};

const getSignedContractForUser = async ({ userId, influencerId }) => {
  if (!userId && !influencerId) {
    return null;
  }
  const stmt = influencerId ? findSignedContractByInfluencerStmt : findSignedContractByUserStmt;
  const identifier = influencerId ? influencerId : userId;
  const row = await resolveMaybePromise(stmt.get(identifier));
  if (!row) {
    return null;
  }
  return buildSignedContract(row);
};

const buildContractPayload = (contract) => {
  if (!contract) return null;
  const { acceptance, influencer, dates, html, filename } = contract;
  return {
    available: true,
    versao: acceptance.versao,
    registroId: acceptance.id,
    dataAceite: acceptance.data,
    datasAceite: dates.aceite,
    hashTermo: acceptance.hash,
    ipUsuario: acceptance.ip,
    userAgent: trimUserAgent(acceptance.userAgent),
    canalAutenticacao: acceptance.canal,
    canalDescricao: describeCanal(acceptance.canal),
    status: acceptance.status,
    codigoAssinaturaGeradoEm: influencer.signatureCodeGeneratedAt,
    datasCodigoAssinatura: dates.codigoGerado,
    influencer: {
      id: influencer.id,
      nome: influencer.nome,
      cpf: influencer.cpf,
      emailContato: influencer.email,
      contato: influencer.contato,
      cupom: influencer.cupom,
      cidade: influencer.cidade,
      estado: influencer.estado,
      instagram: influencer.instagram,
      loginEmail: influencer.loginEmail
    },
    html,
    filename
  };
};

const sendContractDownload = (res, contract) => {
  const safeFilename = sanitizeFilename(contract.filename);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  return res.send(contract.html);
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

      if (await isContractWaivedForUser(user.id)) {
        return res.json({ aceito: true, versaoAtual: VERSAO_TERMO_ATUAL, dispensado: true });
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

  router.get('/contrato-assinado', authenticate, async (req, res, next) => {
    try {
      if (db.ready) {
        await db.ready;
      }

      const user = obterUsuarioAutenticado(req);
      if (!user) {
        return res.status(401).json({ error: 'Usuario nao autenticado.' });
      }

      if (user.role !== 'influencer') {
        return res.status(403).json({ error: 'Recurso disponivel apenas para influenciadoras.' });
      }

      if (await isContractWaivedForUser(user.id)) {
        return respondContractWaived(res, 'own');
      }

      const contract = await getSignedContractForUser({ userId: user.id });
      if (!contract) {
        return res.status(404).json({ error: 'Nenhum contrato assinado foi localizado.' });
      }

      return res.json(buildContractPayload(contract));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/contrato-assinado/download', authenticate, async (req, res, next) => {
    try {
      if (db.ready) {
        await db.ready;
      }

      const user = obterUsuarioAutenticado(req);
      if (!user) {
        return res.status(401).json({ error: 'Usuario nao autenticado.' });
      }

      if (user.role !== 'influencer') {
        return res.status(403).json({ error: 'Recurso disponivel apenas para influenciadoras.' });
      }

      if (await isContractWaivedForUser(user.id)) {
        return respondContractWaived(res, 'own');
      }

      const contract = await getSignedContractForUser({ userId: user.id });
      if (!contract) {
        return res.status(404).json({ error: 'Nenhum contrato assinado foi localizado.' });
      }

      return sendContractDownload(res, contract);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/contrato-assinado/influenciadora/:id', authenticate, async (req, res, next) => {
    try {
      if (db.ready) {
        await db.ready;
      }

      const user = obterUsuarioAutenticado(req);
      if (!user) {
        return res.status(401).json({ error: 'Usuario nao autenticado.' });
      }

      if (user.role !== 'master') {
        return res.status(403).json({ error: 'Recurso disponivel apenas para o usuario master.' });
      }

      const influencerId = Number(req.params.id);
      if (!Number.isInteger(influencerId) || influencerId <= 0) {
        return res.status(400).json({ error: 'Identificador de influenciadora invalido.' });
      }

      if (await isContractWaivedForInfluencer(influencerId)) {
        return respondContractWaived(res);
      }

      const contract = await getSignedContractForUser({ influencerId });
      if (!contract) {
        return res.status(404).json({ error: 'Nenhum contrato assinado foi localizado para esta influenciadora.' });
      }

      return res.json(buildContractPayload(contract));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/contrato-assinado/influenciadora/:id/download', authenticate, async (req, res, next) => {
    try {
      if (db.ready) {
        await db.ready;
      }

      const user = obterUsuarioAutenticado(req);
      if (!user) {
        return res.status(401).json({ error: 'Usuario nao autenticado.' });
      }

      if (user.role !== 'master') {
        return res.status(403).json({ error: 'Recurso disponivel apenas para o usuario master.' });
      }

      const influencerId = Number(req.params.id);
      if (!Number.isInteger(influencerId) || influencerId <= 0) {
        return res.status(400).json({ error: 'Identificador de influenciadora invalido.' });
      }

      if (await isContractWaivedForInfluencer(influencerId)) {
        return respondContractWaived(res);
      }

      const contract = await getSignedContractForUser({ influencerId });
      if (!contract) {
        return res.status(404).json({ error: 'Nenhum contrato assinado foi localizado para esta influenciadora.' });
      }

      return sendContractDownload(res, contract);
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

module.exports = buildRouter;
