import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('usuario');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// ===== AUTH =====
export const authService = {
  login: (email, senha) => api.post('/auth/login', { email, senha }),
  verify: () => api.get('/auth/verify')
};

// ===== USUÁRIOS =====
export const usuariosService = {
  listar: () => api.get('/usuarios'),
  criar: (dados) => api.post('/usuarios', dados),
  atualizar: (id, dados) => api.put(`/usuarios/${id}`, dados),
  excluir: (id) => api.delete(`/usuarios/${id}`)
};

// ===== IMÓVEIS =====
export const imoveisService = {
  listar: (params) => api.get('/imoveis', { params }),
  buscarPorId: (id) => api.get(`/imoveis/${id}`),
  criar: (dados) => api.post('/imoveis', dados),
  // Cadastro completo (imóvel + inquilino + contrato) atômico no backend
  cadastroCompleto: (dados) => api.post('/imoveis/cadastro-completo', dados),
  // Alugar um imóvel vago existente (cria inquilino + contrato, atômico)
  alugar: (id, dados) => api.post(`/imoveis/${id}/alugar`, dados),
  atualizar: (id, dados) => api.put(`/imoveis/${id}`, dados),
  excluir: (id) => api.delete(`/imoveis/${id}`),
  historico: (id) => api.get(`/imoveis/${id}/historico`),
  fichaPdf: (id) => api.get(`/imoveis/${id}/ficha/pdf`, { responseType: 'blob' })
};

// ===== INQUILINOS =====
export const inquilinosService = {
  listar: (params) => api.get('/inquilinos', { params }),
  buscarPorId: (id) => api.get(`/inquilinos/${id}`),
  criar: (dados) => api.post('/inquilinos', dados),
  atualizar: (id, dados) => api.put(`/inquilinos/${id}`, dados),
  excluir: (id) => api.delete(`/inquilinos/${id}`)
};

// ===== CONTRATOS =====
export const contratosService = {
  listar: (params) => api.get('/contratos', { params }),
  buscarPorId: (id) => api.get(`/contratos/${id}`),
  criar: (dados) => api.post('/contratos', dados, { headers: { 'Content-Type': 'multipart/form-data' } }),
  atualizar: (id, dados) => api.put(`/contratos/${id}`, dados, { headers: { 'Content-Type': 'multipart/form-data' } }),
  renovar: (id, dados) => api.post(`/contratos/${id}/renovar`, dados),
  reajustar: (id, dados) => api.post(`/contratos/${id}/reajustar`, dados),
  excluir: (id) => api.delete(`/contratos/${id}`),
  // A rota /uploads é protegida por JWT — precisa ir via axios (com header Authorization),
  // não dá para abrir direto num <a href>, que não envia o token.
  baixarArquivo: (filename) => api.get(`/uploads/${filename}`, { responseType: 'blob' })
};

// ===== PAGAMENTOS =====
export const pagamentosService = {
  listar: (params) => api.get('/pagamentos', { params }),
  criar: (dados) => api.post('/pagamentos', dados),
  gerarParcelas: (mes, ano) => api.post('/pagamentos/gerar-parcelas', { mes, ano }),
  atualizar: (id, dados) => api.put(`/pagamentos/${id}`, dados),
  pagar: (id, dados) => api.post(`/pagamentos/${id}/pagar`, dados),
  reabrir: (id) => api.post(`/pagamentos/${id}/reabrir`),
  excluir: (id) => api.delete(`/pagamentos/${id}`),
  recibo: (id) => api.get(`/pagamentos/${id}/recibo`, { responseType: 'blob' }),
  reciboPremium: (id, params) => api.get(`/pagamentos/${id}/recibo-premium`, { params, responseType: 'blob' }),
  recibosLote: (params) => api.get('/pagamentos/recibos-lote', { params, responseType: 'blob' })
};

