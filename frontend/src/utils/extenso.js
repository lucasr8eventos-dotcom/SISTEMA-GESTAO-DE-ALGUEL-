// Valor monetário por extenso (pt-BR) — usado para pré-visualização ao vivo.
// O valor gravado no recibo é calculado no backend (fonte da verdade).

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const ESPECIAIS = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const partes = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 10) partes.push(UNIDADES[resto]);
    else if (resto < 20) partes.push(ESPECIAIS[resto - 10]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

function inteiroExtenso(n) {
  if (n === 0) return 'zero';
  const grupos = [];
  let resto = n;
  while (resto > 0) { grupos.push(resto % 1000); resto = Math.floor(resto / 1000); }
  const escalaSing = ['', 'mil', 'milhão', 'bilhão', 'trilhão'];
  const escalaPlur = ['', 'mil', 'milhões', 'bilhões', 'trilhões'];

  const itens = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g === 0) continue;
    let texto = ate999(g);
    if (i === 1) texto = (g === 1) ? 'mil' : `${texto} mil`;
    else if (i >= 2) texto = `${texto} ${g === 1 ? escalaSing[i] : escalaPlur[i]}`;
    itens.push({ idx: i, g, texto });
  }

  let saida = '';
  itens.forEach((it, k) => {
    if (k === 0) { saida = it.texto; return; }
    const liga = it.idx === 0 && (it.g < 100 || it.g % 100 === 0);
    saida += (liga ? ' e ' : ', ') + it.texto;
  });
  return saida;
}

export function valorPorExtenso(valorNum) {
  const v = Math.round(Number(valorNum || 0) * 100);
  const reais = Math.floor(v / 100);
  const centavos = v % 100;
  const partes = [];
  if (reais > 0) {
    const usaDe = reais >= 1000000 && reais % 1000000 === 0;
    partes.push(`${inteiroExtenso(reais)} ${usaDe ? 'de ' : ''}${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos > 0) partes.push(`${inteiroExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  if (partes.length === 0) return 'zero real';
  return partes.join(' e ');
}

// Capitaliza apenas a 1ª letra da frase (o resto fica minúsculo, como no
// padrão do português). Evita "Reais E Cinquenta" do text-transform: capitalize.
export const capitalizar = (s = '') => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const FORMAS_PAGAMENTO_RECIBO = [
  { value: 'pix', label: 'PIX' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'debito', label: 'Cartão de Débito' },
  { value: 'credito', label: 'Cartão de Crédito' },
  { value: 'ted', label: 'TED' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'outro', label: 'Outro' }
];

export const formaReciboLabel = (f) => (FORMAS_PAGAMENTO_RECIBO.find((x) => x.value === f) || {}).label || (f || '—');
