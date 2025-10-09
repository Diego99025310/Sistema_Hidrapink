# Ambiente de desenvolvimento local

Este guia descreve os passos necessarios para subir o sistema HidraPink em um computador local, incluindo a configuracao das variaveis de ambiente e o fluxo de aceite do termo.

## 1. Dependencias

- Node.js 18 ou superior
- npm (instalado junto com o Node.js)

Execute `npm install` na raiz do projeto para instalar as dependencias. Caso esteja utilizando Windows, pode ser necessario executar o terminal como administrador para permitir a construcao do `better-sqlite3`.

## 2. Arquivo `.env`

1. Copie o arquivo `.env.example` para `.env` na raiz do projeto:
   ```bash
   cp .env.example .env
   ```
2. Atualize os valores conforme sua necessidade:
   - `MASTER_EMAIL` e `MASTER_PASSWORD`: credenciais iniciais do usuario master criado automaticamente.
   - `SMTP_*`: dados do servidor SMTP que enviara o codigo de verificacao. Para Zoho Mail, utilize uma senha de aplicativo.
   - Caso nao configure `SMTP_HOST`, o sistema usara automaticamente uma conta de teste do Ethereal (nenhum e-mail real sera enviado).

O carregamento do arquivo `.env` e automatico sempre que o servidor eh iniciado, portanto nao ha necessidade de exportar as variaveis manualmente no terminal.

## 3. Inicializacao do banco de dados

Nenhuma etapa adicional e necessaria. Ao iniciar o servidor, o banco SQLite sera criado (ou migrado) automaticamente no arquivo `database.sqlite` localizado na raiz do projeto. Um usuario master padrao tambem sera cadastrado usando as variaveis definidas na etapa anterior.

## 4. Executando o servidor

Inicie o servidor com:

```bash
npm start
```

O aplicativo ficara disponivel em `http://localhost:3000`.

Durante a inicializacao, o console exibira as credenciais do usuario master configurado nas variaveis de ambiente. Utilize-as para realizar o primeiro login na interface web.

## 5. Fluxo de aceite do termo em desenvolvimento

1. Realize login com o usuario master e cadastre a influenciadora (ou utilize um usuario existente).
2. Ao efetuar login como influenciadora, o middleware `verificarAceite` redirecionara automaticamente para `/aceite-termos` caso o termo vigente ainda nao tenha sido aceito.
3. Clique em **Continuar** para disparar o envio do codigo de verificacao. Em modo Ethereal, o console exibira a URL para visualizar o e-mail gerado.
4. Informe o codigo recebido e finalize o processo. O registro sera gravado na tabela `aceite_termos` do SQLite, juntamente com o hash do termo, IP e user agent.

## 6. Testes automatizados

Para validar o funcionamento end-to-end execute:

```bash
npm test
```

Os testes usam um banco SQLite isolado (`test.sqlite`) e garantem que o fluxo de aceite e as demais funcionalidades principais continuem operando.

## 7. Resolucao de problemas

- **Nao recebi o e-mail em desenvolvimento**: verifique o console. Em modo Ethereal, sera exibido um link para visualizacao da mensagem.
- **Erro com certificado autoassinado**: caso esteja usando um servidor SMTP interno, defina `SMTP_REJECT_UNAUTHORIZED=false` no `.env`.
- **Problemas para compilar o `better-sqlite3` no Windows**: instale o [Windows Build Tools](https://github.com/felixrieseberg/windows-build-tools) ou utilize o WSL.

Com essas configuracoes o projeto estara pronto para rodar localmente, permitindo que o fluxo de aceite e as demais funcionalidades sejam exercitadas sem dependencia de infraestrutura externa.
