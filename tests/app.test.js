const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { gerarHashTermo } = require('../src/utils/hash');

const tempDbPath = path.join(__dirname, '..', 'test.sqlite');

if (fs.existsSync(tempDbPath)) {
  fs.unlinkSync(tempDbPath);
}
process.env.DATABASE_PATH = tempDbPath;
process.env.JWT_SECRET = 'test-secret';

const app = require('../src/server');
const db = require('../src/database');

const selectSaleOrderNumberStmt = db.prepare('SELECT order_number FROM sales WHERE id = ?');

const MASTER_EMAIL = process.env.MASTER_EMAIL || 'master@example.com';
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'master123';

const resetDb = () => {
  db.exec('DELETE FROM sales;');
  db.exec('DELETE FROM aceite_termos;');
  db.exec('DELETE FROM tokens_verificacao;');
  db.exec('DELETE FROM influenciadoras;');
  db.prepare('DELETE FROM users WHERE email != ?').run(MASTER_EMAIL);
};

const termoPath = path.join(__dirname, '..', 'public', 'termos', 'parceria-v1.html');

const registrarAceiteTeste = (userId) => {
  if (!userId) return;
  const hash = gerarHashTermo(termoPath);
  db.prepare(
    `INSERT INTO aceite_termos (
      user_id,
      versao_termo,
      hash_termo,
      data_aceite,
      ip_usuario,
      user_agent,
      canal_autenticacao,
      status
    ) VALUES (?, '1.0', ?, datetime('now'), '127.0.0.1', 'test-runner', 'token_email', 'aceito')`
  ).run(userId, hash);
};

const login = (email, password) =>
  request(app)
    .post('/login')
    .send({ email, password });

const authenticateMaster = async () => {
  const response = await login(MASTER_EMAIL, MASTER_PASSWORD);
  assert.strictEqual(response.status, 200, 'Master login deve retornar 200');
  assert.ok(response.body.token, 'Master login deve retornar token');
  return response.body.token;
};

test('master pode registrar novo usuario e realizar login', async () => {
  resetDb();

  const masterToken = await authenticateMaster();

  const registerResponse = await request(app)
    .post('/register')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ email: 'novo.master@example.com', password: 'novaSenha123', role: 'master' });

  assert.strictEqual(registerResponse.status, 201);
  assert.strictEqual(registerResponse.body.email, 'novo.master@example.com');
  assert.strictEqual(registerResponse.body.role, 'master');
  assert.ok(registerResponse.body.id);

  const newLogin = await login('novo.master@example.com', 'novaSenha123');
  assert.strictEqual(newLogin.status, 200);
  assert.strictEqual(newLogin.body.user.role, 'master');
  assert.ok(newLogin.body.token);
});

const influencerPayload = {
  nome: 'Influencer 1',
  instagram: '@influencer',
  cpf: '52998224725',
  email: 'influencer@example.com',
  contato: '11988887777',
  cupom: 'CUPOM10',
  commissionPercent: 12.5,
  cep: '01001000',
  numero: '123',
  complemento: 'Apto 42',
  logradouro: 'Rua Teste',
  bairro: 'Centro',
  cidade: 'Sao Paulo',
  estado: 'SP'
};

