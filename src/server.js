const express = require('express');
const path = require('path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');

const app = express();

const candidateStaticDirs = ['frontend', 'public']
  .map((dir) => path.join(__dirname, '..', dir))
  .filter((dir) => {
    try {
      return fs.existsSync(dir);
    } catch (error) {
      console.warn('Nao foi possivel verificar o diretorio estatico ' + dir + ':', error);
      return false;
    }
  });

const fallbackStaticDir = path.join(__dirname, '..', 'public');
const staticDirs = candidateStaticDirs.length ? candidateStaticDirs : [fallbackStaticDir];
const primaryStaticDir = staticDirs[0];

app.use(express.json());
staticDirs.forEach((dir) => app.use(express.static(dir)));

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_EXPIRATION = process.env.JWT_EXPIRATION || '1d';

const validators = {
  email: (value) => /^(?:[\w!#$%&'*+/=?^`{|}~-]+(?:\.[\w!#$%&'*+/=?^`{|}~-]+)*)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(value),
  password: (value) => typeof value === 'string' && value.length >= 6
};

const roundCurrency = (value) => Math.round(Number(value) * 100) / 100;

const parseCurrency = (value, fieldLabel) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return { error: `${fieldLabel} deve ser um numero maior ou igual a zero.` };
  }
  return { value: roundCurrency(num) };
};

const isValidDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

const findUserByEmailStmt = db.prepare('SELECT id, email, password_hash, role FROM users WHERE LOWER(email) = LOWER(?)');
const findUserByIdStmt = db.prepare('SELECT id, email, password_hash, role FROM users WHERE id = ?');
const insertUserStmt = db.prepare('INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?)');
const updateUserPasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const updateUserEmailStmt = db.prepare('UPDATE users SET email = ? WHERE id = ?');
const ensureSingleMasterStmt = db.prepare('SELECT id, email, password_hash FROM users WHERE role = ? LIMIT 1');
const deleteUserByIdStmt = db.prepare('DELETE FROM users WHERE id = ?');

const influencerBaseQuery = `
  SELECT i.id,
         i.nome,
         i.instagram,
         i.cpf,
         i.email,
         i.contato,
         i.cupom,
         i.vendas_quantidade,
         i.vendas_valor,
         i.cep,
         i.numero,
         i.complemento,
         i.logradouro,
         i.bairro,
         i.cidade,
         i.estado,
         i.commission_rate,
         i.user_id,
         i.created_at,
         u.email AS login_email
  FROM influenciadoras i
  LEFT JOIN users u ON u.id = i.user_id
`;

const insertInfluencerStmt = db.prepare(`
  INSERT INTO influenciadoras (
    nome,
    instagram,
    cpf,
    email,
    contato,
    cupom,
    vendas_quantidade,
    vendas_valor,
    cep,
    numero,
    complemento,
    logradouro,
    bairro,
    cidade,
    estado,
    commission_rate,
    user_id
  ) VALUES (
    @nome,
    @instagram,
    @cpf,
    @email,
    @contato,
    @cupom,
    @vendas_quantidade,
    @vendas_valor,
    @cep,
    @numero,
    @complemento,
    @logradouro,
    @bairro,
    @cidade,
    @estado,
    @commission_rate,
    @user_id
  )
`);

const updateInfluencerStmt = db.prepare(`
  UPDATE influenciadoras SET
    nome = @nome,
    instagram = @instagram,
    cpf = @cpf,
    email = @email,
    contato = @contato,
    cupom = @cupom,
    vendas_quantidade = @vendas_quantidade,
    vendas_valor = @vendas_valor,
    cep = @cep,
    numero = @numero,
    complemento = @complemento,
    logradouro = @logradouro,
    bairro = @bairro,
    cidade = @cidade,
    estado = @estado,
    commission_rate = @commission_rate
  WHERE id = @id
`);

const deleteInfluencerByIdStmt = db.prepare('DELETE FROM influenciadoras WHERE id = ?');
const listInfluencersStmt = db.prepare(`${influencerBaseQuery} ORDER BY i.created_at DESC`);
const findInfluencerByIdStmt = db.prepare(`${influencerBaseQuery} WHERE i.id = ?`);
const findInfluencerByUserIdStmt = db.prepare(`${influencerBaseQuery} WHERE i.user_id = ?`);
const listInfluencerContactsStmt = db.prepare('SELECT user_id, contato FROM influenciadoras WHERE contato IS NOT NULL');
const findInfluencerByCouponStmt = db.prepare(`${influencerBaseQuery} WHERE i.cupom IS NOT NULL AND LOWER(i.cupom) = LOWER(?) LIMIT 1`);

