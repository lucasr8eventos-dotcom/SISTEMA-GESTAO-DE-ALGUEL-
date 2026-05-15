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