test('fluxo simples de influenciadora com login e exclusao', async () => {
  resetDb();

  const masterToken = await authenticateMaster();

  const createResponse = await request(app)
    .post('/influenciadora')
    .set('Authorization', `Bearer ${masterToken}`)
    .send(influencerPayload);

  assert.strictEqual(createResponse.status, 201);
  const influencerId = createResponse.body.id;
  assert.ok(influencerId);
  assert.strictEqual(Number(createResponse.body.commission_rate), influencerPayload.commissionPercent);
  assert.strictEqual(createResponse.body.login_email, influencerPayload.email);
  assert.ok(createResponse.body.senha_provisoria);
  assert.strictEqual(createResponse.body.senha_provisoria.length, 6);
  assert.match(createResponse.body.senha_provisoria, /^\d{6}$/);
  assert.ok(createResponse.body.codigo_assinatura);
  assert.strictEqual(createResponse.body.codigo_assinatura.length, 6);
  assert.strictEqual(Number(createResponse.body.contract_signature_waived), 0);

  const influencerLogin = await login(createResponse.body.login_email, createResponse.body.senha_provisoria);
  assert.strictEqual(influencerLogin.status, 200);
  assert.strictEqual(influencerLogin.body.user.role, 'influencer');
  assert.ok(influencerLogin.body.token);

  const updateResponse = await request(app)
    .put(`/influenciadora/${influencerId}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      ...influencerPayload,
      contato: '21991234567',
      commissionPercent: 15,
      loginPassword: 'NovaSenha456'
    });

  assert.strictEqual(updateResponse.status, 200);
  assert.strictEqual(updateResponse.body.contato, '(21) 99123-4567');
  assert.strictEqual(Number(updateResponse.body.commission_rate), 15);
  assert.strictEqual(Number(updateResponse.body.contract_signature_waived), 0);

  const newLogin = await login(influencerPayload.email, 'NovaSenha456');
  assert.strictEqual(newLogin.status, 200);
  assert.ok(newLogin.body.token);

  const deleteResponse = await request(app)
    .delete(`/influenciadora/${influencerId}`)
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(deleteResponse.status, 200);
});

test('dispensa de contrato permite acesso sem aceite', async () => {
  resetDb();

  const masterToken = await authenticateMaster();

  const createResponse = await request(app)
    .post('/influenciadora')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ ...influencerPayload, contractSignatureWaived: true });

  assert.strictEqual(createResponse.status, 201);
  const influencerId = createResponse.body.id;
  assert.ok(influencerId);
  assert.strictEqual(Number(createResponse.body.contract_signature_waived), 1);
  assert.ok(!createResponse.body.codigo_assinatura);

  const provisionalPassword = createResponse.body.senha_provisoria;
  assert.ok(provisionalPassword);
  assert.strictEqual(provisionalPassword.length, 6);
  assert.match(provisionalPassword, /^\d{6}$/);

  const influencerLogin = await login(createResponse.body.login_email, provisionalPassword);
  assert.strictEqual(influencerLogin.status, 200);
  const influencerToken = influencerLogin.body.token;
  assert.ok(influencerToken);

  const profileResponse = await request(app)
    .get(`/influenciadora/${influencerId}`)
    .set('Authorization', `Bearer ${influencerToken}`);
  assert.strictEqual(profileResponse.status, 200);

  const acceptanceStatus = await request(app)
    .get('/api/verificar-aceite')
    .set('Authorization', `Bearer ${influencerToken}`);
  assert.strictEqual(acceptanceStatus.status, 200);
  assert.strictEqual(acceptanceStatus.body.aceito, true);
  assert.strictEqual(acceptanceStatus.body.dispensado, true);

  const contractResponse = await request(app)
    .get('/api/contrato-assinado')
    .set('Authorization', `Bearer ${influencerToken}`);
  assert.strictEqual(contractResponse.status, 404);
  assert.match(contractResponse.body.error, /dispensad/i);

  const updateResponse = await request(app)
    .put(`/influenciadora/${influencerId}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      ...influencerPayload,
      contractSignatureWaived: false,
      commissionPercent: influencerPayload.commissionPercent,
      loginEmail: influencerPayload.email
    });

  assert.strictEqual(updateResponse.status, 200);
  assert.strictEqual(Number(updateResponse.body.contract_signature_waived), 0);
  assert.ok(updateResponse.body.codigo_assinatura);
  assert.strictEqual(updateResponse.body.codigo_assinatura.length, 6);

  const restrictedAccess = await request(app)
    .get(`/influenciadora/${influencerId}`)
    .set('Authorization', `Bearer ${influencerToken}`);
  assert.strictEqual(restrictedAccess.status, 428);
  assert.match(restrictedAccess.body.error, /Aceite do termo/i);

  const pendingAcceptance = await request(app)
    .get('/api/verificar-aceite')
    .set('Authorization', `Bearer ${influencerToken}`);
  assert.strictEqual(pendingAcceptance.status, 200);
  assert.strictEqual(pendingAcceptance.body.aceito, false);
  assert.ok(!pendingAcceptance.body.dispensado);
});