const insertSaleStmt = db.prepare(`
  INSERT INTO sales (
    order_code,
    influencer_id,
    date,
    gross_value,
    discount,
    net_value,
    commission
  ) VALUES (
    @order_code,
    @influencer_id,
    @date,
    @gross_value,
    @discount,
    @net_value,
    @commission
  )
`);

const updateSaleStmt = db.prepare(`
  UPDATE sales SET
    order_code = @order_code,
    influencer_id = @influencer_id,
    date = @date,
    gross_value = @gross_value,
    discount = @discount,
    net_value = @net_value,
    commission = @commission
  WHERE id = @id
`);

const deleteSaleStmt = db.prepare('DELETE FROM sales WHERE id = ?');
const findSaleByIdStmt = db.prepare(`
  SELECT s.id,
         s.order_code,
         s.influencer_id,
         s.date,
         s.gross_value,
         s.discount,
         s.net_value,
         s.commission,
         s.created_at,
         i.cupom,
         i.nome,
         i.commission_rate
  FROM sales s
  JOIN influenciadoras i ON i.id = s.influencer_id
  WHERE s.id = ?
`);
const listSalesByInfluencerStmt = db.prepare(`
  SELECT s.id,
         s.order_code,
         s.influencer_id,
         s.date,
         s.gross_value,
         s.discount,
         s.net_value,
         s.commission,
         s.created_at,
         i.cupom,
         i.nome,
         i.commission_rate
  FROM sales s
  JOIN influenciadoras i ON i.id = s.influencer_id
  WHERE s.influencer_id = ?
  ORDER BY s.date DESC, s.id DESC
`);
const findSaleByOrderCodeStmt = db.prepare(`
  SELECT s.id,
         s.order_code,
         s.date,
         i.cupom
  FROM sales s
  JOIN influenciadoras i ON i.id = s.influencer_id
  WHERE LOWER(s.order_code) = LOWER(?)
  LIMIT 1
`);
const salesSummaryStmt = db.prepare('SELECT COALESCE(SUM(net_value), 0) AS total_net, COALESCE(SUM(commission), 0) AS total_commission FROM sales WHERE influencer_id = ?');
const listInfluencerSummaryStmt = db.prepare(`
  SELECT i.id,
         i.nome,
         i.instagram,
         i.cupom,
         i.commission_rate,
         COALESCE(COUNT(s.id), 0) AS vendas_count,
         COALESCE(SUM(s.net_value), 0) AS vendas_total
  FROM influenciadoras i
  LEFT JOIN sales s ON s.influencer_id = i.id
  GROUP BY i.id
  ORDER BY LOWER(i.nome)
`);

const MASTER_DEFAULT_EMAIL = process.env.MASTER_EMAIL || 'master@example.com';
const MASTER_DEFAULT_PASSWORD = process.env.MASTER_PASSWORD || 'master123';

const ensureMasterUser = () => {
  const existingMaster = ensureSingleMasterStmt.get('master');
  if (existingMaster) {
    if (!existingMaster.password_hash) {
      const hash = bcrypt.hashSync(MASTER_DEFAULT_PASSWORD, 10);
      updateUserPasswordStmt.run(hash, existingMaster.id);
      console.log('Senha do master atualizada para padrao pois nao havia hash.');
    }
    return;
  }

  const hashedPassword = bcrypt.hashSync(MASTER_DEFAULT_PASSWORD, 10);
  insertUserStmt.run(MASTER_DEFAULT_EMAIL, hashedPassword, 'master', 0);
  console.log('--- Usuario master inicial criado ---');
  console.log(`Email: ${MASTER_DEFAULT_EMAIL}`);
  console.log(`Senha inicial: ${MASTER_DEFAULT_PASSWORD}`);
  console.log('Altere a senha quando desejar.');
};

ensureMasterUser();

const normalizeDigits = (value) => (value || '').replace(/\D/g, '');

