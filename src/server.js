require('./config/env');
const express = require('express');
const path = require('path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');
const createAceiteRouter = require('./routes/aceite');
const verificarAceite = require('./middlewares/verificarAceite');

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

app.get('/aceite-termos', (req, res) => {
  const filePath = path.join(primaryStaticDir, 'aceite-termos.html');
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(err.status || 500).end();
    }
  });
});

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
    contract_signature_code_hash,
    contract_signature_code_generated_at,
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
    @contract_signature_code_hash,
    @contract_signature_code_generated_at,
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
const findInfluencerSignatureStmt = db.prepare(
  'SELECT contract_signature_code_hash, contract_signature_code_generated_at FROM influenciadoras WHERE user_id = ?'
);
const listInfluencerContactsStmt = db.prepare('SELECT user_id, contato FROM influenciadoras WHERE contato IS NOT NULL');
const findInfluencerByCouponStmt = db.prepare(`${influencerBaseQuery} WHERE i.cupom IS NOT NULL AND LOWER(i.cupom) = LOWER(?) LIMIT 1`);

const insertSaleStmt = db.prepare(`
  INSERT INTO sales (
    influencer_id,
    order_number,
    date,
    gross_value,
    discount,
    net_value,
    commission
  ) VALUES (
    @influencer_id,
    @order_number,
    @date,
    @gross_value,
    @discount,
    @net_value,
    @commission
  )
`);

const updateSaleStmt = db.prepare(`
  UPDATE sales SET
    influencer_id = @influencer_id,
    order_number = @order_number,
    date = @date,
    gross_value = @gross_value,
    discount = @discount,
    net_value = @net_value,
    commission = @commission
  WHERE id = @id
`);

const deleteSaleStmt = db.prepare('DELETE FROM sales WHERE id = ?');
const findSaleByOrderNumberStmt = db.prepare('SELECT id FROM sales WHERE order_number = ?');
const findSaleByIdStmt = db.prepare(`
  SELECT s.id,
         s.influencer_id,
         s.order_number,
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
         s.influencer_id,
         s.order_number,
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
    req.user = user;
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

const aceiteRouter = createAceiteRouter({ authenticate });
app.use('/api', aceiteRouter);

const trimString = (value) => (typeof value === 'string' ? value.trim() : value);

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

const normalizeOrderNumber = (value) => {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

const stripBom = (value) => {
  if (!value) return '';
  return value.replace(/^[\uFEFF\u200B]+/, '');
};

const normalizeImportHeader = (header) =>
  stripBom(String(header || '')).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

const detectImportDelimiter = (line) => {
  const tab = '\t';
  if (line.includes(tab)) return tab;
  if (line.includes(';')) return ';';
  if (line.includes(',')) return ',';
  return null;
};

const parseImportDecimal = (value) => {
  if (value == null) return { value: 0 };
  const trimmed = stripBom(String(value)).trim();
  if (!trimmed) return { value: 0 };
  let normalized = trimmed.replace(/\s+/g, '');
  if (normalized.includes('.') && normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return { error: 'Valor numerico invalido.' };
  }
  return { value: roundCurrency(parsed) };
};

const parseImportDate = (value) => {
  if (!value) {
    return { error: 'Informe a data da venda.' };
  }
  const trimmed = stripBom(String(value)).trim();
  if (!trimmed) {
    return { error: 'Informe a data da venda.' };
  }
  const match = trimmed.match(
    /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/
  );
  if (!match) {
    return { error: 'Data invalida. Use o formato DD/MM/AAAA.' };
  }
  let [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 100) {
    year += 2000;
  }
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) {
    return { error: 'Data invalida. Use o formato DD/MM/AAAA.' };
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return { error: 'Data invalida. Use o formato DD/MM/AAAA.' };
  }
  const iso = `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { value: iso };
};

