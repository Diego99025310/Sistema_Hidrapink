const nodemailer = require('nodemailer');

const getBoolean = (value, defaultValue = false) => {
  if (value == null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'sim'].includes(normalized);
};

let transporterPromise;

const buildTransporter = async () => {
  if (process.env.SMTP_HOST) {
    const port = Number.parseInt(process.env.SMTP_PORT || '', 10) || 587;
    const secure = getBoolean(process.env.SMTP_SECURE, port === 465);
    const authUser = process.env.SMTP_USER;
    const authPass = process.env.SMTP_PASS;

    const config = {
      host: process.env.SMTP_HOST,
      port,
      secure
    };

    const rejeitarNaoAutorizados = getBoolean(
      process.env.SMTP_REJECT_UNAUTHORIZED,
      true
    );

    if (!rejeitarNaoAutorizados) {
      config.tls = {
        rejectUnauthorized: false
      };
    }

    if (authUser) {
      config.auth = {
        user: authUser,
        pass: authPass || ''
      };
    }

    return {
      transporter: nodemailer.createTransport(config),
      tipo: 'smtp'
    };
  }

  const contaTeste = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: contaTeste.user,
      pass: contaTeste.pass
    }
  });

  console.info('[email] Modo de teste ativo. Nenhum email real sera enviado.');
  console.info(`[email] Credenciais Ethereal: ${contaTeste.user} / ${contaTeste.pass}`);

  return {
    transporter,
    tipo: 'ethereal'
  };
};

const getTransporter = async () => {
  if (!transporterPromise) {
    transporterPromise = buildTransporter();
  }
  return transporterPromise;
};

const enviarCodigoVerificacao = async ({
  para,
  codigo,
  minutosExpiracao = 5
}) => {
  if (!para) {
    throw new Error('Endereco de email nao informado para envio do codigo de verificacao.');
  }
  if (!codigo) {
    throw new Error('Codigo de verificacao nao informado.');
  }

  const { transporter, tipo } = await getTransporter();

  const from = process.env.SMTP_FROM || 'HidraPink <no-reply@hidrapink.com.br>';
  const subject = 'Seu codigo de verificacao HidraPink';
  const texto = `Seu codigo de verificacao HidraPink: ${codigo}.\nEsse codigo expira em ${minutosExpiracao} minutos.`;

  const message = {
    from,
    to: para,
    subject,
    text: texto,
    html: `<p>Seu c&oacute;digo de verifica&ccedil;&atilde;o HidraPink: <strong>${codigo}</strong>.</p><p>Esse c&oacute;digo expira em ${minutosExpiracao} minutos.</p>`
  };

  const info = await transporter.sendMail(message);

  if (tipo === 'ethereal') {
    const urlPreview = nodemailer.getTestMessageUrl(info);
    if (urlPreview) {
      console.info(`[email] Visualize o email de teste em: ${urlPreview}`);
    }
  }

  return info;
};

module.exports = {
  getTransporter,
  enviarCodigoVerificacao
};