const findUserByIdentifier = (identifier) => {
  if (!identifier) return null;
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) {
    const user = findUserByEmailStmt.get(trimmed);
    if (user) return user;
  }
  const digits = normalizeDigits(trimmed);
  if (!digits) return findUserByEmailStmt.get(trimmed) || null;
  const contacts = listInfluencerContactsStmt.all();
  const match = contacts.find((row) => normalizeDigits(row.contato) === digits);
  if (match) {
    return findUserByIdStmt.get(match.user_id) || null;
  }
  return null;
};

const generateToken = (user) => jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token nao informado.' });
  }

  const token = authHeader.slice(7).trim();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = findUserByIdStmt.get(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Usuario nao encontrado.' });
    }
    req.auth = { token, user };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Token invalido ou expirado.' });
  }
};

const authorizeMaster = (req, res, next) => {
  if (req.auth?.user?.role !== 'master') {
    return res.status(403).json({ error: 'Acesso restrito ao usuario master.' });
  }
  return next();
};

const trimString = (value) => (typeof value === 'string' ? value.trim() : value);
const normalizeOrderCode = (value) => {
  const trimmed = trimString(value);
  if (!trimmed) return null;
  return String(trimmed).toUpperCase();
};

const isOrderCodeConstraintError = (error) => {
  if (!error) return false;
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT') {
    return typeof error.message === 'string' && error.message.includes('idx_sales_order_code');
  }
  if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
    return true;
  }
  return false;
};

const normalizeInfluencerPayload = (body) => {
  const normalized = {
    nome: trimString(body.nome),
    instagram: trimString(body.instagram),
    cpf: trimString(body.cpf),
    email: trimString(body.email),
    contato: trimString(body.contato),
    cupom: trimString(body.cupom),
    vendasQuantidade: trimString(body.vendasQuantidade),
    vendasValor: trimString(body.vendasValor),
    cep: trimString(body.cep),
    numero: trimString(body.numero),
    complemento: trimString(body.complemento),
    logradouro: trimString(body.logradouro),
    bairro: trimString(body.bairro),
    cidade: trimString(body.cidade),
    estado: trimString(body.estado),
    commissionPercent: trimString(body.commissionPercent ?? body.commission_rate ?? body.commission)
  };

  const missing = [];
  if (!normalized.nome) missing.push('nome');
  if (!normalized.instagram) missing.push('instagram');
  if (missing.length) {
    return { error: { error: 'Campos obrigatorios faltando.', campos: missing } };
  }

  const cpfDigits = normalizeDigits(normalized.cpf);
  let formattedCpf = null;
  if (cpfDigits) {
    if (cpfDigits.length !== 11 || /^(\d)\1{10}$/.test(cpfDigits)) {
      return { error: { error: 'CPF invalido.' } };
    }
    const calc = (len) => {
      let sum = 0;
      for (let i = 0; i < len; i += 1) sum += Number(cpfDigits[i]) * (len + 1 - i);
      const result = (sum * 10) % 11;
      return result === 10 ? 0 : result;
    };
    if (calc(9) !== Number(cpfDigits[9]) || calc(10) !== Number(cpfDigits[10])) {
      return { error: { error: 'CPF invalido.' } };
    }
    formattedCpf = `${cpfDigits.slice(0, 3)}.${cpfDigits.slice(3, 6)}.${cpfDigits.slice(6, 9)}-${cpfDigits.slice(9)}`;
  }

  const contatoDigits = normalizeDigits(normalized.contato);
  let formattedContato = null;
  if (contatoDigits) {
    if (contatoDigits.length !== 10 && contatoDigits.length !== 11) {
      return { error: { error: 'Contato deve conter DDD + numero (10 ou 11 digitos).' } };
    }
    const ddd = contatoDigits.slice(0, 2);
    const middleLen = contatoDigits.length === 11 ? 5 : 4;
    const middle = contatoDigits.slice(2, 2 + middleLen);
    const suffix = contatoDigits.slice(2 + middleLen);
    formattedContato = `(${ddd}) ${middle}${suffix ? `-${suffix}` : ''}`;
  }

  const cepDigits = normalizeDigits(normalized.cep);
  let formattedCep = null;
  if (cepDigits) {
    if (cepDigits.length !== 8) {
      return { error: { error: 'CEP invalido.' } };
    }
    formattedCep = `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}`;
  }

  let vendasQuantidade = 0;
  if (normalized.vendasQuantidade) {
    const parsed = Number(normalized.vendasQuantidade);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { error: { error: 'VendasQuantidade precisa ser um numero inteiro maior ou igual a zero.' } };
    }
    vendasQuantidade = parsed;
  }

  let vendasValor = 0;
  if (normalized.vendasValor) {
    const parsed = Number(normalized.vendasValor);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: { error: 'VendasValor precisa ser um numero maior ou igual a zero.' } };
    }
    vendasValor = Number(parsed.toFixed(2));
  }

  let commissionRate = 0;
  if (normalized.commissionPercent) {
    const parsed = Number(normalized.commissionPercent);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return { error: { error: 'Comissao deve estar entre 0 e 100.' } };
    }
    commissionRate = Number(parsed.toFixed(2));
  }

  const estadoValue = normalized.estado ? normalized.estado.toUpperCase() : null;

  return {
    data: {
      nome: normalized.nome,
      instagram: normalized.instagram.startsWith('@') ? normalized.instagram : `@${normalized.instagram}`,
      cpf: formattedCpf,
      email: normalized.email || null,
      contato: formattedContato,
      cupom: normalized.cupom || null,
      vendas_quantidade: vendasQuantidade,
      vendas_valor: vendasValor,
      cep: formattedCep,
      numero: normalized.numero || null,
      complemento: normalized.complemento || null,
      logradouro: normalized.logradouro || null,
      bairro: normalized.bairro || null,
      cidade: normalized.cidade || null,
      estado: estadoValue || null,
      commission_rate: commissionRate
    }
  };
};

