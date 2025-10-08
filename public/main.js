(() => {
  'use strict';

  const API_BASE = '';
  const storageKeys = {
    token: 'token',
    role: 'role',
    userId: 'userId',
    userEmail: 'userEmail'
  };

  const storage = (() => {
    try {
      return window.sessionStorage;
    } catch (error) {
      return {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      };
    }
  })();

  const digitOnly = (value = '') => value.replace(/\D/g, '');

  const maskCPF = (value = '') => {
    const digits = digitOnly(value).slice(0, 11);
    if (!digits.length) return '';
    let masked = digits.slice(0, Math.min(3, digits.length));
    if (digits.length > 3) masked += '.' + digits.slice(3, Math.min(6, digits.length));
    if (digits.length > 6) masked += '.' + digits.slice(6, Math.min(9, digits.length));
    if (digits.length > 9) masked += '-' + digits.slice(9, 11);
    return masked;
  };

  const maskPhone = (value = '') => {
    const digits = digitOnly(value).slice(0, 11);
    if (!digits.length) return '';
    if (digits.length <= 2) return digits;
    const ddd = digits.slice(0, 2);
    if (digits.length <= 6) return `(${ddd}) ${digits.slice(2)}`;
    const middleLength = digits.length === 11 ? 5 : 4;
    const middle = digits.slice(2, 2 + middleLength);
    const suffix = digits.slice(2 + middleLength);
    return `(${ddd}) ${middle}${suffix ? `-${suffix}` : ''}`;
  };

  const maskCEP = (value = '') => {
    const digits = digitOnly(value).slice(0, 8);
    if (!digits.length) return '';
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  };

  const copyTextToClipboard = async (text) => {
    const value = String(text ?? '');
    if (!value) return;
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const execCommand = typeof document.execCommand === 'function' ? document.execCommand.bind(document) : null;
    const success = execCommand ? execCommand('copy') : false;
    document.body.removeChild(textarea);
    if (!success) {
      throw new Error('Nao foi possivel copiar o texto.');
    }
  };

  const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatCurrency = (value) => {
    const number = Number(value);
    return currencyFormatter.format(Number.isFinite(number) ? number : 0);
  };

  const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const formatInteger = (value) => {
    const number = Number(value);
    return integerFormatter.format(Number.isFinite(number) ? number : 0);
  };

  const formatDateToBR = (value) => {
    if (!value) return '-';
    const iso = String(value).split('T')[0];
    const parts = iso.split('-');
    if (parts.length !== 3) return value;
    const [year, month, day] = parts;
    if (!year || !month || !day) return value;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year.padStart(4, '0')}`;
  };

  const formatPercentage = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return `${number.toFixed(2)}%`;
  };

  const createSummaryItemElement = ({ label, value, helper, icon = 'info' }) => {
    const item = document.createElement('div');
    item.className = 'summary-item';

    const iconEl = document.createElement('span');
    iconEl.className = `summary-icon summary-icon--${icon}`;
    item.appendChild(iconEl);

    const contentEl = document.createElement('div');
    contentEl.className = 'summary-content';

    const labelEl = document.createElement('span');
    labelEl.className = 'summary-label';
    labelEl.textContent = label;
    contentEl.appendChild(labelEl);

    const valueEl = document.createElement('strong');
    valueEl.className = 'summary-value';
    valueEl.textContent = value;
    contentEl.appendChild(valueEl);

    if (helper) {
      const helperEl = document.createElement('span');
      helperEl.className = 'summary-helper';
      helperEl.textContent = helper;
      contentEl.appendChild(helperEl);
    }

    item.appendChild(contentEl);
    return item;
  };

  const renderSummaryMetrics = (container, metrics = []) => {
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(metrics) || metrics.length === 0) {
      return;
    }
    const fragment = document.createDocumentFragment();
    metrics.forEach((metric) => {
      fragment.appendChild(createSummaryItemElement(metric));
    });
    container.appendChild(fragment);
  };

  const buildSalesSummaryMetrics = (summary, totalSales = 0) => {
    let safeTotalSales = Number(totalSales);
    if (!Number.isFinite(safeTotalSales) || safeTotalSales < 0) {
      safeTotalSales = 0;
    }

    const salesHelper =
      safeTotalSales === 0
        ? 'Nenhuma venda registrada ainda'
        : safeTotalSales === 1
        ? 'venda concluída'
        : 'vendas concluídas';

    const metrics = [
      {
        label: 'Pedidos registrados',
        value: formatInteger(safeTotalSales),
        helper: salesHelper,
        icon: 'orders'
      }
    ];

    if (summary) {
      metrics.push(
        {
          label: 'Total em vendas',
          value: formatCurrency(summary.total_net),
          helper: 'Valor líquido acumulado',
          icon: 'revenue'
        },
        {
          label: 'Sua comissão',
          value: formatCurrency(summary.total_commission),
          helper: 'Estimativa atual',
          icon: 'commission'
        }
      );
    }

    return metrics;
  };

  const session = {
    get token() {
      return storage.getItem(storageKeys.token);
    },
    set token(value) {
      value ? storage.setItem(storageKeys.token, value) : storage.removeItem(storageKeys.token);
    },
    get role() {
      return storage.getItem(storageKeys.role);
    },
    set role(value) {
      value ? storage.setItem(storageKeys.role, value) : storage.removeItem(storageKeys.role);
    },
    get userId() {
      return storage.getItem(storageKeys.userId);
    },
    set userId(value) {
      value ? storage.setItem(storageKeys.userId, value) : storage.removeItem(storageKeys.userId);
    },
    get userEmail() {
      return storage.getItem(storageKeys.userEmail);
    },
    set userEmail(value) {
      value ? storage.setItem(storageKeys.userEmail, value) : storage.removeItem(storageKeys.userEmail);
    },
    clear() {
      Object.values(storageKeys).forEach((key) => storage.removeItem(key));
    }
  };

  const redirectTo = (page) => window.location.replace(page);

  const logout = () => {
    session.clear();
    redirectTo('login.html');
  };
  window.logout = logout;

  const setMessage = (element, message = '', type = 'info') => {
    if (!element) return;
    element.textContent = message;
    if (type) {
      element.dataset.type = type;
    } else {
      delete element.dataset.type;
    }
  };

  const flagInvalidField = (field, isValid) => {
    if (!field) return;
    if (isValid) {
      field.removeAttribute('aria-invalid');
    } else {
      field.setAttribute('aria-invalid', 'true');
    }
  };

  const focusFirstInvalidField = (form) => {
    if (!form) return;
    const invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid && typeof invalid.focus === 'function') {
      invalid.focus();
    }
  };

  const parseResponse = async (response) => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    const text = await response.text();
    return text ? { message: text } : {};
  };

  const apiFetch = async (endpoint, { method = 'GET', body, headers = {}, auth = true } = {}) => {
    const requestHeaders = { 'Content-Type': 'application/json', ...headers };
    if (auth) {
      const token = session.token;
      if (!token) {
        throw Object.assign(new Error('Sessao expirada. Faca login novamente.'), { status: 401 });
      }
      requestHeaders.Authorization = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: requestHeaders,
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
      });
    } catch (networkError) {
      const error = new Error('Nao foi possivel conectar ao servidor.');
      error.cause = networkError;
      throw error;
    }

    const data = await parseResponse(response);
    if (!response.ok) {
      const error = new Error(data?.error || data?.message || 'Erro inesperado.');
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  };

  const ensureAuth = (requiredRole) => {
    const token = session.token;
    const role = session.role;
    if (!token) {
      redirectTo('login.html');
      return false;
    }
    if (requiredRole && role !== requiredRole) {
      redirectTo('login.html');
      return false;
    }
    return true;
  };

  const attachLogoutButtons = () => {
    document.querySelectorAll('[data-action="logout"]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        logout();
      });
    });

  };

  const addRealtimeValidation = (form) => {
    if (!form) return;
    form.querySelectorAll('input, textarea, select').forEach((field) => {
      field.addEventListener('input', () => field.removeAttribute('aria-invalid'));
      field.addEventListener('blur', () => {
        if (!field.value) field.removeAttribute('aria-invalid');
      });
    });

  };

  const validators = {
    email: (value) => /^(?:[\w!#$%&'*+/=?^`{|}~-]+(?:\.[\w!#$%&'*+/=?^`{|}~-]+)*)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(String(value).trim()),
    password: (value) => typeof value === 'string' && value.length >= 6
  };

  const isValidCPF = (value) => {
    const digits = digitOnly(value);
    if (!digits) return true;
    if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
    const calc = (len) => {
      let sum = 0;
      for (let i = 0; i < len; i += 1) sum += Number(digits[i]) * (len + 1 - i);
      const result = (sum * 10) % 11;
      return result === 10 ? 0 : result;
    };
    return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
  };

  const isValidPhone = (value) => {
    const digits = digitOnly(value);
    if (!digits) return true;
    return digits.length === 10 || digits.length === 11;
  };

  const isValidCep = (value) => {
    const digits = digitOnly(value);
    if (!digits) return true;
    return digits.length === 8;
  };

  const gatherInfluencerPayloadFromForm = (form) => {
    if (!form) return {};
    const getValue = (name) => (form.elements[name]?.value || '').trim();
    return {
      nome: getValue('nome'),
      instagram: getValue('instagram'),
      cpf: digitOnly(getValue('cpf')),
      email: getValue('email'),
      contato: digitOnly(getValue('contato')),
      cupom: getValue('cupom'),
      commissionPercent: getValue('commissionPercent'),
      cep: digitOnly(getValue('cep')),
      numero: getValue('numero'),
      complemento: getValue('complemento'),
      logradouro: getValue('logradouro'),
      bairro: getValue('bairro'),
      cidade: getValue('cidade'),
      estado: getValue('estado'),
      loginEmail: getValue('loginEmail'),
      loginPassword: getValue('loginPassword')
    };
  };

  const validateInfluencerPayload = (form, payload, options = {}) => {
    const requireCredentials = options.requireCredentials ?? true;
    const errors = [];
    const mark = (name, condition, message) => {
      const field = form?.elements?.[name];
      flagInvalidField(field, condition);
      if (!condition && message) errors.push(message);
    };

    const nome = (payload.nome || '').trim();
    const instagram = (payload.instagram || '').trim();
    const email = (payload.email || '').trim();
    const loginEmail = (payload.loginEmail || '').trim();
    const loginPassword = payload.loginPassword || '';
    const estado = (payload.estado || '').trim();
    const commissionPercent = payload.commissionPercent;

    mark('nome', Boolean(nome), 'Informe o nome.');
    mark('instagram', Boolean(instagram), 'Informe o Instagram.');

    mark('cpf', isValidCPF(payload.cpf), 'CPF invalido.');
    mark('email', !email || validators.email(email), 'Email invalido.');
    mark('contato', isValidPhone(payload.contato), 'Contato deve conter DDD mais numero.');
    mark('cep', isValidCep(payload.cep), 'CEP invalido.');

    mark('estado', !estado || estado.length === 2, 'Estado deve ter 2 letras.');

    if (commissionPercent) {
      const parsedCommission = Number(commissionPercent);
      mark('commissionPercent', Number.isFinite(parsedCommission) && parsedCommission >= 0 && parsedCommission <= 100, 'Comissao deve estar entre 0 e 100.');
    } else {
      mark('commissionPercent', true);
    }

    if (requireCredentials || loginEmail) {
      mark('loginEmail', validators.email(loginEmail), 'Informe um email de acesso valido.');
    } else {
      mark('loginEmail', true);
    }

    if (requireCredentials || loginPassword) {
      mark('loginPassword', validators.password(loginPassword), 'Informe uma senha de acesso com ao menos 6 caracteres.');
    } else {
      mark('loginPassword', true);
    }

    return { isValid: errors.length === 0, errors };
  };

  const normalizeInfluencerForSubmit = (payload) => {
    const trimmed = { ...payload };
    trimmed.nome = (trimmed.nome || '').trim();
    trimmed.instagram = (trimmed.instagram || '').trim();
    if (trimmed.instagram && !trimmed.instagram.startsWith('@')) {
      trimmed.instagram = `@${trimmed.instagram}`;
    }
    trimmed.email = (trimmed.email || '').trim();
    trimmed.cupom = (trimmed.cupom || '').trim();
    trimmed.commissionPercent = (trimmed.commissionPercent || '').trim();
    trimmed.numero = (trimmed.numero || '').trim();
    trimmed.complemento = (trimmed.complemento || '').trim();
    trimmed.logradouro = (trimmed.logradouro || '').trim();
    trimmed.bairro = (trimmed.bairro || '').trim();
    trimmed.cidade = (trimmed.cidade || '').trim();
    trimmed.estado = (trimmed.estado || '').trim().toUpperCase();
    trimmed.loginEmail = (trimmed.loginEmail || '').trim();
    trimmed.loginPassword = trimmed.loginPassword || '';
    return trimmed;
  };

  const formatInfluencerDetails = (data) => {
    const coupon = (data.cupom || '').trim();
    const discountLink = coupon ? `https://www.hidrapink.com.br/discount/${encodeURIComponent(coupon)}` : '';
    return {
      nome: data.nome || '-',
      cupom: coupon || '-',
      discountLink: discountLink || '-'
    };
  };

  const setupInfluencerFormHelpers = (form, messageEl) => {
    const cpfInput = form?.elements?.cpf || null;
    const contatoInput = form?.elements?.contato || null;
    const cepInput = form?.elements?.cep || null;
    const logradouroInput = form?.elements?.logradouro || null;
    const bairroInput = form?.elements?.bairro || null;
    const cidadeInput = form?.elements?.cidade || null;
    const estadoInput = form?.elements?.estado || null;

    const applyMasks = () => {
      if (cpfInput) cpfInput.value = maskCPF(cpfInput.value);
      if (contatoInput) contatoInput.value = maskPhone(contatoInput.value);
      if (cepInput) cepInput.value = maskCEP(cepInput.value);
    };

    const getCaretPositionFromDigits = (maskedValue, digitsBeforeCaret) => {
      if (!maskedValue) return 0;
      if (digitsBeforeCaret <= 0) return 0;
      let digitsSeen = 0;
      for (let index = 0; index < maskedValue.length; index += 1) {
        if (/\d/.test(maskedValue[index])) {
          digitsSeen += 1;
          if (digitsSeen >= digitsBeforeCaret) {
            return index + 1;
          }
        }
      }
      return maskedValue.length;
    };

    const applyMaskWithCaret = (input, maskFn) => {
      if (!input) return;
      const rawValue = String(input.value || '');
      const selectionStart = typeof input.selectionStart === 'number' ? input.selectionStart : rawValue.length;
      const digitsBeforeCaret = digitOnly(rawValue.slice(0, selectionStart)).length;
      const maskedValue = maskFn(rawValue);
      input.value = maskedValue;
      if (typeof input.setSelectionRange === 'function') {
        const caretPosition = getCaretPositionFromDigits(maskedValue, digitsBeforeCaret);
        input.setSelectionRange(caretPosition, caretPosition);
      }
    };

    cpfInput?.addEventListener('input', () => {
      applyMaskWithCaret(cpfInput, maskCPF);
    });

    contatoInput?.addEventListener('input', () => {
      applyMaskWithCaret(contatoInput, maskPhone);
    });

    let lastCepLookup = '';

    const applyCepData = (data) => {
      if (!data) return;
      if (data.logradouro && logradouroInput && !logradouroInput.value) logradouroInput.value = data.logradouro;
      if (data.bairro && bairroInput && !bairroInput.value) bairroInput.value = data.bairro;
      if (data.localidade && cidadeInput && !cidadeInput.value) cidadeInput.value = data.localidade;
      if (data.uf && estadoInput && !estadoInput.value) estadoInput.value = data.uf;
    };

    const fetchCep = async (digits) => {
      if (!digits || digits.length !== 8 || digits === lastCepLookup) return;
      try {
        if (messageEl) setMessage(messageEl, 'Consultando CEP...', 'info');
        const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
        if (!response.ok) throw new Error('CEP nao encontrado.');
        const data = await response.json();
        if (data.erro) {
          if (messageEl) setMessage(messageEl, 'CEP nao encontrado.', 'error');
          lastCepLookup = '';
          return;
        }
        applyCepData(data);
        if (messageEl) setMessage(messageEl, 'Endereco preenchido automaticamente.', 'success');
        lastCepLookup = digits;
      } catch (error) {
        if (messageEl) setMessage(messageEl, error.message || 'Nao foi possivel consultar o CEP.', 'error');
        lastCepLookup = '';
      }
    };

    cepInput?.addEventListener('input', () => {
      applyMaskWithCaret(cepInput, maskCEP);
      if (digitOnly(cepInput.value).length < 8) lastCepLookup = '';
    });

    cepInput?.addEventListener('blur', () => {
      const digits = digitOnly(cepInput.value);
      if (digits.length === 8) fetchCep(digits);
    });

    return { applyMasks };
  };

  const fillInfluencerFormFields = (form, data) => {
    if (!form || !data) return;
    const setValue = (name, value) => {
      if (form.elements[name]) {
        form.elements[name].value = value ?? '';
        form.elements[name].removeAttribute('aria-invalid');
      }
    };
    setValue('nome', data.nome);
    setValue('instagram', data.instagram);
    setValue('cpf', digitOnly(data.cpf || ''));
    setValue('email', data.email);
    setValue('contato', digitOnly(data.contato || ''));
    setValue('cupom', data.cupom);
    setValue('commissionPercent', data.commission_rate != null ? String(Number(data.commission_rate)) : '');
    setValue('cep', digitOnly(data.cep || ''));
    setValue('numero', data.numero);
    setValue('complemento', data.complemento);
    setValue('logradouro', data.logradouro);
    setValue('bairro', data.bairro);
    setValue('cidade', data.cidade);
    setValue('estado', data.estado);
    setValue('loginEmail', data.login_email || '');
    if (form.elements.loginPassword) {
      form.elements.loginPassword.value = '';
      form.elements.loginPassword.removeAttribute('aria-invalid');
    }
  };

  const fetchAllInfluencers = async () => {
    const data = await apiFetch('/influenciadoras');
    return Array.isArray(data) ? data : [];
  };

  const fetchInfluencerById = async (id) => {
    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      throw new Error('ID invalido.');
    }
    return apiFetch(`/influenciadora/${Number(id)}`);
  };

  const fetchInfluencerSummaries = async () => {
    const data = await apiFetch('/influenciadoras/consulta');
    return Array.isArray(data) ? data : [];
  };

  const formatAccount = (instagram) => {
    if (!instagram) return '-';
    return instagram.replace(/^@/, '').trim() || '-';
  };

  const redirectToInfluencerEdit = (id) => {
    window.location.href = `master-create.html?id=${id}`;
  };

  const initLoginPage = () => {
    if (session.token && session.role) {
      if (session.role === 'master') {
        redirectTo('master.html');
        return;
      }
      if (session.role === 'influencer') {
        redirectTo('influencer.html');
        return;
      }
    }

    const form = document.getElementById('loginForm');
    const messageEl = document.getElementById('loginMessage');
    addRealtimeValidation(form);

    const params = (() => {
      try {
        return new URLSearchParams(window.location.search);
      } catch (error) {
        return null;
      }
    })();
    const presetEmail = params?.get('email')?.trim() || '';
    const presetPassword = params?.get('password') || '';
    let autoLoginTriggered = false;

    const setFieldValue = (name, value) => {
      const field = form?.elements?.[name];
      if (!field || typeof value !== 'string') return;
      field.value = value;
      field.removeAttribute('aria-invalid');
    };

    if (presetEmail) setFieldValue('email', presetEmail);
    if (presetPassword) setFieldValue('password', presetPassword);

    const clearLoginQueryParams = () => {
      if (!params || !window.history || typeof window.history.replaceState !== 'function') return;
      const url = new URL(window.location.href);
      url.searchParams.delete('email');
      url.searchParams.delete('password');
      const newSearch = url.searchParams.toString();
      const newUrl = newSearch ? url.pathname + '?' + newSearch : url.pathname;
      window.history.replaceState({}, '', newUrl);
    };

    const maybeAutoLogin = () => {
      if (autoLoginTriggered || !form) return;
      if (!presetEmail || !presetPassword) return;
      if (!validators.email(presetEmail) || !validators.password(presetPassword)) return;
      autoLoginTriggered = true;
      setMessage(messageEl, 'Entrando automaticamente...', 'info');
      clearLoginQueryParams();
      const submit = () => {
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.submit();
        }
      };
      window.setTimeout(submit, 120);
    };

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearLoginQueryParams();
      if (!form) return;

      const email = (form.elements.email?.value || '').trim();
      const password = (form.elements.password?.value || '').trim();

      flagInvalidField(form.elements.email, validators.email(email));
      flagInvalidField(form.elements.password, validators.password(password));

      if (!validators.email(email) || !validators.password(password)) {
        setMessage(messageEl, 'Informe email valido e senha (minimo 6 caracteres).', 'error');
        focusFirstInvalidField(form);
        return;
      }

      setMessage(messageEl, 'Entrando...', 'info');

      try {
        const data = await apiFetch('/login', {
          method: 'POST',
          body: { email, password },
          auth: false
        });

        session.token = data.token;
        session.role = data.user?.role || '';
        session.userEmail = data.user?.email || email;
        session.userId = data.user?.id != null ? String(data.user.id) : '';

        setMessage(messageEl, 'Login realizado com sucesso! Redirecionando...', 'success');

        setTimeout(() => {
          if (session.role === 'master') {
            redirectTo('master.html');
          } else {
            redirectTo('influencer.html');
          }
        }, 600);
      } catch (error) {
        if (error.status === 401) {
          setMessage(messageEl, 'Credenciais invalidas. Verifique e tente novamente.', 'error');
        } else {
          setMessage(messageEl, error.message || 'Nao foi possivel realizar o login.', 'error');
        }
      }
    });

    maybeAutoLogin();

  };


  const initMasterHomePage = () => {
    if (!ensureAuth('master')) return;
    attachLogoutButtons();
  };

  const initMasterCreatePage = () => {
    if (!ensureAuth('master')) return;
    attachLogoutButtons();

    const form = document.getElementById('createInfluencerForm');
    const messageEl = document.getElementById('masterMessage');
    const cancelBtn = document.getElementById('cancelEditButton');

    addRealtimeValidation(form);

    const { applyMasks } = setupInfluencerFormHelpers(form, messageEl);
    applyMasks();

    const passwordInput = form?.elements?.loginPassword || null;
    const emailInput = form?.elements?.email || null;
    const loginEmailInput = form?.elements?.loginEmail || null;
    const cpfInput = form?.elements?.cpf || null;

    if (loginEmailInput) {
      loginEmailInput.setAttribute('readonly', '');
    }

    const syncLoginEmail = () => {
      if (!loginEmailInput) return;
      const emailValue = (emailInput?.value || '').trim();
      loginEmailInput.value = emailValue;
      loginEmailInput.removeAttribute('aria-invalid');
    };

    const syncLoginPassword = () => {
      if (!passwordInput) return;
      const cpfDigits = digitOnly(cpfInput?.value || '');
      passwordInput.value = cpfDigits;
      if (cpfDigits) {
        passwordInput.removeAttribute('aria-invalid');
      }
    };

    const syncCredentials = () => {
      syncLoginEmail();
      syncLoginPassword();
    };

    syncCredentials();

    emailInput?.addEventListener('input', syncLoginEmail);
    cpfInput?.addEventListener('input', syncLoginPassword);

    let editingId = null;

    const clearQueryId = () => {
      if (!window.history || !window.location) return;
      const url = new URL(window.location.href);
      if (url.searchParams.has('id')) {
        url.searchParams.delete('id');
        window.history.replaceState({}, '', url.pathname);
      }
    };

    const resetForm = ({ clearMessage = false } = {}) => {
      editingId = null;
      if (form) {
        form.reset();
        form.dataset.mode = 'create';
        delete form.dataset.editId;
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.textContent = 'Cadastrar';
        form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
      }
      if (passwordInput) {
        passwordInput.placeholder = 'Senha gerada automaticamente a partir do CPF';
        passwordInput.setAttribute('required', '');
        const cpfDigits = digitOnly(cpfInput?.value || '');
        passwordInput.value = cpfDigits;
      }
      applyMasks();
      syncCredentials();
      if (clearMessage) setMessage(messageEl, '');
      clearQueryId();
    };

    const loadInfluencerForEdit = async (id) => {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        setMessage(messageEl, 'ID de influenciadora invalido.', 'error');
        return;
      }
      setMessage(messageEl, 'Carregando influenciadora...', 'info');
      try {
        const target = await fetchInfluencerById(numericId);
        fillInfluencerFormFields(form, target);
        applyMasks();
        syncCredentials();
        editingId = numericId;
        if (form) {
          form.dataset.mode = 'edit';
          form.dataset.editId = String(numericId);
          const submitBtn = form.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.textContent = 'Salvar alteracoes';
        }
        if (passwordInput) {
          passwordInput.placeholder = 'Gerada automaticamente pelo CPF. Limpe para manter a senha atual.';
          passwordInput.removeAttribute('required');
          const cpfDigits = digitOnly(cpfInput?.value || '');
          passwordInput.value = cpfDigits;
        }
        setMessage(messageEl, 'Editando influenciadora selecionada.', 'info');
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        setMessage(messageEl, error.message || 'Nao foi possivel carregar a influenciadora.', 'error');
      }
    };

    cancelBtn?.addEventListener('click', () => {
      resetForm({ clearMessage: true });
      setMessage(messageEl, 'Edicao cancelada.', 'info');
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form) return;

      const payload = gatherInfluencerPayloadFromForm(form);
      const normalized = normalizeInfluencerForSubmit(payload);
      const currentEditId = editingId ?? Number(form?.dataset?.editId || 0);
      editingId = currentEditId || null;
      const requireCredentials = !currentEditId;

      const validation = validateInfluencerPayload(form, normalized, { requireCredentials });
      if (!validation.isValid) {
        setMessage(messageEl, validation.errors.join(' '), 'error');
        focusFirstInvalidField(form);
        return;
      }

      const body = {
        ...normalized,
        commissionPercent: normalized.commissionPercent !== '' ? Number(normalized.commissionPercent) : undefined,
        loginEmail: normalized.loginEmail || undefined,
        loginPassword: normalized.loginPassword || undefined
      };

      const endpoint = currentEditId ? `/influenciadora/${currentEditId}` : '/influenciadora';
      const method = currentEditId ? 'PUT' : 'POST';

      try {
        await apiFetch(endpoint, { method, body });
        setMessage(messageEl, currentEditId ? 'Influenciadora atualizada com sucesso.' : 'Influenciadora cadastrada com sucesso.', 'success');
        resetForm({ clearMessage: false });
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        setMessage(messageEl, error.message || 'Nao foi possivel salvar a influenciadora.', 'error');
      }
    });

    const params = new URLSearchParams(window.location.search);
    const idParam = params.get('id');
    if (idParam) {
      const parsed = Number(idParam);
      if (Number.isInteger(parsed) && parsed > 0) {
        loadInfluencerForEdit(parsed);
      } else {
        setMessage(messageEl, 'ID de influenciadora invalido.', 'error');
      }
    } else {
      resetForm();
    }
  };

  const initMasterConsultPage = () => {
    if (!ensureAuth('master')) return;
    attachLogoutButtons();

    const tableBody = document.querySelector('#consultTable tbody');
    const messageEl = document.getElementById('consultMessage');
    const reloadBtn = document.getElementById('reloadConsultButton');

    const renderTable = (rows) => {
      if (!tableBody) return;
      tableBody.innerHTML = '';
      if (!Array.isArray(rows) || rows.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 5;
        emptyCell.className = 'empty';
        emptyCell.textContent = 'Nenhuma influenciadora encontrada.';
        emptyRow.appendChild(emptyCell);
        tableBody.appendChild(emptyRow);
        return;
      }
      const fragment = document.createDocumentFragment();
      rows.forEach((item) => {
        const tr = document.createElement('tr');
        tr.dataset.id = String(item.id);
        tr.dataset.clickable = 'true';
        const cells = [
          formatAccount(item.instagram || ''),
          item.nome || '-',
          item.cupom || '-',
          String(item.vendas_count ?? 0),
          formatCurrency(item.vendas_total ?? 0)
        ];
        cells.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value;
          tr.appendChild(td);
        });
        fragment.appendChild(tr);
      });
      tableBody.appendChild(fragment);
    };

    const load = async () => {
      setMessage(messageEl, 'Carregando consulta...', 'info');
      try {
        const data = await fetchInfluencerSummaries();
        renderTable(data);
        if (!data.length) {
          setMessage(messageEl, 'Nenhuma influenciadora cadastrada.', 'info');
        } else {
          setMessage(messageEl, `${data.length} influenciadora(s) listada(s).`, 'success');
        }
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        renderTable([]);
        setMessage(messageEl, error.message || 'Nao foi possivel consultar as influenciadoras.', 'error');
      }
    };

    tableBody?.addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-id]');
      if (!row) return;
      const id = Number(row.dataset.id);
      if (!Number.isInteger(id) || id <= 0) return;
      redirectToInfluencerEdit(id);
    });

    reloadBtn?.addEventListener('click', load);

    load();
  };

  const initMasterListPage = () => {
    if (!ensureAuth('master')) return;
    attachLogoutButtons();

    const listContainer = document.getElementById('influencersList');
    const messageEl = document.getElementById('listMessage');
    const reloadBtn = document.getElementById('reloadInfluencers');

    let influencers = [];

    const renderList = () => {
      if (!listContainer) return;
      listContainer.innerHTML = '';
      if (!influencers.length) {
        listContainer.innerHTML = '<p class="empty">Nenhuma influenciadora cadastrada.</p>';
        return;
      }
      const fragment = document.createDocumentFragment();
      influencers.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'influencer-card';
        card.innerHTML = `
          <strong>${item.nome || '-'}</strong>
          <p>Email de contato: ${item.email ?? '-'} | Cupom: ${item.cupom ?? '-'} | Login: ${item.login_email ?? '-'} | Comissao: ${item.commission_rate != null ? formatPercentage(item.commission_rate) : '-'}</p>
          <div class="actions">
            <button type="button" data-action="edit" data-id="${item.id}">Editar</button>
            <button type="button" data-action="delete" data-id="${item.id}">Excluir</button>
          </div>
        `;
        fragment.appendChild(card);
      });
      listContainer.appendChild(fragment);
    };

    const load = async () => {
      setMessage(messageEl, 'Carregando influenciadoras...', 'info');
      try {
        influencers = await fetchAllInfluencers();
        renderList();
        if (!influencers.length) {
          setMessage(messageEl, 'Nenhuma influenciadora cadastrada ainda.', 'info');
        } else {
          setMessage(messageEl, 'Lista carregada com sucesso.', 'success');
        }
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        setMessage(messageEl, error.message || 'Nao foi possivel carregar as influenciadoras.', 'error');
      }
    };

    listContainer?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = Number(button.dataset.id);
      if (!Number.isInteger(id) || id <= 0) return;
      const action = button.dataset.action;
      if (action === 'edit') {
        redirectToInfluencerEdit(id);
      } else if (action === 'delete') {
        if (!window.confirm('Deseja realmente excluir esta influenciadora?')) return;
        (async () => {
          try {
            await apiFetch(`/influenciadora/${id}`, { method: 'DELETE' });
            setMessage(messageEl, 'Influenciadora removida com sucesso.', 'success');
            await load();
          } catch (error) {
            if (error.status === 401) {
              logout();
              return;
            }
            setMessage(messageEl, error.message || 'Nao foi possivel excluir a influenciadora.', 'error');
          }
        })();
      }
    });

    reloadBtn?.addEventListener('click', load);

    load();
  };

  const initMasterSalesPage = () => {
    if (!ensureAuth('master')) return;
    attachLogoutButtons();

    const form = document.getElementById('createSaleForm');
    const messageEl = document.getElementById('salesMessage');
    const saleOrderInput = form?.elements.orderNumber || form?.elements.order_number || null;
    const saleCouponSelect = document.getElementById('saleCouponSelect');
    const saleDateInput = form?.elements.saleDate || null;
    const saleGrossInput = form?.elements.grossValue || null;
    const saleDiscountInput = form?.elements.discountValue || null;
    const saleNetInput = form?.elements.netValue || null;
    const saleCommissionInput = form?.elements.commissionValue || null;
    const cancelSaleEditButton = document.getElementById('cancelSaleEditButton');
    const reloadSalesButton = document.getElementById('reloadSalesButton');
    const salesTableBody = document.querySelector('#salesTable tbody');
    const salesSummaryEl = document.getElementById('salesSummary');
    const salesImportTextarea = document.getElementById('salesImportInput');
    const analyzeSalesImportButton = document.getElementById('analyzeSalesImportButton');
    const clearSalesImportButton = document.getElementById('clearSalesImportButton');
    const confirmSalesImportButton = document.getElementById('confirmSalesImportButton');
    const salesImportMessage = document.getElementById('salesImportMessage');
    const salesImportTableBody = document.querySelector('#salesImportTable tbody');
    const salesImportSummaryEl = document.getElementById('salesImportSummary');

    addRealtimeValidation(form);

    let influencers = [];
    let sales = [];
    let currentSalesInfluencerId = null;
    let saleEditingId = null;
    let lastImportText = '';
    let lastImportAnalysis = null;

    const getInfluencerByCoupon = (coupon) => {
      if (!coupon) return undefined;
      const normalized = coupon.trim().toLowerCase();
      return influencers.find((item) => (item.cupom || '').trim().toLowerCase() === normalized);
    };

    const updateSaleComputedFields = () => {
      if (!saleGrossInput || !saleDiscountInput || !saleNetInput || !saleCommissionInput) return;
      const gross = Number(saleGrossInput.value || 0);
      const discount = Number(saleDiscountInput.value || 0);
      const influencer = getInfluencerByCoupon(saleCouponSelect?.value || '');
      const commissionRate = influencer?.commission_rate != null ? Number(influencer.commission_rate) : 0;
      const net = Math.max(0, gross - Math.max(0, discount));
      const commission = net * (commissionRate / 100);
      saleNetInput.value = net ? net.toFixed(2) : '';
      saleCommissionInput.value = commission ? commission.toFixed(2) : '';
    };

    const renderSalesTable = () => {
      if (!salesTableBody) return;
      salesTableBody.innerHTML = '';
      if (!Array.isArray(sales) || sales.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 8;
        emptyCell.className = 'empty';
        emptyCell.textContent = 'Nenhuma venda cadastrada.';
        emptyRow.appendChild(emptyCell);
        salesTableBody.appendChild(emptyRow);
        return;
      }
      const fragment = document.createDocumentFragment();
      sales.forEach((sale) => {
        const tr = document.createElement('tr');
        tr.dataset.id = String(sale.id);
        const cells = [
          sale.order_number || sale.orderNumber || '-',
          sale.cupom || '-',
          sale.date || '-',
          formatCurrency(sale.gross_value),
          formatCurrency(sale.discount),
          formatCurrency(sale.net_value),
          formatCurrency(sale.commission)
        ];
        cells.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value;
          tr.appendChild(td);
        });
        const actionTd = document.createElement('td');
        actionTd.className = 'actions';
        actionTd.innerHTML = `
          <button type="button" data-action="edit">Editar</button>
          <button type="button" data-action="delete">Excluir</button>
        `;
        tr.appendChild(actionTd);
        fragment.appendChild(tr);
      });
      salesTableBody.appendChild(fragment);
    };

    const renderSalesSummary = (summary, { totalSales } = {}) => {
      const metrics = buildSalesSummaryMetrics(
        summary,
        typeof totalSales === 'number' ? totalSales : Array.isArray(sales) ? sales.length : 0
      );
      renderSummaryMetrics(salesSummaryEl, metrics);
    };

    const updateImportConfirmState = () => {
      if (!confirmSalesImportButton) return;
      if (lastImportAnalysis && !lastImportAnalysis.hasErrors && lastImportAnalysis.validCount > 0) {
        confirmSalesImportButton.removeAttribute('disabled');
      } else {
        confirmSalesImportButton.setAttribute('disabled', 'disabled');
      }
    };

    const renderSalesImportTable = (rows) => {
      if (!salesImportTableBody) return;
      salesImportTableBody.innerHTML = '';
      if (!Array.isArray(rows) || !rows.length) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 9;
        emptyCell.className = 'empty';
        emptyCell.textContent = 'Nenhuma linha analisada.';
        emptyRow.appendChild(emptyCell);
        salesImportTableBody.appendChild(emptyRow);
        return;
      }

      const fragment = document.createDocumentFragment();
      rows.forEach((row) => {
        const isValid = !row.errors?.length;
        const tr = document.createElement('tr');
        tr.dataset.status = isValid ? 'ok' : 'error';

        const statusTd = document.createElement('td');
        statusTd.textContent = isValid ? `Linha ${row.line}: Pronto` : `Linha ${row.line}: Erro`;
        tr.appendChild(statusTd);

        const dateToDisplay = isValid ? formatDateToBR(row.date) : row.rawDate || '-';
        const grossToDisplay = isValid
          ? formatCurrency(row.grossValue)
          : row.rawGross || (row.rawGross === '' ? '0' : '-');
        const discountToDisplay = isValid
          ? formatCurrency(row.discount)
          : row.rawDiscount || (row.rawDiscount === '' ? '0' : '-');
        const netToDisplay = isValid ? formatCurrency(row.netValue) : '-';
        const commissionToDisplay = isValid ? formatCurrency(row.commission) : '-';

        const cells = [
          row.orderNumber || '-',
          row.cupom || '-',
          dateToDisplay,
          grossToDisplay,
          discountToDisplay,
          netToDisplay,
          commissionToDisplay
        ];

        cells.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value == null || value === '' ? '-' : String(value);
          tr.appendChild(td);
        });

        const observationsTd = document.createElement('td');
        observationsTd.textContent = row.errors?.length ? row.errors.join(' ') : '-';
        tr.appendChild(observationsTd);

        fragment.appendChild(tr);
      });

      salesImportTableBody.appendChild(fragment);
    };

    const renderSalesImportSummary = (analysis) => {
      if (!salesImportSummaryEl) return;
      salesImportSummaryEl.innerHTML = '';
      if (!analysis || !analysis.totalCount) {
        return;
      }

      const summaryItems = [
        `Linhas analisadas: ${analysis.totalCount}`,
        `Prontas: ${analysis.validCount}`
      ];
      if (analysis.errorCount) {
        summaryItems.push(`Com erros: ${analysis.errorCount}`);
      }
      if (analysis.validCount) {
        summaryItems.push(`Valor bruto: ${formatCurrency(analysis.summary?.totalGross)}`);
        summaryItems.push(`Descontos: ${formatCurrency(analysis.summary?.totalDiscount)}`);
        summaryItems.push(`Liquido: ${formatCurrency(analysis.summary?.totalNet)}`);
        summaryItems.push(`Comissao: ${formatCurrency(analysis.summary?.totalCommission)}`);
      }

      summaryItems.forEach((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        salesImportSummaryEl.appendChild(span);
      });
    };

    const resetSalesImport = ({ clearText = false, clearMessage = true } = {}) => {
      lastImportAnalysis = null;
      lastImportText = '';
      if (clearText && salesImportTextarea) {
        salesImportTextarea.value = '';
      }
      if (clearMessage) {
        setMessage(salesImportMessage, '');
      }
      renderSalesImportTable([]);
      renderSalesImportSummary(null);
      updateImportConfirmState();
    };

    const resetSaleForm = ({ clearMessage = false, keepCoupon = true } = {}) => {
      saleEditingId = null;
      if (!form) return;
      const currentCoupon = saleCouponSelect?.value || '';
      form.reset();
      if (keepCoupon && saleCouponSelect) saleCouponSelect.value = currentCoupon;
      form.dataset.mode = 'create';
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.textContent = 'Registrar venda';
      form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
      updateSaleComputedFields();
      if (clearMessage) setMessage(messageEl, '');
    };

    const loadSalesForInfluencer = async (influencerId, { showStatus = true } = {}) => {
      if (!influencerId) {
        sales = [];
        renderSalesTable();
        renderSalesSummary(null, { totalSales: 0 });
        return;
      }
      if (showStatus) setMessage(messageEl, 'Carregando vendas...', 'info');
      try {
        const salesData = await apiFetch(`/sales/${influencerId}`);
        sales = Array.isArray(salesData) ? salesData : [];
        renderSalesTable();
        try {
          const summary = await apiFetch(`/sales/summary/${influencerId}`);
          renderSalesSummary(summary, { totalSales: sales.length });
        } catch (summaryError) {
          if (summaryError.status === 401) {
            logout();
            return;
          }
          renderSalesSummary(null, { totalSales: sales.length });
        }
        if (!sales.length) {
          if (showStatus) setMessage(messageEl, 'Nenhuma venda cadastrada para este cupom.', 'info');
        } else if (showStatus) {
          setMessage(messageEl, 'Vendas carregadas com sucesso.', 'success');
        }
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        sales = [];
        renderSalesTable();
        renderSalesSummary(null, { totalSales: 0 });
        setMessage(messageEl, error.message || 'Nao foi possivel carregar as vendas.', 'error');
      }
    };

    const populateCouponSelect = () => {
      if (!saleCouponSelect) return;
      const previous = saleCouponSelect.value;
      saleCouponSelect.innerHTML = '';
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Selecione um cupom';
      saleCouponSelect.appendChild(defaultOption);

      const influencersWithCoupon = influencers.filter((inf) => (inf.cupom || '').trim());
      influencersWithCoupon.forEach((inf) => {
        const option = document.createElement('option');
        const coupon = (inf.cupom || '').trim();
        option.value = coupon;
        option.textContent = `${coupon} - ${inf.nome || ''}`;
        saleCouponSelect.appendChild(option);
      });

      if (previous && getInfluencerByCoupon(previous)) {
        saleCouponSelect.value = previous;
      } else {
        saleCouponSelect.value = '';
      }
    };

    const handleCouponChange = () => {
      const influencer = getInfluencerByCoupon(saleCouponSelect?.value || '');
      if (!influencer) {
        currentSalesInfluencerId = null;
        sales = [];
        renderSalesTable();
        renderSalesSummary(null, { totalSales: 0 });
        updateSaleComputedFields();
        setMessage(messageEl, 'Selecione um cupom para visualizar e registrar as vendas.', 'info');
        return;
      }
      currentSalesInfluencerId = influencer.id;
      updateSaleComputedFields();
      loadSalesForInfluencer(influencer.id, { showStatus: true });
    };

    const loadInfluencersForSales = async () => {
      setMessage(messageEl, 'Carregando influenciadoras...', 'info');
      try {
        influencers = await fetchAllInfluencers();
        populateCouponSelect();
        handleCouponChange();
        if (!influencers.length) {
          setMessage(messageEl, 'Cadastre uma influenciadora com cupom para registrar vendas.', 'info');
        }
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        setMessage(messageEl, error.message || 'Nao foi possivel carregar as influenciadoras.', 'error');
      }
    };

    saleCouponSelect?.addEventListener('change', handleCouponChange);
    saleGrossInput?.addEventListener('input', updateSaleComputedFields);
    saleDiscountInput?.addEventListener('input', updateSaleComputedFields);

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form) return;

      const orderNumber = (saleOrderInput?.value || '').trim();
      const coupon = (saleCouponSelect?.value || '').trim();
      const date = saleDateInput?.value || '';
      const gross = Number(saleGrossInput?.value || 0);
      const discount = Number(saleDiscountInput?.value || 0);

      flagInvalidField(saleOrderInput, Boolean(orderNumber));
      flagInvalidField(saleCouponSelect, Boolean(coupon));
      flagInvalidField(saleDateInput, Boolean(date));
      flagInvalidField(saleGrossInput, Number.isFinite(gross) && gross >= 0);
      flagInvalidField(saleDiscountInput, Number.isFinite(discount) && discount >= 0 && discount <= gross);

      const hasInvalidNumbers = !Number.isFinite(gross) || gross < 0 || !Number.isFinite(discount) || discount < 0 || discount > gross;

      if (!orderNumber || !coupon || !date || hasInvalidNumbers) {
        setMessage(
          messageEl,
          'Verifique os campos da venda. Pedido é obrigatório e o desconto nao pode ser maior que o valor bruto.',
          'error'
        );
        focusFirstInvalidField(form);
        return;
      }

      const payload = { orderNumber, cupom: coupon, date, grossValue: gross, discount };
      const endpoint = saleEditingId ? `/sales/${saleEditingId}` : '/sales';
      const method = saleEditingId ? 'PUT' : 'POST';

      try {
        await apiFetch(endpoint, { method, body: payload });
        await loadSalesForInfluencer(currentSalesInfluencerId, { showStatus: false });
        setMessage(messageEl, saleEditingId ? 'Venda atualizada com sucesso.' : 'Venda registrada com sucesso.', 'success');
        resetSaleForm({ clearMessage: false });
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        setMessage(messageEl, error.message || 'Nao foi possivel salvar a venda.', 'error');
      }
    });

    salesTableBody?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const row = button.closest('tr[data-id]');
      const id = Number(row?.dataset.id);
      if (!Number.isInteger(id) || id <= 0) return;
      const action = button.dataset.action;
      if (action === 'edit') {
        const sale = sales.find((item) => item.id === id);
        if (!sale) return;
        saleEditingId = sale.id;
        form.dataset.mode = 'edit';
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.textContent = 'Salvar venda';
        if (saleOrderInput) {
          const orderValue =
            sale.order_number != null
              ? String(sale.order_number)
              : sale.orderNumber != null
                ? String(sale.orderNumber)
                : '';
          saleOrderInput.value = orderValue;
        }
        if (saleCouponSelect) saleCouponSelect.value = sale.cupom || '';
        if (saleDateInput) saleDateInput.value = sale.date || '';
        if (saleGrossInput) saleGrossInput.value = sale.gross_value != null ? String(sale.gross_value) : '';
        if (saleDiscountInput) saleDiscountInput.value = sale.discount != null ? String(sale.discount) : '';
        updateSaleComputedFields();
        setMessage(messageEl, 'Editando venda selecionada.', 'info');
      } else if (action === 'delete') {
        if (!window.confirm('Deseja realmente excluir esta venda?')) return;
        (async () => {
          try {
            await apiFetch(`/sales/${id}`, { method: 'DELETE' });
            if (saleEditingId === id) resetSaleForm({ clearMessage: true });
            await loadSalesForInfluencer(currentSalesInfluencerId, { showStatus: false });
            setMessage(messageEl, 'Venda removida com sucesso.', 'success');
          } catch (error) {
            if (error.status === 401) {
              logout();
              return;
            }
            setMessage(messageEl, error.message || 'Nao foi possivel excluir a venda.', 'error');
          }
        })();
      }
    });

    cancelSaleEditButton?.addEventListener('click', () => {
      resetSaleForm({ clearMessage: true });
      setMessage(messageEl, 'Edicao de venda cancelada.', 'info');
    });

    reloadSalesButton?.addEventListener('click', () => {
      loadSalesForInfluencer(currentSalesInfluencerId, { showStatus: true });
    });

    analyzeSalesImportButton?.addEventListener('click', async () => {
      if (!salesImportTextarea) return;
      const text = salesImportTextarea.value.trim();
      if (!text) {
        resetSalesImport({ clearText: false, clearMessage: false });
        setMessage(salesImportMessage, 'Cole os dados das vendas para analisar.', 'info');
        return;
      }

      setMessage(salesImportMessage, 'Analisando dados...', 'info');
      updateImportConfirmState();

      try {
        const analysis = await apiFetch('/sales/import/preview', {
          method: 'POST',
          body: { text }
        });
        lastImportText = text;
        lastImportAnalysis = analysis;
        renderSalesImportTable(analysis.rows);
        renderSalesImportSummary(analysis);
        if (!analysis.totalCount) {
          setMessage(salesImportMessage, 'Nenhuma linha de venda foi encontrada.', 'info');
        } else if (analysis.hasErrors) {
          const errorsCount = analysis.errorCount ?? Math.max(analysis.totalCount - analysis.validCount, 0);
          setMessage(
            salesImportMessage,
            `Encontramos ${errorsCount} linha(s) com problema. Corrija antes de concluir a importacao.`,
            'error'
          );
        } else {
          setMessage(
            salesImportMessage,
            `Todos os ${analysis.validCount} pedidos estao prontos para importacao.`,
            'success'
          );
        }
      } catch (error) {
        lastImportAnalysis = null;
        renderSalesImportTable([]);
        renderSalesImportSummary(null);
        setMessage(
          salesImportMessage,
          error.message || 'Nao foi possivel analisar os dados para importacao.',
          'error'
        );
      }

      updateImportConfirmState();
    });

    confirmSalesImportButton?.addEventListener('click', async () => {
      if (!salesImportTextarea) return;
      const text = (lastImportText || salesImportTextarea.value || '').trim();
      if (!text) {
        setMessage(salesImportMessage, 'Analise os dados antes de confirmar a importacao.', 'info');
        updateImportConfirmState();
        return;
      }

      confirmSalesImportButton.setAttribute('disabled', 'disabled');
      setMessage(salesImportMessage, 'Salvando pedidos importados...', 'info');

      try {
        const result = await apiFetch('/sales/import/confirm', {
          method: 'POST',
          body: { text }
        });
        setMessage(
          salesImportMessage,
          `Importacao concluida! ${result.inserted} venda(s) foram cadastradas.`,
          'success'
        );
        resetSalesImport({ clearText: true, clearMessage: false });
        await loadSalesForInfluencer(currentSalesInfluencerId, { showStatus: true });
      } catch (error) {
        const analysis = error.data?.analysis;
        if (analysis) {
          lastImportAnalysis = analysis;
          renderSalesImportTable(analysis.rows);
          renderSalesImportSummary(analysis);
        }
        setMessage(
          salesImportMessage,
          error.message || 'Nao foi possivel concluir a importacao.',
          'error'
        );
      } finally {
        updateImportConfirmState();
      }
    });

    clearSalesImportButton?.addEventListener('click', () => {
      resetSalesImport({ clearText: true });
      setMessage(salesImportMessage, 'Area de importacao limpa.', 'info');
    });

    loadInfluencersForSales();
  };


  const renderInfluencerDetails = (container, data) => {
    if (!container) return;
    container.innerHTML = '';
    if (!data) {
      container.textContent = 'Nenhum dado encontrado.';
      return;
    }

    const createValueElement = (value) => {
      if (value && typeof value === 'object') {
        if (value.type === 'link' && value.url) {
          const anchor = document.createElement('a');
          anchor.href = value.url;
          anchor.className = 'detail-link';
          anchor.classList.add('info-value');
          anchor.textContent = value.label || value.url;
          if (value.external !== false) {
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
          }
          return anchor;
        }
      }
      const el = document.createElement('span');
      el.className = 'info-value';
      el.textContent = value == null || value === '' ? '-' : String(value);
      return el;
    };

    const instagramHandle = (data.instagram || '').trim();
    const hasInstagram = instagramHandle && instagramHandle !== '-';
    const instagramLabel = hasInstagram
      ? instagramHandle.startsWith('@')
        ? instagramHandle
        : `@${instagramHandle}`
      : data.instagram;
    const instagramValue = hasInstagram
      ? {
          type: 'link',
          url: `https://www.instagram.com/${instagramHandle.replace(/^@/, '')}`,
          label: instagramLabel,
          external: true
        }
      : data.instagram;

    const emailValue =
      data.email && data.email !== '-'
        ? { type: 'link', url: `mailto:${data.email}`, label: data.email, external: false }
        : data.email;

    const contactDigits = digitOnly(data.contato);
    const contactValue =
      data.contato && data.contato !== '-' && contactDigits
        ? { type: 'link', url: `tel:+55${contactDigits}`, label: data.contato, external: false }
        : data.contato;

    const loginEmailValue =
      data.loginEmail && data.loginEmail !== '-'
        ? { type: 'link', url: `mailto:${data.loginEmail}`, label: data.loginEmail, external: false }
        : data.loginEmail;

    const addressParts = [data.logradouro, data.numero].filter((part) => part && part !== '-');
    const addressValue = addressParts.length ? addressParts.join(', ') : data.logradouro;

    const locationParts = [data.cidade, data.estado].filter((part) => part && part !== '-');
    const locationValue = locationParts.length ? locationParts.join(' / ') : '-';

    const items = [
      {
        key: 'nome',
        label: 'Nome',
        value: data.nome
      },
      {
        key: 'cupom',
        label: 'Cupom',
        value: data.cupom
      },
      {
        key: 'link',
        label: 'Link',
        value:
          data.discountLink && data.discountLink !== '-'
            ? {
                type: 'link',
                url: data.discountLink,
                label: data.discountLink
              }
            : '-'
      }
    ];

    const fragment = document.createDocumentFragment();

    items.forEach(({ key, label, value }) => {
      const item = document.createElement('div');
      item.className = 'info-item';
      if (key) {
        item.dataset.field = key;
      }

      const labelEl = document.createElement('span');
      labelEl.className = 'info-label';
      labelEl.textContent = `${label}:`;
      item.appendChild(labelEl);

      const valueEl = createValueElement(value);
      if (valueEl) {
        item.appendChild(valueEl);
      }

      fragment.appendChild(item);
    });

    container.appendChild(fragment);
  };

  const renderInfluencerStatus = (container, message) => {
    if (!container) return;
    container.innerHTML = '';
    if (!message) return;
    const status = document.createElement('p');
    status.className = 'info-status';
    status.textContent = message;
    container.appendChild(status);
  };

  const initInfluencerPage = () => {
    if (!ensureAuth()) return;
    attachLogoutButtons();

    const detailsEl = document.getElementById('influencerDetails');
    const greetingEl = document.getElementById('influencerGreeting');

    const salesMessageEl = document.getElementById('influencerSalesMessage');
    const salesTableBody = document.querySelector('#influencerSalesTable tbody');

    const renderSalesTable = (rows) => {
      if (!salesTableBody) return;
      salesTableBody.innerHTML = '';
      if (!Array.isArray(rows) || rows.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 4;
        emptyCell.className = 'empty';
        emptyCell.textContent = 'Nenhuma venda registrada.';
        emptyRow.appendChild(emptyCell);
        salesTableBody.appendChild(emptyRow);
        return;
      }
      const fragment = document.createDocumentFragment();
      rows.forEach((sale) => {
        const tr = document.createElement('tr');
        const customerName =
          sale.customer_name || sale.cliente || sale.customer || sale.client_name || sale.client || '-';
        const valueToDisplay =
          sale.net_value != null && sale.net_value !== ''
            ? formatCurrency(sale.net_value)
            : formatCurrency(sale.gross_value);
        const statusLabel = sale.status || sale.status_label || sale.statusLabel || 'Concluída';
        const cells = [
          { label: 'Data', value: sale.date || '-' },
          { label: 'Cliente', value: customerName },
          { label: 'Valor', value: valueToDisplay },
          { label: 'Status', value: statusLabel }
        ];
        cells.forEach(({ label, value }) => {
          const td = document.createElement('td');
          td.textContent = value;
          td.dataset.label = label;
          tr.appendChild(td);
        });
        fragment.appendChild(tr);
      });
      salesTableBody.appendChild(fragment);
    };

    const loadInfluencerSales = async (influencerId) => {
      if (!influencerId) {
        renderSalesTable([]);
        setMessage(salesMessageEl, '', '');
        return;
      }
      setMessage(salesMessageEl, 'Carregando vendas...', 'info');
      try {
        const salesData = await apiFetch(`/sales/${influencerId}`);
        const rows = Array.isArray(salesData) ? salesData : [];
        renderSalesTable(rows);
        setMessage(salesMessageEl, '', '');
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        setMessage(salesMessageEl, error.message || 'Nao foi possivel carregar as vendas.', 'error');
        renderSalesTable([]);
      }
    };

    const loadInfluencer = async () => {
      renderInfluencerStatus(detailsEl, 'Carregando dados...');
      try {
        const data = await apiFetch('/influenciadoras');
        const influencer = Array.isArray(data) ? data[0] : null;
        if (!influencer) {
          renderInfluencerStatus(detailsEl, 'Nenhum registro associado ao seu usuario.');
          renderSalesTable([]);
          setMessage(salesMessageEl, '', '');
          if (greetingEl) {
            greetingEl.textContent = 'Bem vinda, Pinklover.';
          }
          return;
        }
        renderInfluencerDetails(detailsEl, formatInfluencerDetails(influencer));
        if (greetingEl) {
          const safeName = (influencer.nome || '').trim() || 'Pinklover';
          greetingEl.textContent = `Bem vinda, ${safeName}.`;
        }
        loadInfluencerSales(influencer.id);
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        renderInfluencerStatus(detailsEl, error.message || 'Nao foi possivel carregar os dados.');
        if (greetingEl) {
          greetingEl.textContent = 'Bem vinda, Pinklover.';
        }
      }
    };

    loadInfluencer();
  };


  const initChangePasswordPage = () => {
    if (!ensureAuth()) return;
    attachLogoutButtons();
    const form = document.getElementById('changePasswordForm');
    const messageEl = document.getElementById('changePasswordMessage');
    addRealtimeValidation(form);

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      setMessage(messageEl, 'Funcionalidade de alteracao de senha ainda nao esta disponivel.', 'info');
    });

  };

  const initResetPasswordPage = () => {
    attachLogoutButtons();
    const requestForm = document.getElementById('resetRequestForm');
    const confirmForm = document.getElementById('resetConfirmForm');
    const requestMessage = document.getElementById('resetRequestMessage');
    const confirmMessage = document.getElementById('resetConfirmMessage');

    addRealtimeValidation(requestForm);
    addRealtimeValidation(confirmForm);

    requestForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      setMessage(requestMessage, 'Funcionalidade de recuperacao ainda nao esta disponivel.', 'info');
    });

    confirmForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      setMessage(confirmMessage, 'Funcionalidade de recuperacao ainda nao esta disponivel.', 'info');
    });

  };

  const bootstrap = () => {
    const page = document.body?.dataset.page || '';
    const initializers = {
      login: initLoginPage,
      'master-home': initMasterHomePage,
      'master-create': initMasterCreatePage,
      'master-consult': initMasterConsultPage,
      'master-list': initMasterListPage,
      'master-sales': initMasterSalesPage,
      influencer: initInfluencerPage,
      'change-password': initChangePasswordPage,
      'reset-password': initResetPasswordPage
    };
    const initializer = initializers[page];
    if (initializer) {
      initializer();
    } else {
      attachLogoutButtons();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();