// ===== DESPESAS / CONTAS A PAGAR =====
export const despesasService = {
  listar: (params) => api.get('/despesas', { params }),
  criar: (dados) => api.post('/despesas', dados),
  atualizar: (id, dados) => api.put(`/despesas/${id}`, dados),
  excluir: (id, params) => api.delete(`/despesas/${id}`, { params }),
  pagar: (id, dados) => api.post(`/despesas/${id}/pagar`, dados),
  reabrir: (id) => api.post(`/despesas/${id}/reabrir`),
  exportar: (formato, params) => api.get(`/despesas/exportar/${formato}`, { params, responseType: 'blob' })
};

// ===== CATEGORIAS DE CONTAS A PAGAR =====
export const despesaTiposService = {
  listar: () => api.get('/despesa-tipos'),
  criar: (nome) => api.post('/despesa-tipos', { nome }),
  atualizar: (id, nome) => api.put(`/despesa-tipos/${id}`, { nome }),
  excluir: (id) => api.delete(`/despesa-tipos/${id}`)
};

// ===== REAJUSTES =====
export const reajustesService = {
  listar: (params) => api.get('/reajustes', { params }),
  criar: (dados) => api.post('/reajustes', dados),
  atualizar: (id, dados) => api.put(`/reajustes/${id}`, dados),
  excluir: (id) => api.delete(`/reajustes/${id}`)
};

// ===== RECIBOS =====
export const recibosService = {
  listar: () => api.get('/recibos'),
  proximoNumero: () => api.get('/recibos/proximo-numero'),
  criar: (dados) => api.post('/recibos', dados),
  excluir: (id) => api.delete(`/recibos/${id}`),
  pdf: (id) => api.get(`/recibos/${id}/pdf`, { responseType: 'blob' }),
  uploadLogo: (file) => {
    const fd = new FormData();
    fd.append('logo', file);
    return api.post('/recibos/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  // Recebedores
  listarRecebedores: () => api.get('/recibos/recebedores'),
  criarRecebedor: (dados) => api.post('/recibos/recebedores', dados),
  atualizarRecebedor: (id, dados) => api.put(`/recibos/recebedores/${id}`, dados),
  excluirRecebedor: (id) => api.delete(`/recibos/recebedores/${id}`),
  // Pagadores
  listarPagadores: () => api.get('/recibos/pagadores'),
  criarPagador: (dados) => api.post('/recibos/pagadores', dados),
  atualizarPagador: (id, dados) => api.put(`/recibos/pagadores/${id}`, dados),
  excluirPagador: (id) => api.delete(`/recibos/pagadores/${id}`)
};

// ===== AGENDA (eventos manuais) =====
export const agendaService = {
  listar: () => api.get('/agenda-eventos'),
  criar: (dados) => api.post('/agenda-eventos', dados),
  atualizar: (id, dados) => api.put(`/agenda-eventos/${id}`, dados),
  excluir: (id) => api.delete(`/agenda-eventos/${id}`)
};

// ===== DASHBOARD =====
export const dashboardService = {
  stats: () => api.get('/dashboard/stats'),
  evolucao: () => api.get('/dashboard/evolucao')
};

// ===== RELATÓRIOS =====
export const relatoriosService = {
  mensal: (params) => api.get('/relatorios/mensal', { params }),
  inadimplencia: () => api.get('/relatorios/inadimplencia'),
  inadimplenciaConsolidada: () => api.get('/relatorios/inadimplencia/consolidada'),
  imoveisVagos: () => api.get('/relatorios/imoveis-vagos'),
  contratosVencendo: (params) => api.get('/relatorios/contratos-vencendo', { params }),
  despesas: (params) => api.get('/relatorios/despesas', { params }),
  exportarExcel: (params) => api.get('/relatorios/exportar/excel', { params, responseType: 'blob' }),
  exportarPdf: (params) => api.get('/relatorios/exportar/pdf', { params, responseType: 'blob' }),
  fichasImoveisLista: () => api.get('/relatorios/imoveis/fichas-lista/pdf', { responseType: 'blob' })
};

export const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};