const computeSaleTotals = (grossValue, discountValue, commissionPercent) => {
  const netValue = roundCurrency(Math.max(0, grossValue - discountValue));
  const commissionValue = roundCurrency(netValue * (Number(commissionPercent) / 100));
  return { netValue, commissionValue };
};

const formatSaleRow = (row) => ({
  id: row.id,
  order_code: row.order_code || null,
  influencer_id: row.influencer_id,
  cupom: row.cupom || null,
  nome: row.nome || null,
  date: row.date,
  gross_value: Number(row.gross_value),
  discount: Number(row.discount),
  net_value: Number(row.net_value),
  commission: Number(row.commission),
  commission_rate: row.commission_rate != null ? Number(row.commission_rate) : 0,
  created_at: row.created_at
});

const createInfluencerTransaction = db.transaction((influencerPayload, userPayload) => {
  const mustChange = userPayload.mustChange ?? 0;
  const userResult = insertUserStmt.run(userPayload.email, userPayload.passwordHash, 'influencer', mustChange);
  const userId = userResult.lastInsertRowid;
  const influencerResult = insertInfluencerStmt.run({ ...influencerPayload, user_id: userId });
  return { influencerId: influencerResult.lastInsertRowid, userId };
});

const formatUserResponse = (user) => ({ id: user.id, email: user.email, role: user.role });

const ensureInfluencerAccess = (req, influencerId) => {
  const id = Number(influencerId);
  if (!Number.isInteger(id) || id <= 0) {
    return { status: 400, message: 'ID invalido.' };
  }
  const influencer = findInfluencerByIdStmt.get(id);
  if (!influencer) {
    return { status: 404, message: 'Influenciadora nao encontrada.' };
  }
  if (req.auth.user.role === 'master') {
    return { influencer };
  }
  if (req.auth.user.role === 'influencer') {
    const own = findInfluencerByUserIdStmt.get(req.auth.user.id);
    if (!own || own.id !== id) {
      return { status: 403, message: 'Acesso negado.' };
    }
    return { influencer: own };
  }
  return { status: 403, message: 'Acesso negado.' };
};

