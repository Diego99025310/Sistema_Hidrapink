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

  const formatPercentage = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return `${number.toFixed(2)}%`;
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
      instagram: data.instagram || '-',
      email: data.email || '-',
      contato: data.contato || '-',
      cupom: coupon || '-',
      commissionPercent: data.commission_rate != null ? formatPercentage(data.commission_rate) : '-',
      cep: data.cep || '-',
      logradouro: data.logradouro || '-',
      numero: data.numero || '-',
      complemento: data.complemento || '-',
      bairro: data.bairro || '-',
      cidade: data.cidade || '-',
      estado: data.estado || '-',
      loginEmail: data.login_email || data.loginEmail || '-',
      discountLink
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
    const importSalesForm = document.getElementById('importSalesForm');
    const importReferenceDateInput = document.getElementById('importReferenceDate');
    const importSalesFileInput = document.getElementById('importSalesFile');
    const importMessageEl = document.getElementById('importSalesMessage');
    const clearImportButton = document.getElementById('clearImportButton');
    const importPreviewWrapper = document.getElementById('importPreview');
    const importPreviewTableBody = document.querySelector('#importPreviewTable tbody');
    const importSummaryEl = document.getElementById('importSummary');

    addRealtimeValidation(form);
    addRealtimeValidation(importSalesForm);

    let influencers = [];
    let sales = [];
    let currentSalesInfluencerId = null;
    let saleEditingId = null;

    const showElement = (element) => {
      element?.classList?.remove('hidden');
    };

    const hideElement = (element) => {
      element?.classList?.add('hidden');
    };

    const readFileAsText = (file) => {
      if (!file) return Promise.resolve('');
      if (typeof file.text === 'function') {
        return file.text();
      }
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result || '');
        reader.onerror = () => reject(reader.error || new Error('Falha ao ler o arquivo.'));
        reader.readAsText(file);
      });
    };

    const getNestedValue = (object, path) => {
      if (!object || typeof object !== 'object') return undefined;
      const parts = String(path)
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean);
      if (!parts.length) return undefined;
      let value = object;
      for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
          value = value[part];
        } else {
          return undefined;
        }
      }
      return value;
    };

    const findValueByKeys = (object, keys = []) => {
      if (!object || typeof object !== 'object') return undefined;
      for (const key of keys) {
        if (!key) continue;
        const value = key.includes('.') ? getNestedValue(object, key) : object[key];
        if (value !== undefined && value !== null) {
          return value;
        }
      }
      return undefined;
    };

    const parseNumeric = (value) => {
      if (value == null || value === '') return null;
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
      }
      if (typeof value === 'boolean') {
        return value ? 1 : 0;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        let sanitized = trimmed.replace(/[^0-9.,-]/g, '');
        if (!sanitized) return null;
        const lastComma = sanitized.lastIndexOf(',');
        const lastDot = sanitized.lastIndexOf('.');
        if (lastComma > lastDot) {
          sanitized = sanitized.replace(/\./g, '').replace(',', '.');
        } else if (lastDot > lastComma) {
          sanitized = sanitized.replace(/,/g, '');
        } else {
          sanitized = sanitized.replace(/,/g, '.');
        }
        const number = Number(sanitized);
        return Number.isFinite(number) ? number : null;
      }
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };

    const parseInteger = (value) => {
      const number = parseNumeric(value);
      if (!Number.isFinite(number)) return null;
      return Math.round(number);
    };

    const extractArrayFromData = (data) => {
      if (Array.isArray(data)) return data;
      if (!data || typeof data !== 'object') return [];
      const possibleKeys = [
        'sales',
        'vendas',
        'data',
        'items',
        'pedidos',
        'coupons',
        'relatorio',
        'relatorio_detalhado',
        'report',
        'reports',
        'resultado',
        'result',
        'entries',
        'rows',
        'values',
        'lista'
      ];
      for (const key of possibleKeys) {
        const value = data[key];
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
          const nested = extractArrayFromData(value);
          if (nested.length) return nested;
        }
      }
      for (const value of Object.values(data)) {
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
          const nested = extractArrayFromData(value);
          if (nested.length) return nested;
        }
      }
      return [];
    };

    const normalizeImportEntries = (entries = []) => {
      if (!Array.isArray(entries)) return [];
      const couponKeys = ['cupom', 'coupon', 'discount_code', 'discountCode', 'code', 'coupon_code', 'couponCode', 'name'];
      const grossKeys = [
        'grossSales',
        'gross_sales',
        'gross_value',
        'valor_bruto',
        'valorBruto',
        'vendas_brutas',
        'sales_gross',
        'amount.gross',
        'gross'
      ];
      const discountKeys = [
        'discount',
        'discount_total',
        'discountAmount',
        'discount_amount',
        'valor_desconto',
        'desconto',
        'descontos',
        'amount.discount'
      ];
      const netKeys = [
        'netSales',
        'net_sales',
        'net_value',
        'valor_liquido',
        'valorLiquido',
        'vendas_liquidas',
        'amount.net',
        'net'
      ];
      const ordersKeys = ['orders', 'orders_with_discount', 'ordersWithDiscount', 'pedidos', 'total_orders', 'ordersApplied'];

      return entries.map((entry, index) => {
        const couponValue = findValueByKeys(entry, couponKeys);
        const coupon = couponValue != null ? String(couponValue).trim() : '';
        const influencer = getInfluencerByCoupon(coupon);

        let grossValue = parseNumeric(findValueByKeys(entry, grossKeys));
        let discount = parseNumeric(findValueByKeys(entry, discountKeys));
        let netValue = parseNumeric(findValueByKeys(entry, netKeys));
        const orders = parseInteger(findValueByKeys(entry, ordersKeys));

        if (!Number.isFinite(grossValue) && Number.isFinite(netValue) && Number.isFinite(discount)) {
          grossValue = netValue + discount;
        }

        if (!Number.isFinite(netValue) && Number.isFinite(grossValue) && Number.isFinite(discount)) {
          netValue = grossValue - discount;
        }

        if (!Number.isFinite(discount) && Number.isFinite(grossValue) && Number.isFinite(netValue)) {
          discount = Math.max(0, grossValue - netValue);
        }

        if (!Number.isFinite(grossValue) && Number.isFinite(netValue)) {
          grossValue = netValue + Math.max(0, discount || 0);
        }

        if (!Number.isFinite(netValue) && Number.isFinite(grossValue)) {
          netValue = grossValue - Math.max(0, discount || 0);
        }

        grossValue = Number.isFinite(grossValue) ? Math.max(0, grossValue) : null;
        discount = Number.isFinite(discount) ? Math.max(0, discount) : 0;
        netValue = Number.isFinite(netValue) ? Math.max(0, netValue) : null;

        if (grossValue == null && netValue != null) {
          grossValue = netValue + discount;
        }

        if (netValue == null && grossValue != null) {
          netValue = Math.max(0, grossValue - discount);
        }

        if (!Number.isFinite(netValue)) netValue = null;
        if (!Number.isFinite(grossValue)) grossValue = null;

        const result = {
          index: index + 1,
          entry,
          cupom: coupon,
          influencerId: influencer?.id || null,
          influencerName: influencer?.nome || '',
          grossValue,
          discount,
          netValue,
          orders: Number.isFinite(orders) ? Math.max(0, orders) : null,
          canImport: Boolean(influencer && coupon && grossValue != null),
          status: 'ready',
          statusMessage: 'Pronto para importação'
        };

        if (!coupon) {
          result.status = 'error';
          result.statusMessage = 'Cupom ausente no arquivo.';
          result.canImport = false;
        } else if (!influencer) {
          result.status = 'warning';
          result.statusMessage = 'Cupom não cadastrado no sistema.';
          result.canImport = false;
        } else if (grossValue == null) {
          result.status = 'error';
          result.statusMessage = 'Valor bruto não encontrado para o cupom.';
          result.canImport = false;
        } else if (netValue == null) {
          result.status = 'error';
          result.statusMessage = 'Valor líquido não pôde ser calculado.';
          result.canImport = false;
        }

        return result;
      });
    };

    const renderImportPreview = (rows = []) => {
      if (!importPreviewTableBody) return;
      importPreviewTableBody.innerHTML = '';
      if (!rows.length) {
        hideElement(importPreviewWrapper);
        hideElement(importSummaryEl);
        return;
      }

      const fragment = document.createDocumentFragment();
      rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.dataset.status = row.status || 'ready';
        const columns = [
          row.cupom || '-',
          row.influencerName || '-',
          row.orders != null ? String(row.orders) : '-',
          row.grossValue != null ? formatCurrency(row.grossValue) : '-',
          formatCurrency(row.discount || 0),
          row.netValue != null ? formatCurrency(row.netValue) : '-',
          row.statusMessage || '-'
        ];
        columns.forEach((value, columnIndex) => {
          const td = document.createElement('td');
          if (columnIndex === columns.length - 1) {
            const badge = document.createElement('span');
            badge.className = 'status-badge';
            badge.dataset.status = row.status || 'ready';
            badge.textContent = value;
            td.appendChild(badge);
          } else {
            td.textContent = value;
          }
          tr.appendChild(td);
        });
        fragment.appendChild(tr);
      });

      importPreviewTableBody.appendChild(fragment);
      showElement(importPreviewWrapper);

      if (importSummaryEl) {
        const total = rows.length;
        const successCount = rows.filter((row) => row.status === 'success').length;
        const readyCount = rows.filter((row) => row.status === 'ready').length;
        const warningCount = rows.filter((row) => row.status === 'warning' || row.status === 'skipped').length;
        const errorCount = rows.filter((row) => row.status === 'error' || row.status === 'failed').length;

        importSummaryEl.innerHTML = '';
        const summaryItems = [
          { count: total, label: 'itens processados', status: 'info' },
          { count: successCount, label: 'importados', status: 'success' },
          { count: readyCount, label: 'prontos para importar', status: 'ready' },
          { count: warningCount, label: 'com alerta', status: 'warning' },
          { count: errorCount, label: 'com erro', status: 'error' }
        ].filter((item) => item.count > 0);

        summaryItems.forEach((item) => {
          const span = document.createElement('span');
          span.dataset.status = item.status;
          span.innerHTML = `<strong>${item.count}</strong> ${item.label}`;
          importSummaryEl.appendChild(span);
        });

        if (summaryItems.length) {
          showElement(importSummaryEl);
        } else {
          hideElement(importSummaryEl);
        }
      }
    };

    const clearImportState = () => {
      importSalesForm?.reset();
      importSalesForm?.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
      setMessage(importMessageEl, '', '');
      hideElement(importSummaryEl);
      hideElement(importPreviewWrapper);
      if (importSalesFileInput) importSalesFileInput.value = '';
      if (importPreviewTableBody) importPreviewTableBody.innerHTML = '';
    };

    const setFormBusy = (formEl, busy) => {
      if (!formEl) return;
      const elements = Array.from(formEl.elements || []);
      elements.forEach((element) => {
        if (busy) {
          element.dataset.prevDisabled = element.disabled ? 'true' : 'false';
          element.disabled = true;
        } else {
          if (element.dataset.prevDisabled !== 'true') {
            element.disabled = false;
          }
          delete element.dataset.prevDisabled;
        }
      });
    };

    clearImportButton?.addEventListener('click', (event) => {
      event.preventDefault();
      clearImportState();
    });

    importSalesForm?.addEventListener('submit', async (event) => {
      event.preventDefault();

      const referenceDate = importReferenceDateInput?.value || '';
      const file = importSalesFileInput?.files?.[0] || null;

      flagInvalidField(importReferenceDateInput, Boolean(referenceDate));
      flagInvalidField(importSalesFileInput, Boolean(file));

      if (!referenceDate || !file) {
        setMessage(importMessageEl, 'Informe a data e selecione o arquivo JSON para importar.', 'error');
        return;
      }

      if (!influencers.length) {
        setMessage(importMessageEl, 'Carregando influenciadoras cadastradas. Aguarde um instante e tente novamente.', 'info');
        await loadInfluencersForSales();
        if (!influencers.length) {
          setMessage(importMessageEl, 'Cadastre influenciadoras com cupom antes de importar as vendas.', 'error');
          return;
        }
      }

      setFormBusy(importSalesForm, true);
      setMessage(importMessageEl, 'Lendo arquivo e preparando as vendas...', 'info');

      try {
        const fileContent = await readFileAsText(file);
        let parsed;
        try {
          parsed = JSON.parse(fileContent);
        } catch (parseError) {
          throw new Error('O arquivo selecionado não contém um JSON válido.');
        }

        const rawEntries = extractArrayFromData(parsed);
        if (!rawEntries.length) {
          throw new Error('Nenhuma venda foi encontrada no arquivo informado.');
        }

        const normalizedEntries = normalizeImportEntries(rawEntries);
        normalizedEntries
          .filter((item) => item.status === 'warning' && !item.canImport)
          .forEach((item) => {
            item.status = 'skipped';
            item.statusMessage = 'Cupom não cadastrado. Cadastre-o e tente novamente.';
          });

        renderImportPreview(normalizedEntries);

        const importableEntries = normalizedEntries.filter((item) => item.canImport);

        if (!importableEntries.length) {
          setMessage(
            importMessageEl,
            'Nenhuma venda está pronta para importação. Revise os avisos destacados na tabela.',
            'error'
          );
          return;
        }

        setMessage(importMessageEl, 'Enviando vendas para o sistema...', 'info');

        let successCount = 0;
        let failureCount = 0;

        for (const item of importableEntries) {
          try {
            await apiFetch('/sales', {
              method: 'POST',
              body: {
                cupom: item.cupom,
                date: referenceDate,
                grossValue: item.grossValue,
                discount: item.discount || 0
              }
            });
            item.status = 'success';
            item.statusMessage = 'Importada com sucesso.';
            successCount += 1;
          } catch (error) {
            if (error.status === 401) {
              logout();
              return;
            }
            item.status = 'failed';
            item.statusMessage = error.message || 'Erro ao importar venda.';
            failureCount += 1;
          }
        }

        renderImportPreview(normalizedEntries);

        if (importSalesFileInput) {
          importSalesFileInput.value = '';
        }

        if (successCount && !failureCount) {
          setMessage(importMessageEl, `Importação concluída com ${successCount} vendas.`, 'success');
        } else if (successCount && failureCount) {
          setMessage(
            importMessageEl,
            `Importação finalizada com alertas: ${successCount} vendas criadas e ${failureCount} falharam.`,
            'info'
          );
        } else {
          setMessage(importMessageEl, 'Nenhuma venda foi importada. Verifique o arquivo e tente novamente.', 'error');
        }

        if (successCount && currentSalesInfluencerId) {
          await loadSalesForInfluencer(currentSalesInfluencerId, { showStatus: false });
          setMessage(messageEl, 'Vendas atualizadas após importação.', 'success');
        }
      } catch (error) {
        setMessage(importMessageEl, error.message || 'Não foi possível processar o arquivo informado.', 'error');
        hideElement(importSummaryEl);
        hideElement(importPreviewWrapper);
        if (importPreviewTableBody) importPreviewTableBody.innerHTML = '';
      } finally {
        setFormBusy(importSalesForm, false);
      }
    });

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
        emptyCell.colSpan = 7;
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
          sale.date || '-',
          sale.cupom || '-',
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

    const renderSalesSummary = (summary) => {
      if (!salesSummaryEl) return;
      if (!summary) {
        salesSummaryEl.textContent = '';
        return;
      }
      salesSummaryEl.innerHTML = '';
      const totalNet = document.createElement('span');
      totalNet.textContent = `Total em vendas: ${formatCurrency(summary.total_net)}`;
      const totalCommission = document.createElement('span');
      totalCommission.textContent = `Sua comissão: ${formatCurrency(summary.total_commission)}`;
      salesSummaryEl.append(totalNet, totalCommission);
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
        renderSalesSummary(null);
        return;
      }
      if (showStatus) setMessage(messageEl, 'Carregando vendas...', 'info');
      try {
        const salesData = await apiFetch(`/sales/${influencerId}`);
        sales = Array.isArray(salesData) ? salesData : [];
        renderSalesTable();
        try {
          const summary = await apiFetch(`/sales/summary/${influencerId}`);
          renderSalesSummary(summary);
        } catch (summaryError) {
          if (summaryError.status === 401) {
            logout();
            return;
          }
          renderSalesSummary(null);
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
        renderSalesTable([]);
        renderSalesSummary(null);
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
        renderSalesSummary(null);
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

      const coupon = (saleCouponSelect?.value || '').trim();
      const date = saleDateInput?.value || '';
      const gross = Number(saleGrossInput?.value || 0);
      const discount = Number(saleDiscountInput?.value || 0);

      flagInvalidField(saleCouponSelect, Boolean(coupon));
      flagInvalidField(saleDateInput, Boolean(date));
      flagInvalidField(saleGrossInput, Number.isFinite(gross) && gross >= 0);
      flagInvalidField(saleDiscountInput, Number.isFinite(discount) && discount >= 0 && discount <= gross);

      if (!coupon || !date || !Number.isFinite(gross) || gross < 0 || !Number.isFinite(discount) || discount < 0 || discount > gross) {
        setMessage(messageEl, 'Verifique os campos da venda. Desconto nao pode ser maior que o valor bruto.', 'error');
        focusFirstInvalidField(form);
        return;
      }

      const payload = { cupom: coupon, date, grossValue: gross, discount };
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

    loadInfluencersForSales();
  };


  const renderInfluencerDetails = (container, data) => {
    if (!container) return;
    container.innerHTML = '';
    if (!data) {
      container.textContent = 'Nenhum dado encontrado.';
      return;
    }

    const createCopyLinkElement = (value) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'info-value detail-actions';
      if (!value?.url) {
        wrapper.textContent = '-';
        return wrapper;
      }

      const linkLabel = value.label || value.url;
      const anchor = document.createElement('a');
      anchor.href = value.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'detail-link';
      anchor.textContent = linkLabel;
      wrapper.appendChild(anchor);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-button';
      const defaultCopyLabel = value.copyLabel || 'Copiar link';
      copyBtn.textContent = defaultCopyLabel;
      const successLabel = value.successLabel || 'Copiado!';
      const errorLabel = value.errorLabel || 'Tente novamente';

      copyBtn.addEventListener('click', async () => {
        try {
          await copyTextToClipboard(value.url);
          copyBtn.textContent = successLabel;
          copyBtn.classList.add('copied');
        } catch (error) {
          console.error(error);
          copyBtn.textContent = errorLabel;
          copyBtn.classList.add('error');
        }
        window.setTimeout(() => {
          copyBtn.textContent = defaultCopyLabel;
          copyBtn.classList.remove('copied', 'error');
        }, 2000);
      });

      wrapper.appendChild(copyBtn);
      return wrapper;
    };

    const createValueElement = (value) => {
      if (value && typeof value === 'object' && value.type === 'copy-link') {
        return createCopyLinkElement(value);
      }
      const el = document.createElement('span');
      el.className = 'info-value';
      el.textContent = value == null || value === '' ? '-' : String(value);
      return el;
    };

    const items = [
      ['Nome', data.nome],
      ['Cupom', data.cupom],
      [
        'Link',
        data.discountLink
          ? {
              type: 'copy-link',
              url: data.discountLink,
              label: data.discountLink,
              copyLabel: 'Copiar link'
            }
          : '-'
      ]
    ];

    const fragment = document.createDocumentFragment();

    items.forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'info-item';

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

  const initInfluencerPage = () => {
    if (!ensureAuth()) return;
    attachLogoutButtons();

    const detailsEl = document.getElementById('influencerDetails');
    const messageEl = document.getElementById('influencerMessage');

    const salesMessageEl = document.getElementById('influencerSalesMessage');
    const salesTableBody = document.querySelector('#influencerSalesTable tbody');
    const salesSummaryEl = document.getElementById('influencerSalesSummary');

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
        const cells = [sale.date || '-', customerName, valueToDisplay, statusLabel];
        cells.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value;
          tr.appendChild(td);
        });
        fragment.appendChild(tr);
      });
      salesTableBody.appendChild(fragment);
    };

    const renderSalesSummary = (summary) => {
      if (!salesSummaryEl) return;
      if (!summary) {
        salesSummaryEl.textContent = '';
        return;
      }
      salesSummaryEl.innerHTML = '';
      const totalNet = document.createElement('span');
      totalNet.textContent = `Total em vendas: ${formatCurrency(summary.total_net)}`;
      const totalCommission = document.createElement('span');
      totalCommission.textContent = `Sua comissão: ${formatCurrency(summary.total_commission)}`;
      salesSummaryEl.append(totalNet, totalCommission);
    };

    const loadInfluencerSales = async (influencerId) => {
      if (!influencerId) {
        renderSalesTable([]);
        renderSalesSummary(null);
        return;
      }
      setMessage(salesMessageEl, 'Carregando vendas...', 'info');
      try {
        const salesData = await apiFetch(`/sales/${influencerId}`);
        renderSalesTable(Array.isArray(salesData) ? salesData : []);
        try {
          const summaryData = await apiFetch(`/sales/summary/${influencerId}`);
          renderSalesSummary(summaryData);
        } catch (summaryError) {
          if (summaryError.status === 401) {
            logout();
            return;
          }
          renderSalesSummary(null);
        }
        if (!salesData?.length) {
          setMessage(salesMessageEl, '', '');
        } else {
          setMessage(salesMessageEl, 'Vendas atualizadas com sucesso.', 'success');
        }
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        setMessage(salesMessageEl, error.message || 'Nao foi possivel carregar as vendas.', 'error');
        renderSalesTable([]);
        renderSalesSummary(null);
      }
    };

    const loadInfluencer = async () => {
      setMessage(messageEl, 'Carregando dados...', 'info');
      try {
        const data = await apiFetch('/influenciadoras');
        const influencer = Array.isArray(data) ? data[0] : null;
        if (!influencer) {
          setMessage(messageEl, 'Nenhum registro associado ao seu usuario.', 'info');
          renderInfluencerDetails(detailsEl, null);
          renderSalesTable([]);
          renderSalesSummary(null);
          return;
        }
        renderInfluencerDetails(detailsEl, formatInfluencerDetails(influencer));
        setMessage(messageEl, 'Dados atualizados com sucesso, Pinklover! 💗', 'success');
        loadInfluencerSales(influencer.id);
      } catch (error) {
        if (error.status === 401) {
          logout();
          return;
        }
        setMessage(messageEl, error.message || 'Nao foi possivel carregar os dados.', 'error');
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






