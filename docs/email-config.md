# Configuracao de envio de emails

O fluxo de aceite eletronico usa o Nodemailer para enviar o codigo de verificacao por e-mail. O comportamento varia de acordo com as variaveis de ambiente configuradas na aplicacao.

## Ambiente de producao

Configure o servidor SMTP utilizado pela HidraPink definindo as variaveis abaixo antes de iniciar o servidor.
Em desenvolvimento local, basta ajustar o arquivo `.env` (copiado a partir de `.env.example`).

- `SMTP_HOST`: endereco do servidor SMTP.
- `SMTP_PORT`: porta (padrão 587).
- `SMTP_SECURE`: `true` para conexao TLS implicita (porta 465), `false` caso contrario.
- `SMTP_REJECT_UNAUTHORIZED`: defina como `false` para aceitar certificados autoassinados (padrao: `true`).
- `SMTP_USER`: usuario para autenticacao (opcional caso o servidor permita envio sem autenticacao).
- `SMTP_PASS`: senha do usuario SMTP.
- `SMTP_FROM`: (opcional) remetente exibido no e-mail. Padrao: `HidraPink <no-reply@hidrapink.com.br>`.

Com esses valores definidos o sistema enviara os codigos diretamente por meio do servidor informado.

> ⚠️ **Atencao:** aceitar certificados autoassinados (`SMTP_REJECT_UNAUTHORIZED=false`) deve ser usado apenas quando o servidor SMTP utiliza certificados internos. Em ambientes de producao recomenda-se manter a validacao de certificados habilitada.

### Exemplo com Zoho Mail

Para contas hospedadas no Zoho Mail utilize a configuracao abaixo (substitua a senha por um [app password do Zoho](https://www.zoho.com/mail/help/adminconsole/mail-password-policy.html#alink3) ou pela senha autorizada para SMTP):

```env
SMTP_HOST=smtp.zoho.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=diego@hidrapink.com.br
SMTP_PASS="<senha ou app password>"
SMTP_FROM="HidraPink <diego@hidrapink.com.br>"
```

O Zoho exige conexao segura na porta 465. Nao e necessario alterar `SMTP_REJECT_UNAUTHORIZED`, pois os certificados do Zoho sao reconhecidos publicamente. Caso utilize autenticao em duas etapas, crie uma senha especifica de aplicativo para o envio.

## Ambiente de desenvolvimento

Se nenhum `SMTP_HOST` for informado (ou se voce remover as linhas correspondentes no `.env`), o sistema cria automaticamente uma conta de teste no [Ethereal Email](https://ethereal.email/). Nao ha envio real de mensagens nesse modo. O console da aplicacao exibira:

- As credenciais geradas para a conta de teste.
- A URL de visualizacao do e-mail com o codigo enviado.

Use o link impresso no console para abrir o conteudo da mensagem e validar o fluxo durante os testes.

## Tratamento de erros

Caso os dados obrigatorios (endereco de e-mail do usuario ou codigo de verificacao) nao estejam disponiveis, o processo e interrompido com uma excecao que e tratada pelas rotas de API. Consulte os logs do servidor para diagnosticar problemas de envio.