const normalizeSaleBody = (body) => {
  const cupom = trimString(body?.cupom);
  const date = trimString(body?.date);
  const orderCodeNormalized = normalizeOrderCode(
    body?.orderCode ?? body?.order_code ?? body?.pedido ?? body?.order
  );
  const orderCode = orderCodeNormalized ? orderCodeNormalized.slice(0, 100) : null;
  const grossRaw = body?.grossValue ?? body?.gross_value;
  const discountRaw = body?.discount ?? body?.discountValue ?? body?.discount_value ?? 0;

  if (!cupom) {
    return { error: { error: 'Informe o cupom da influenciadora.' } };
  }
  if (!date || !isValidDate(date)) {
    return { error: { error: 'Informe uma data valida (YYYY-MM-DD).' } };
  }

  const grossParsed = parseCurrency(grossRaw, 'Valor bruto');
  if (grossParsed.error) {
    return { error: { error: grossParsed.error } };
  }

  const discountParsed = parseCurrency(discountRaw, 'Desconto');
  if (discountParsed.error) {
    return { error: { error: discountParsed.error } };
  }

  if (discountParsed.value > grossParsed.value) {
    return { error: { error: 'Desconto nao pode ser maior que o valor bruto.' } };
  }

  return {
    data: {
      cupom,
      date,
      orderCode,
      grossValue: grossParsed.value,
      discount: discountParsed.value
    }
  };
};

app.post('/register', authenticate, authorizeMaster, async (req, res) => {
  const { email, password, role = 'influencer' } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
  }

  if (!['master', 'influencer'].includes(role)) {
    return res.status(400).json({ error: 'Role invalido. Use "master" ou "influencer".' });
  }

  if (findUserByEmailStmt.get(email)) {
    return res.status(409).json({ error: 'Email ja cadastrado.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const result = insertUserStmt.run(email, hashedPassword, role, 0);

  return res.status(201).json({
    id: result.lastInsertRowid,
    email,
    role
  });
});

app.post('/login', async (req, res) => {
  const identifier = trimString(req.body?.email);
  const password = req.body?.password;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Informe email e senha.' });
  }

  const user = findUserByIdentifier(identifier);
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Credenciais invalidas.' });
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return res.status(401).json({ error: 'Credenciais invalidas.' });
  }

  const token = generateToken(user);
  return res.status(200).json({ token, user: formatUserResponse(user) });
});

app.post('/influenciadora', authenticate, authorizeMaster, async (req, res) => {
  const loginEmail = trimString(req.body?.loginEmail);
  const loginPassword = req.body?.loginPassword;
  const { data, error } = normalizeInfluencerPayload(req.body || {});

  if (error) {
    return res.status(400).json(error);
  }

  if (!loginEmail || !validators.email(loginEmail)) {
    return res.status(400).json({ error: 'Informe um email de acesso valido.' });
  }

  if (!validators.password(loginPassword)) {
    return res.status(400).json({ error: 'Informe uma senha de acesso com no minimo 6 caracteres.' });
  }

  if (findUserByEmailStmt.get(loginEmail)) {
    return res.status(409).json({ error: 'Email de login ja cadastrado.' });
  }

  const passwordHash = await bcrypt.hash(loginPassword, 10);

  try {
    const { influencerId } = createInfluencerTransaction(data, { email: loginEmail, passwordHash, mustChange: 0 });
    const influencer = findInfluencerByIdStmt.get(influencerId);
    return res.status(201).json(influencer);
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Instagram ou email ja cadastrado.' });
    }
    console.error('Erro ao cadastrar influenciadora:', err);
    return res.status(500).json({ error: 'Nao foi possivel cadastrar a influenciadora.' });
  }
});
app.get('/influenciadora/:id', authenticate, (req, res) => {
  const { influencer, status, message } = ensureInfluencerAccess(req, req.params.id);
  if (!influencer) {
    return res.status(status).json({ error: message });
  }
  return res.status(200).json(influencer);
});



