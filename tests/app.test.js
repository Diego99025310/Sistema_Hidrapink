const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const tempDbPath = path.join(__dirname, '..', 'test.sqlite');

if (fs.existsSync(tempDbPath)) {
  fs.unlinkSync(tempDbPath);
}
process.env.DATABASE_PATH = tempDbPath;
process.env.JWT_SECRET = 'test-secret';

const app = require('../src/server');
const db = require('../src/database');

const MASTER_EMAIL = process.env.MASTER_EMAIL || 'master@example.com';
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'master123';

const resetDb = () => {
  db.exec('DELETE FROM sales;');
  db.exec('DELETE FROM influenciadoras;');
  db.prepare('DELETE FROM users WHERE email != ?').run(MASTER_EMAIL);
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
    .send({
      ...influencerPayload,
      loginEmail: 'influencer.login@example.com',
      loginPassword: 'SenhaSegura123'
    });

  assert.strictEqual(createResponse.status, 201);
  const influencerId = createResponse.body.id;
  assert.ok(influencerId);
  assert.strictEqual(Number(createResponse.body.commission_rate), influencerPayload.commissionPercent);

  const influencerLogin = await login('influencer.login@example.com', 'SenhaSegura123');
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

  const newLogin = await login('influencer.login@example.com', 'NovaSenha456');
  assert.strictEqual(newLogin.status, 200);
  assert.ok(newLogin.body.token);

  const deleteResponse = await request(app)
    .delete(`/influenciadora/${influencerId}`)
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(deleteResponse.status, 200);
});

test('gestao de vendas vinculada a influenciadora', async () => {
  resetDb();

  const masterToken = await authenticateMaster();

  const createInfluencer = await request(app)
    .post('/influenciadora')
    .set('Authorization', `Bearer ${masterToken}`)
    .send({
      ...influencerPayload,
      loginEmail: 'vendas.influencer@example.com',
      loginPassword: 'SenhaInfluencer123'
    });

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

  const consultAfterUpdate = await request(app)
    .get('/influenciadoras/consulta')
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(consultAfterUpdate.status, 200);
  const consultRowUpdated = consultAfterUpdate.body.find((row) => row.id === influencerId);
  assert.ok(consultRowUpdated);
  assert.strictEqual(Number(consultRowUpdated.vendas_count), 1);
  assert.strictEqual(Number(consultRowUpdated.vendas_total), 950);

  const influencerLogin = await login('vendas.influencer@example.com', 'SenhaInfluencer123');
  assert.strictEqual(influencerLogin.status, 200);
  const influencerToken = influencerLogin.body.token;

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
  assert.strictEqual(influencerSalesView.body.length, 1);

  const summaryAfterUpdate = await request(app)
    .get(`/sales/summary/${influencerId}`)
    .set('Authorization', `Bearer ${influencerToken}`);
  assert.strictEqual(summaryAfterUpdate.status, 200);
  assert.strictEqual(Number(summaryAfterUpdate.body.total_net), 950);
  assert.strictEqual(Number(summaryAfterUpdate.body.total_commission), 118.75);

  const deleteSale = await request(app)
    .delete(`/sales/${saleId}`)
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(deleteSale.status, 200);

  const summaryAfterDelete = await request(app)
    .get(`/sales/summary/${influencerId}`)
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(summaryAfterDelete.status, 200);
  assert.strictEqual(Number(summaryAfterDelete.body.total_net), 0);
  assert.strictEqual(Number(summaryAfterDelete.body.total_commission), 0);

  const consultAfterDelete = await request(app)
    .get('/influenciadoras/consulta')
    .set('Authorization', `Bearer ${masterToken}`);
  assert.strictEqual(consultAfterDelete.status, 200);
  const consultRowAfterDelete = consultAfterDelete.body.find((row) => row.id === influencerId);
  assert.ok(consultRowAfterDelete);
  assert.strictEqual(Number(consultRowAfterDelete.vendas_count), 0);
  assert.strictEqual(Number(consultRowAfterDelete.vendas_total), 0);
});

after(() => {
  db.close();
  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }
});
