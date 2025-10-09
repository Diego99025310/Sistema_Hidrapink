# Configuracao de envio de emails

O fluxo de aceite eletronico usa o Nodemailer para enviar o codigo de verificacao por e-mail. O comportamento varia de acordo com as variaveis de ambiente configuradas na aplicacao.

## Ambiente de producao

Configure o servidor SMTP utilizado pela HidraPink definindo as variaveis abaixo antes de iniciar o servidor:

- `SMTP_HOST`: endereco do servidor SMTP.
- `SMTP_PORT`: porta (padrão 587).
- `SMTP_SECURE`: `true` para conexao TLS implicita (porta 465), `false` caso contrario.
- `SMTP_USER`: usuario para autenticacao (opcional caso o servidor permita envio sem autenticacao).
- `SMTP_PASS`: senha do usuario SMTP.
- `SMTP_FROM`: (opcional) remetente exibido no e-mail. Padrao: `HidraPink <no-reply@hidrapink.com.br>`.

Com esses valores definidos o sistema enviara os codigos diretamente por meio do servidor informado.

## Ambiente de desenvolvimento

Se nenhum `SMTP_HOST` for informado, o sistema cria automaticamente uma conta de teste no [Ethereal Email](https://ethereal.email/). Nao ha envio real de mensagens nesse modo. O console da aplicacao exibira:

- As credenciais geradas para a conta de teste.
- A URL de visualizacao do e-mail com o codigo enviado.

Use o link impresso no console para abrir o conteudo da mensagem e validar o fluxo durante os testes.

## Tratamento de erros

Caso os dados obrigatorios (endereco de e-mail do usuario ou codigo de verificacao) nao estejam disponiveis, o processo e interrompido com uma excecao que e tratada pelas rotas de API. Consulte os logs do servidor para diagnosticar problemas de envio.