app.put('/influenciadora/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID invalido.' });
  }

  const influencer = findInfluencerByIdStmt.get(id);
  if (!influencer) {
    return res.status(404).json({ error: 'Influenciadora nao encontrada.' });
  }

  if (req.auth.user.role !== 'master' && influencer.user_id !== req.auth.user.id) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }

  const { data, error } = normalizeInfluencerPayload(req.body || {});
  if (error) {
    return res.status(400).json(error);
  }

  const loginEmail = trimString(req.body?.loginEmail);
  const loginPassword = req.body?.loginPassword;

  if (loginEmail && !validators.email(loginEmail)) {
    return res.status(400).json({ error: 'Informe um email de acesso valido.' });
  }

  if (loginPassword && !validators.password(loginPassword)) {
    return res.status(400).json({ error: 'Senha de acesso deve ter ao menos 6 caracteres.' });
  }

  try {
    updateInfluencerStmt.run({ id, ...data });

    if (influencer.user_id) {
      if (loginEmail && loginEmail !== influencer.login_email) {
        if (findUserByEmailStmt.get(loginEmail)) {
          return res.status(409).json({ error: 'Email de login ja cadastrado.' });
        }
        updateUserEmailStmt.run(loginEmail, influencer.user_id);
      }
      if (loginPassword) {
        const hash = await bcrypt.hash(loginPassword, 10);
        updateUserPasswordStmt.run(hash, influencer.user_id);
      }
    }

    const updated = findInfluencerByIdStmt.get(id);
    return res.status(200).json(updated);
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Instagram ou email ja cadastrado.' });
    }
    console.error('Erro ao atualizar influenciadora:', err);
    return res.status(500).json({ error: 'Nao foi possivel atualizar a influenciadora.' });
  }
});

app.delete('/influenciadora/:id', authenticate, authorizeMaster, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID invalido.' });
  }

  const influencer = findInfluencerByIdStmt.get(id);
  if (!influencer) {
    return res.status(404).json({ error: 'Influenciadora nao encontrada.' });
  }

  db.exec('BEGIN');
  try {
    deleteInfluencerByIdStmt.run(id);
    if (influencer.user_id) {
      deleteUserByIdStmt.run(influencer.user_id);
    }
    db.exec('COMMIT');
    return res.status(200).json({ message: 'Influenciadora removida com sucesso.' });
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('Erro ao remover influenciadora:', error);
    return res.status(500).json({ error: 'Nao foi possivel remover a influenciadora.' });
  }
});

app.post('/sales', authenticate, authorizeMaster, (req, res) => {
  const { data, error } = normalizeSaleBody(req.body || {});
  if (error) {
    return res.status(400).json(error);
  }

  const influencer = findInfluencerByCouponStmt.get(data.cupom);
  if (!influencer) {
    return res.status(404).json({ error: 'Cupom nao encontrado.' });
  }

  const { netValue, commissionValue } = computeSaleTotals(data.grossValue, data.discount, influencer.commission_rate || 0);

  try {
    const result = insertSaleStmt.run({
      order_code: data.orderCode,
      influencer_id: influencer.id,
      date: data.date,
      gross_value: data.grossValue,
      discount: data.discount,
      net_value: netValue,
      commission: commissionValue
    });
    const created = findSaleByIdStmt.get(result.lastInsertRowid);
    return res.status(201).json(formatSaleRow(created));
  } catch (err) {
    if (isOrderCodeConstraintError(err)) {
      return res.status(409).json({ error: 'Pedido já cadastrado.' });
    }
    console.error('Erro ao cadastrar venda:', err);
    return res.status(500).json({ error: 'Nao foi possivel cadastrar a venda.' });
  }
});

app.post('/sales/check-orders', authenticate, authorizeMaster, async (req, res) => {
  const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (!orders.length) {
    return res.status(200).json([]);
  }

  const unique = Array.from(new Set(orders.map(normalizeOrderCode).filter(Boolean)));
  if (!unique.length) {
    return res.status(200).json([]);
  }

  try {
    const results = [];
    for (const code of unique) {
      const sale = await findSaleByOrderCodeStmt.get(code);
      if (sale) {
        results.push({
          sale_id: sale.id,
          order_code: sale.order_code,
          date: sale.date,
          cupom: sale.cupom
        });
      }
    }
    return res.status(200).json(results);
  } catch (error) {
    console.error('Erro ao verificar pedidos:', error);
    return res.status(500).json({ error: 'Nao foi possivel verificar os pedidos.' });
  }
});

