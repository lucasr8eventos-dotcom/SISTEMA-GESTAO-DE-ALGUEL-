// CPF: 000.000.000-00   CNPJ: 00.000.000/0000-00 (auto pelo tamanho)
export const maskCpfCnpj = (raw = '') => {
  const d = raw.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

// Celular: (00) 00000-0000   Fixo: (00) 0000-0000 (auto pelo tamanho)
export const maskPhone = (raw = '') => {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 10) {
    return d
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2');
};

// ===== Validação de CPF/CNPJ (dígito verificador) =====
export const validarCpf = (cpf = '') => {
  const c = String(cpf).replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false; // rejeita 000... e repetidos
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(c[i], 10) * (10 - i);
  let d1 = 11 - (soma % 11); if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(c[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(c[i], 10) * (11 - i);
  let d2 = 11 - (soma % 11); if (d2 >= 10) d2 = 0;
  return d2 === parseInt(c[10], 10);
};

export const validarCnpj = (cnpj = '') => {
  const c = String(cnpj).replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dig = (base) => {
    const len = base.length;
    let pos = len - 7, soma = 0;
    for (let i = 0; i < len; i++) {
      soma += parseInt(base[i], 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (dig(c.slice(0, 12)) !== parseInt(c[12], 10)) return false;
  return dig(c.slice(0, 13)) === parseInt(c[13], 10);
};

// Valida pelo tamanho: 11 dígitos → CPF, 14 → CNPJ. Vazio é tratado fora daqui.
export const validarCpfCnpj = (doc = '') => {
  const d = String(doc).replace(/\D/g, '');
  if (d.length === 11) return validarCpf(d);
  if (d.length === 14) return validarCnpj(d);
  return false;
};

// Converte string do input (pode ter máscara) → float string "1500.00"
export const parseMoney = (inputVal = '') => {
  const digits = String(inputVal).replace(/\D/g, '');
  if (!digits) return '';
  return (parseInt(digits, 10) / 100).toFixed(2);
};

// Converte float string "1500.00" → display "1.500,00"
export const displayMoney = (floatStr) => {
  if (floatStr === '' || floatStr === null || floatStr === undefined) return '';
  const n = parseFloat(floatStr);
  if (isNaN(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