const analyzeSalesImport = (rawText) => {
  const text = stripBom(trimString(rawText || ''));
  if (!text) {
    return { error: 'Cole os dados das vendas para realizar a importacao.' };
  }

  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      stripBom(line)
        .replace(/[\u0000-\u0008\u000A-\u001F]+/g, '')
        .trimEnd()
    );

  const columnAliases = {
    orderNumber: ['pedido', 'numero', 'ordem', 'ordernumber', 'numeropedido'],
    cupom: ['cupom', 'coupon'],
    date: ['data', 'date'],
    grossValue: ['valorbruto', 'bruto', 'gross', 'valor'],
    discount: ['desconto', 'discount']
  };

  const columnIndexes = { orderNumber: 0, cupom: 1, date: 2, grossValue: 3, discount: 4 };
  let delimiter = null;
  let dataStarted = false;
  let lineNumber = 0;

  const rows = [];

  for (const originalLine of lines) {
    lineNumber += 1;
    const line = originalLine.trim();
    if (!line) {
      continue;
    }

    if (!dataStarted) {
      delimiter = detectImportDelimiter(line) || delimiter;
      const tokens = delimiter ? line.split(delimiter) : line.split(/\s{2,}|\s/);
      const normalizedTokens = tokens.map((token) => normalizeImportHeader(token));
      const hasHeaderKeywords = normalizedTokens.some((token) => token.includes('pedido'));
      if (hasHeaderKeywords) {
        normalizedTokens.forEach((token, index) => {
          for (const [key, aliases] of Object.entries(columnAliases)) {
            if (aliases.includes(token)) {
              columnIndexes[key] = index;
              break;
            }
          }
        });
        dataStarted = true;
        continue;
      }
      dataStarted = true;
    }

    delimiter = detectImportDelimiter(line) || delimiter;
    const cells = delimiter ? line.split(delimiter) : line.split(/\s{2,}|\s/);

    const getCell = (column) => {
      const index = columnIndexes[column];
      if (index == null || index >= cells.length) return '';
      return stripBom(cells[index]).trim();
    };

    const orderCell = getCell('orderNumber');
    const cupomCell = getCell('cupom');
    const dateCell = getCell('date');
    const grossCell = getCell('grossValue');
    const discountCell = getCell('discount');

    const row = {
      line: lineNumber,
      orderNumber: orderCell,
      cupom: cupomCell,
      rawDate: dateCell,
      rawGross: grossCell,
      rawDiscount: discountCell,
      errors: []
    };

    const { value: isoDate, error: dateError } = parseImportDate(dateCell);
    if (dateError) {
      row.errors.push(dateError);
    }

    const grossParsed = parseImportDecimal(grossCell);
    if (grossParsed.error) {
      row.errors.push('Valor bruto invalido.');
    }

    const discountParsed = parseImportDecimal(discountCell);
    if (discountParsed.error) {
      row.errors.push('Desconto invalido.');
    }

    const normalizedPayload = {
      orderNumber: orderCell,
      cupom: cupomCell,
      date: isoDate,
      grossValue: grossParsed.value,
      discount: discountParsed.value
    };

    if (!row.errors.length) {
      const { data, error } = normalizeSaleBody({
        orderNumber: normalizedPayload.orderNumber,
        cupom: normalizedPayload.cupom,
        date: normalizedPayload.date,
        grossValue: normalizedPayload.grossValue,
        discount: normalizedPayload.discount
      });
      if (error) {
        row.errors.push(error.error || 'Linha invalida.');
      } else {
        row.normalized = data;
      }
    }

    rows.push(row);
  }

  if (!rows.length) {
    return { error: 'Nenhuma venda encontrada nos dados informados.' };
  }

  const orderOccurrences = new Map();
  rows.forEach((row) => {
    const order = normalizeOrderNumber(row.normalized?.orderNumber ?? row.orderNumber);
    if (!order) return;
    if (!orderOccurrences.has(order)) {
      orderOccurrences.set(order, []);
    }
    orderOccurrences.get(order).push(row);
  });

  const results = rows.map((row) => {
    if (!row.normalized) {
      return {
        line: row.line,
        orderNumber: normalizeOrderNumber(row.orderNumber),
        cupom: trimString(row.cupom) || '',
        date: null,
        grossValue: null,
        discount: null,
        netValue: null,
        commission: null,
        influencerId: null,
        influencerName: null,
        commissionRate: null,
        errors: row.errors,
        rawDate: row.rawDate,
        rawGross: row.rawGross,
        rawDiscount: row.rawDiscount
      };
    }

    const normalizedOrder = normalizeOrderNumber(row.normalized.orderNumber);
    const influencer = findInfluencerByCouponStmt.get(row.normalized.cupom);
    if (!influencer) {
      row.errors.push('Cupom nao cadastrado.');
    }

    const duplicateRows = orderOccurrences.get(normalizedOrder) || [];
    if (duplicateRows.length > 1) {
      row.errors.push('Numero de pedido repetido nos dados importados.');
    }

    const existingSale = normalizedOrder ? findSaleByOrderNumberStmt.get(normalizedOrder) : null;
    if (existingSale) {
      row.errors.push('Numero de pedido ja cadastrado.');
    }

    const commissionRate = influencer?.commission_rate != null ? Number(influencer.commission_rate) : 0;
    const totals = computeSaleTotals(row.normalized.grossValue, row.normalized.discount, commissionRate);

    return {
      line: row.line,
      orderNumber: normalizedOrder,
      cupom: row.normalized.cupom,
      date: row.normalized.date,
      grossValue: row.normalized.grossValue,
      discount: row.normalized.discount,
      netValue: totals.netValue,
      commission: totals.commissionValue,
      influencerId: influencer?.id ?? null,
      influencerName: influencer?.nome ?? null,
      commissionRate,
      errors: row.errors,
      rawDate: row.rawDate,
      rawGross: row.rawGross,
      rawDiscount: row.rawDiscount
    };
  });

  const validRows = results.filter((row) => !row.errors.length);
  const summary = {
    count: validRows.length,
    totalGross: roundCurrency(validRows.reduce((sum, row) => sum + row.grossValue, 0)),
    totalDiscount: roundCurrency(validRows.reduce((sum, row) => sum + row.discount, 0)),
    totalNet: roundCurrency(validRows.reduce((sum, row) => sum + row.netValue, 0)),
    totalCommission: roundCurrency(validRows.reduce((sum, row) => sum + row.commission, 0))
  };

  return {
    rows: results,
    summary,
    totalCount: results.length,
    validCount: validRows.length,
    errorCount: results.length - validRows.length,
    hasErrors: results.some((row) => row.errors.length > 0)
  };
};