app.put('/sales/:id', authenticate, authorizeMaster, (req, res) => {
  const saleId = Number(req.params.id);
  if (!Number.isInteger(saleId) || saleId <= 0) {
    return res.status(400).json({ error: 'ID invalido.' });
  }

  const existingSale = findSaleByIdStmt.get(saleId);
  if (!existingSale) {
    return res.status(404).json({ error: 'Venda nao encontrada.' });
  }

  const { data, error } = normalizeSaleBody(req.body || {});
  if (error) {
    return res.status(400).json(error);
  }

  const influencer = findInfluencerByCouponStmt.get(data.cupom);
  if (!influencer) {
    return res.status(404).json({ error: 'Cupom nao encontrado.' });
  }

  const { netValue, commissionValue } = computeSaleTotals(data.grossValue, data.discount, influencer.commission_rate || 0);

  try {
    updateSaleStmt.run({
      order_code: data.orderCode,
      id: saleId,
      influencer_id: influencer.id,
      date: data.date,
      gross_value: data.grossValue,
      discount: data.discount,
      net_value: netValue,
      commission: commissionValue
    });

    const updated = findSaleByIdStmt.get(saleId);
    return res.status(200).json(formatSaleRow(updated));
  } catch (err) {
    if (isOrderCodeConstraintError(err)) {
      return res.status(409).json({ error: 'Pedido já cadastrado.' });
    }
    console.error('Erro ao atualizar venda:', err);
    return res.status(500).json({ error: 'Nao foi possivel atualizar a venda.' });
  }
});

app.delete('/sales/:id', authenticate, authorizeMaster, (req, res) => {
  const saleId = Number(req.params.id);
  if (!Number.isInteger(saleId) || saleId <= 0) {
    return res.status(400).json({ error: 'ID invalido.' });
  }

  const existingSale = findSaleByIdStmt.get(saleId);
  if (!existingSale) {
    return res.status(404).json({ error: 'Venda nao encontrada.' });
  }

  try {
    deleteSaleStmt.run(saleId);
    return res.status(200).json({ message: 'Venda removida com sucesso.' });
  } catch (err) {
    console.error('Erro ao remover venda:', err);
    return res.status(500).json({ error: 'Nao foi possivel remover a venda.' });
  }
});

app.get('/sales/summary/:influencerId', authenticate, (req, res) => {
  const { influencer, status, message } = ensureInfluencerAccess(req, req.params.influencerId);
  if (!influencer) {
    return res.status(status).json({ error: message });
  }

  try {
    const summary = salesSummaryStmt.get(influencer.id);
    return res.status(200).json({
      influencer_id: influencer.id,
      cupom: influencer.cupom,
      commission_rate: influencer.commission_rate != null ? Number(influencer.commission_rate) : 0,
      total_net: Number(summary.total_net),
      total_commission: Number(summary.total_commission)
    });
  } catch (err) {
    console.error('Erro ao obter resumo de vendas:', err);
    return res.status(500).json({ error: 'Nao foi possivel obter o resumo de vendas.' });
  }
});

app.get('/sales/:influencerId', authenticate, (req, res) => {
  const { influencer, status, message } = ensureInfluencerAccess(req, req.params.influencerId);
  if (!influencer) {
    return res.status(status).json({ error: message });
  }

  try {
    const rows = listSalesByInfluencerStmt.all(influencer.id);
    return res.status(200).json(rows.map(formatSaleRow));
  } catch (err) {
    console.error('Erro ao listar vendas:', err);
    return res.status(500).json({ error: 'Nao foi possivel listar as vendas.' });
  }
});

app.get('/influenciadoras/consulta', authenticate, authorizeMaster, (req, res) => {
  try {
    const rows = listInfluencerSummaryStmt.all();
    const formatted = rows.map((row) => ({
      id: row.id,
      nome: row.nome,
      instagram: row.instagram,
      cupom: row.cupom,
      commission_rate: row.commission_rate != null ? Number(row.commission_rate) : 0,
      vendas_count: Number(row.vendas_count || 0),
      vendas_total: roundCurrency(row.vendas_total || 0)
    }));
    return res.status(200).json(formatted);
  } catch (error) {
    console.error('Erro ao consultar influenciadoras:', error);
    return res.status(500).json({ error: 'Nao foi possivel consultar as influenciadoras.' });
  }
});

app.get('/influenciadoras', authenticate, (req, res) => {
  try {
    if (req.auth.user.role === 'master') {
      return res.status(200).json(listInfluencersStmt.all());
    }

    const own = findInfluencerByUserIdStmt.get(req.auth.user.id);
    if (!own) {
      return res.status(200).json([]);
    }
    return res.status(200).json([own]);
  } catch (error) {
    console.error('Erro ao listar influenciadoras:', error);
    return res.status(500).json({ error: 'Nao foi possivel listar as influenciadoras.' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(primaryStaticDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
