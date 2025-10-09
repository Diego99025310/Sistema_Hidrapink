const crypto = require('crypto');
const fs = require('fs');

const lerArquivo = (caminho) => {
  const buffer = fs.readFileSync(caminho);
  return buffer.toString('utf8');
};

const gerarHashTermo = (caminho) => {
  if (!caminho) {
    throw new Error('Caminho do termo nao informado.');
  }
  const conteudo = lerArquivo(caminho);
  return crypto.createHash('sha256').update(conteudo).digest('hex');
};

module.exports = {
  gerarHashTermo
};