const insertImportedSales = db.transaction((rows) => {
  const created = [];
  rows.forEach((row) => {
    const result = insertSaleStmt.run({
      influencer_id: row.influencerId,
      order_number: row.orderNumber,
      date: row.date,
      gross_value: row.grossValue,
      discount: row.discount,
      net_value: row.netValue,
      commission: row.commission
    });
    const sale = findSaleByIdStmt.get(result.lastInsertRowid);
    created.push(formatSaleRow(sale));
  });
  return created;
});

const formatSaleRow = (row) => {
  const orderNumber = normalizeOrderNumber(
    row?.order_number ?? row?.orderNumber ?? row?.pedido ?? null
  );

  return {
    id: row.id,
    influencer_id: row.influencer_id,
    order_number: orderNumber,
    orderNumber,
    cupom: row.cupom || null,
    nome: row.nome || null,
    date: row.date,
    gross_value: Number(row.gross_value),
    discount: Number(row.discount),
    net_value: Number(row.net_value),
    commission: Number(row.commission),
    commission_rate: row.commission_rate != null ? Number(row.commission_rate) : 0,
    created_at: row.created_at
  };
};

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
  const orderNumberRaw = body?.orderNumber ?? body?.order_number ?? body?.pedido ?? body?.order;
  const orderNumber = orderNumberRaw == null ? '' : String(trimString(orderNumberRaw)).trim();
  const cupom = trimString(body?.cupom);
  const date = trimString(body?.date);
  const grossRaw = body?.grossValue ?? body?.gross_value;
  const discountRaw = body?.discount ?? body?.discountValue ?? body?.discount_value ?? 0;

  if (!orderNumber) {
    return { error: { error: 'Informe o numero do pedido.' } };
  }
  if (orderNumber.length > 100) {
    return { error: { error: 'Numero do pedido deve ter no maximo 100 caracteres.' } };
  }
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
      orderNumber,
      cupom,
      date,
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
  const { data, error } = normalizeInfluencerPayload(req.body || {});

  if (error) {
    return res.status(400).json(error);
  }

  const cpfDigits = normalizeDigits(req.body?.cpf || data?.cpf || '');
  if (cpfDigits.length !== 11) {
    return res.status(400).json({ error: 'Informe um CPF valido para gerar a senha provisoria.' });
  }

  const loginEmail = trimString(req.body?.loginEmail) || data.email;
  if (!loginEmail || !validators.email(loginEmail)) {
    return res.status(400).json({ error: 'Informe um email valido para acesso.' });
  }

  if (findUserByEmailStmt.get(loginEmail)) {
    return res.status(409).json({ error: 'Email de login ja cadastrado.' });
  }

  const provisionalPassword = cpfDigits;
  const passwordHash = await bcrypt.hash(provisionalPassword, 10);
  const signatureCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const signatureCodeHash = await bcrypt.hash(signatureCode, 10);
  const generatedAt = new Date().toISOString();

  try {
    const { influencerId } = createInfluencerTransaction(
      {
        ...data,
        contract_signature_code_hash: signatureCodeHash,
        contract_signature_code_generated_at: generatedAt
      },
      { email: loginEmail, passwordHash, mustChange: 0 }
    );
    const influencer = findInfluencerByIdStmt.get(influencerId);
    return res.status(201).json({
      ...influencer,
      login_email: loginEmail,
      senha_provisoria: provisionalPassword,
      codigo_assinatura: signatureCode
    });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Instagram ou email ja cadastrado.' });
    }
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Registro duplicado. Verifique os dados informados.' });
    }
    console.error('Erro ao cadastrar influenciadora:', err);
    return res.status(500).json({ error: 'Nao foi possivel cadastrar a influenciadora.' });
  }
});
app.get('/influenciadora/:id', authenticate, verificarAceite, (req, res) => {
  const { influencer, status, message } = ensureInfluencerAccess(req, req.params.id);
  if (!influencer) {
    return res.status(status).json({ error: message });
  }
  return res.status(200).json(influencer);
});



