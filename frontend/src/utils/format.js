export const formatMoeda = (valor) => {
  if (valor === null || valor === undefined || valor === '') return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(valor));
};

export const formatData = (data) => {
  if (!data) return '—';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
};

export const formatDataHora = (data) => {
  if (!data) return '—';
  return new Date(data).toLocaleString('pt-BR');
};

export const formatCpfCnpj = (valor) => {
  if (!valor) return '—';
  const v = valor.replace(/\D/g, '');
  if (v.length === 11) {
    return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (v.length === 14) {
    return v.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return valor;
};

export const formatTelefone = (valor) => {
  if (!valor) return '—';
  const v = valor.replace(/\D/g, '');
  if (v.length === 11) return v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (v.length === 10) return v.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return valor;
};

export const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export const statusContrato = (status) => {
  const map = {
    ativo: { label: 'Ativo', className: 'badge-success' },
    vencido: { label: 'Vencido', className: 'badge-danger' },
    encerrado: { label: 'Encerrado', className: 'badge-gray' }
  };
  return map[status] || { label: status, className: 'badge-gray' };
};

export const statusImovel = (status) => {
  const map = {
    alugado: { label: 'Alugado', className: 'badge-success' },
    vago: { label: 'Vago', className: 'badge-gray' },
    encerrado: { label: 'Encerrado', className: 'badge-gray' },
    negociacao: { label: 'Negociação', className: 'badge-info' },
    manutencao: { label: 'Em Manutenção', className: 'badge-warning' }
  };
  return map[status] || { label: status, className: 'badge-gray' };
};

export const statusDespesa = (status) => {
  const map = {
    pago: { label: 'Pago', className: 'badge-success' },
    pendente: { label: 'Pendente', className: 'badge-warning' },
    atrasado: { label: 'Vencido', className: 'badge-danger' },
    parcial: { label: 'Parcial', className: 'badge-info' }
  };
  return map[status] || { label: status, className: 'badge-gray' };
};

export const statusReajuste = (status) => {
  const map = {
    pendente: { label: 'Pendente', className: 'badge-warning' },
    avisado: { label: 'Avisado', className: 'badge-info' },
    aplicado: { label: 'Aplicado', className: 'badge-success' }
  };
  return map[status] || { label: status, className: 'badge-gray' };
};

export const tipoImovel = (tipo) => {
  const map = {
    casa: 'Casa', apartamento: 'Apartamento', comercial: 'Comercial',
    terreno: 'Terreno', galpao: 'Galpão'
  };
  return map[tipo] || tipo;
};

export const garantiaLabel = (g) => {
  const map = {
    caucao: 'Caução', fiador: 'Fiador', seguro: 'Seguro Fiança',
    sem: 'Sem Garantia', outro: 'Outro'
  };
  return map[g] || g;
};

export const formaPagamentoLabel = (f) => {
  const map = {
    dinheiro: 'Dinheiro', pix: 'PIX', transferencia: 'Transferência',
    boleto: 'Boleto', cartao: 'Cartão'
  };
  return map[f] || f;
};

export const tipoDespesaLabel = (t) => {
  const map = {
    iptu: 'IPTU', condominio: 'Condomínio', agua: 'Água', energia: 'Energia',
    manutencao: 'Manutenção', seguro: 'Seguro', outros: 'Outros'
  };
  return map[t] || t;
};

export const getMesAtual = () => new Date().getMonth() + 1;
export const getAnoAtual = () => new Date().getFullYear();