test('gestao de vendas vinculada a influenciadora', async () => {
  resetDb();

  const masterToken = await authenticateMaster();

  const createInfluencer = await request(app)
    .post('/influenciadora')
    .set('Authorization', `Bearer ${masterToken}`)
    .send(influencerPayload);

  assert.strictEqual(createInfluencer.status, 201);
  const influencerId = createInfluencer.body.id;

  const saleResponse = await request(app)
    .post('/sales')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      orderNumber: 'PED-001',
      cupom: influencerPayload.cupom,
      date: '2025-10-01',
      grossValue: 1000,
      discount: 100
    });

  assert.strictEqual(saleResponse.status, 201);
  assert.strictEqual(saleResponse.body.order_number, 'PED-001');
  assert.strictEqual(Number(saleResponse.body.net_value), 900);
  assert.strictEqual(Number(saleResponse.body.commission), 112.5);
  const saleId = saleResponse.body.id;

  const createdSaleRecord = selectSaleOrderNumberStmt.get(saleId);
  assert.ok(createdSaleRecord, 'Venda deve ser persistida no banco de dados.');
  assert.strictEqual(createdSaleRecord.order_number, 'PED-001');

  const listSales = await request(app)
    .get(`/sales/${influencerId}`)
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(listSales.status, 200);
  assert.strictEqual(listSales.body.length, 1);

  const summaryInitial = await request(app)
    .get(`/sales/summary/${influencerId}`)
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(summaryInitial.status, 200);
  assert.strictEqual(Number(summaryInitial.body.total_net), 900);
  assert.strictEqual(Number(summaryInitial.body.total_commission), 112.5);

  const consultResponse = await request(app)
    .get('/influenciadoras/consulta')
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(consultResponse.status, 200);
  const consultRow = consultResponse.body.find((row) => row.id === influencerId);
  assert.ok(consultRow, 'Resumo deve incluir influenciadora criada');
  assert.strictEqual(Number(consultRow.vendas_count), 1);
  assert.strictEqual(Number(consultRow.vendas_total), 900);

  const duplicateSale = await request(app)
    .post('/sales')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      orderNumber: 'PED-001',
      cupom: influencerPayload.cupom,
      date: '2025-10-04',
      grossValue: 800,
      discount: 0
    });
  assert.strictEqual(duplicateSale.status, 409);
  assert.match(duplicateSale.body.error, /numero de pedido/i);

  const secondSaleResponse = await request(app)
    .post('/sales')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      orderNumber: 'PED-002',
      cupom: influencerPayload.cupom,
      date: '2025-10-05',
      grossValue: 500,
      discount: 0
    });
  assert.strictEqual(secondSaleResponse.status, 201);
  const secondSaleId = secondSaleResponse.body.id;
  const secondSaleRecord = selectSaleOrderNumberStmt.get(secondSaleId);
  assert.ok(secondSaleRecord, 'Segunda venda deve ser persistida.');
  assert.strictEqual(secondSaleRecord.order_number, 'PED-002');

  const conflictingUpdate = await request(app)
    .put(`/sales/${saleId}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      orderNumber: 'PED-002',
      cupom: influencerPayload.cupom,
      date: '2025-10-06',
      grossValue: 1000,
      discount: 50
    });
  assert.strictEqual(conflictingUpdate.status, 409);
  assert.match(conflictingUpdate.body.error, /numero de pedido/i);

  const updateSale = await request(app)
    .put(`/sales/${saleId}`)
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      orderNumber: 'PED-001-ALT',
      cupom: influencerPayload.cupom,
      date: '2025-10-02',
      grossValue: 1000,
      discount: 50
    });
  assert.strictEqual(updateSale.status, 200);
  assert.strictEqual(updateSale.body.order_number, 'PED-001-ALT');
  assert.strictEqual(Number(updateSale.body.net_value), 950);
  assert.strictEqual(Number(updateSale.body.commission), 118.75);

  const updatedSaleRecord = selectSaleOrderNumberStmt.get(saleId);
  assert.ok(updatedSaleRecord, 'Venda atualizada deve existir no banco de dados.');
  assert.strictEqual(updatedSaleRecord.order_number, 'PED-001-ALT');

  const consultAfterUpdate = await request(app)
    .get('/influenciadoras/consulta')
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(consultAfterUpdate.status, 200);
  const consultRowUpdated = consultAfterUpdate.body.find((row) => row.id === influencerId);
  assert.ok(consultRowUpdated);
  assert.strictEqual(Number(consultRowUpdated.vendas_count), 2);
  assert.strictEqual(Number(consultRowUpdated.vendas_total), 1450);

  const influencerLogin = await login(
    createInfluencer.body.login_email,
    createInfluencer.body.senha_provisoria
  );
  assert.strictEqual(influencerLogin.status, 200);
  const influencerToken = influencerLogin.body.token;
  registrarAceiteTeste(influencerLogin.body.user?.id);

  const unauthorizedConsult = await request(app)
    .get('/influenciadoras/consulta')
    .set('Authorization', `Bearer ${influencerToken}`);
  assert.strictEqual(unauthorizedConsult.status, 403);

  const unauthorizedSale = await request(app)
    .post('/sales')
    .set('Authorization', `Bearer ${influencerToken}`)
    .send({ cupom: influencerPayload.cupom, date: '2025-10-03', grossValue: 500, discount: 0 });
  assert.strictEqual(unauthorizedSale.status, 403);

  const influencerSalesView = await request(app)
    .get(`/sales/${influencerId}`)
    .set('Authorization', `Bearer ${influencerToken}`);
  assert.strictEqual(influencerSalesView.status, 200);
  assert.strictEqual(influencerSalesView.body.length, 2);

  const summaryAfterUpdate = await request(app)
    .get(`/sales/summary/${influencerId}`)
    .set('Authorization', `Bearer ${influencerToken}`);
  assert.strictEqual(summaryAfterUpdate.status, 200);
  assert.strictEqual(Number(summaryAfterUpdate.body.total_net), 1450);
  assert.strictEqual(Number(summaryAfterUpdate.body.total_commission), 181.25);

  const deleteSale = await request(app)
    .delete(`/sales/${saleId}`)
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(deleteSale.status, 200);

  const summaryAfterDelete = await request(app)
    .get(`/sales/summary/${influencerId}`)
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(summaryAfterDelete.status, 200);
  assert.strictEqual(Number(summaryAfterDelete.body.total_net), 500);
  assert.strictEqual(Number(summaryAfterDelete.body.total_commission), 62.5);

  const consultAfterDelete = await request(app)
    .get('/influenciadoras/consulta')
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(consultAfterDelete.status, 200);
  const consultRowAfterDelete = consultAfterDelete.body.find((row) => row.id === influencerId);
  assert.ok(consultRowAfterDelete);
  assert.strictEqual(Number(consultRowAfterDelete.vendas_count), 1);
  assert.strictEqual(Number(consultRowAfterDelete.vendas_total), 500);
});

test('importacao em massa de vendas com validacao', async () => {
  resetDb();

  const masterToken = await authenticateMaster();

  const biaPayload = {
    ...influencerPayload,
    nome: 'Bia Influencer',
    instagram: '@bia',
    email: 'bia.influencer@example.com',
    contato: '11999990000',
    cupom: 'BIA8',
    cpf: '39053344705',
    loginEmail: 'bia.login@example.com',
    loginPassword: 'SenhaBia123'
  };

  const ingridPayload = {
    ...influencerPayload,
    nome: 'Ingrid Influencer',
    instagram: '@ingrid',
    email: 'ingrid.influencer@example.com',
    contato: '11999990001',
    cupom: 'INGRID',
    cpf: '15350946056',
    loginEmail: 'ingrid.login@example.com',
    loginPassword: 'SenhaIngrid123'
  };

  const biaResponse = await request(app)
    .post('/influenciadora')
    .set('Authorization', `Bearer ${masterToken}`)
    .send(biaPayload);
  assert.strictEqual(biaResponse.status, 201);

  const ingridResponse = await request(app)
    .post('/influenciadora')
    .set('Authorization', `Bearer ${masterToken}`)
    .send(ingridPayload);
  assert.strictEqual(ingridResponse.status, 201);

  const textWithUnknownCoupon = [
    'Pedido\tCupom\tData\tValor bruto\tDesconto',
    '#1040\tBIA8\t02/08/2025 18:08\t62.47\t',
    '#1041\tINGRID\t02/08/2025 22:25\t62.47\t0',
    '#1042\tNAOEXISTE\t03/08/2025 10:00\t50,00\t0'
  ].join('\n');

  const previewWithError = await request(app)
    .post('/sales/import/preview')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ text: textWithUnknownCoupon });

  assert.strictEqual(previewWithError.status, 200);
  assert.strictEqual(previewWithError.body.hasErrors, true);
  const unknownRow = previewWithError.body.rows.find((row) => row.cupom === 'NAOEXISTE');
  assert.ok(unknownRow, 'Linha com cupom desconhecido deve ser retornada.');
  assert.ok(
    unknownRow.errors.some((message) => /cupom nao cadastrado/i.test(message)),
    'Mensagem deve indicar cupom nao cadastrado.'
  );

  const validText = [
    'Pedido\tCupom\tData\tValor bruto\tDesconto',
    '#1040\tBIA8\t02/08/2025 18:08\t62.47\t',
    '#1041\tINGRID\t02/08/2025 22:25\t62.47\t0'
  ].join('\n');

  const validPreview = await request(app)
    .post('/sales/import/preview')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ text: validText });

  assert.strictEqual(validPreview.status, 200);
  assert.strictEqual(validPreview.body.hasErrors, false);
  assert.strictEqual(validPreview.body.validCount, 2);
  assert.strictEqual(Number(validPreview.body.summary.totalNet), 124.94);

  const confirmImport = await request(app)
    .post('/sales/import/confirm')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ text: validText });

  assert.strictEqual(confirmImport.status, 201);
  assert.strictEqual(confirmImport.body.inserted, 2);

  const biaSales = await request(app)
    .get(`/sales/${biaResponse.body.id}`)
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(biaSales.status, 200);
  assert.strictEqual(biaSales.body.length, 1);

  const duplicatePreview = await request(app)
    .post('/sales/import/preview')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ text: validText });

  assert.strictEqual(duplicatePreview.status, 200);
  assert.strictEqual(duplicatePreview.body.hasErrors, true);
  duplicatePreview.body.rows.forEach((row) => {
    assert.ok(row.errors.some((message) => /pedido ja cadastrado/i.test(message)));
  });

  const duplicateConfirm = await request(app)
    .post('/sales/import/confirm')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({ text: validText });

  assert.strictEqual(duplicateConfirm.status, 409);
});

after(() => {
  db.close();
  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }
});