app.put('/influenciadora/:id', authenticate, verificarAceite, async (req, res) => {
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

app.post('/sales/import/preview', authenticate, authorizeMaster, (req, res) => {
  const text = req.body?.text ?? req.body?.data ?? '';
  const analysis = analyzeSalesImport(text);
  if (analysis.error) {
    return res.status(400).json({ error: analysis.error });
  }
  return res.status(200).json(analysis);
});

app.post('/sales/import/confirm', authenticate, authorizeMaster, (req, res) => {
  const text = req.body?.text ?? req.body?.data ?? '';
  const analysis = analyzeSalesImport(text);
  if (analysis.error) {
    return res.status(400).json({ error: analysis.error });
  }
  if (!analysis.totalCount) {
    return res.status(400).json({ error: 'Nenhuma venda valida para importar.' });
  }
  if (analysis.hasErrors || analysis.validCount !== analysis.totalCount) {
    return res
      .status(409)
      .json({ error: 'Nao foi possivel importar. Corrija os erros identificados e tente novamente.', analysis });
  }

  try {
    const created = insertImportedSales(analysis.rows);
    return res.status(201).json({
      inserted: created.length,
      rows: created,
      summary: analysis.summary
    });
  } catch (error) {
    if (error && (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'ER_DUP_ENTRY')) {
      return res.status(409).json({ error: 'Numero de pedido ja cadastrado.' });
    }
    console.error('Erro ao importar vendas:', error);
    return res.status(500).json({ error: 'Nao foi possivel concluir a importacao.' });
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

  const existingSale = findSaleByOrderNumberStmt.get(data.orderNumber);
  if (existingSale) {
    return res.status(409).json({ error: 'Ja existe uma venda com esse numero de pedido.' });
  }

  const { netValue, commissionValue } = computeSaleTotals(data.grossValue, data.discount, influencer.commission_rate || 0);

  try {
    const result = insertSaleStmt.run({
      influencer_id: influencer.id,
      order_number: data.orderNumber,
      date: data.date,
      gross_value: data.grossValue,
      discount: data.discount,
      net_value: netValue,
      commission: commissionValue
    });
    const created = findSaleByIdStmt.get(result.lastInsertRowid);
    return res.status(201).json(formatSaleRow(created));
  } catch (err) {
    if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'ER_DUP_ENTRY')) {
      return res.status(409).json({ error: 'Ja existe uma venda com esse numero de pedido.' });
    }
    console.error('Erro ao cadastrar venda:', err);
    return res.status(500).json({ error: 'Nao foi possivel cadastrar a venda.' });
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

  const conflictingSale = findSaleByOrderNumberStmt.get(data.orderNumber);
  if (conflictingSale && conflictingSale.id !== saleId) {
    return res.status(409).json({ error: 'Ja existe uma venda com esse numero de pedido.' });
  }

  const { netValue, commissionValue } = computeSaleTotals(data.grossValue, data.discount, influencer.commission_rate || 0);

  try {
    updateSaleStmt.run({
      id: saleId,
      influencer_id: influencer.id,
      order_number: data.orderNumber,
      date: data.date,
      gross_value: data.grossValue,
      discount: data.discount,
      net_value: netValue,
      commission: commissionValue
    });

    const updated = findSaleByIdStmt.get(saleId);
    return res.status(200).json(formatSaleRow(updated));
  } catch (err) {
    if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'ER_DUP_ENTRY')) {
      return res.status(409).json({ error: 'Ja existe uma venda com esse numero de pedido.' });
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

app.get('/sales/summary/:influencerId', authenticate, verificarAceite, (req, res) => {
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

app.get('/sales/:influencerId', authenticate, verificarAceite, (req, res) => {
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

app.get('/influenciadoras', authenticate, verificarAceite, (req, res) => {
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
