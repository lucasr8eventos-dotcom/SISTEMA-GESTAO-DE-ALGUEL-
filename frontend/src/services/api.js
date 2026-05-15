import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '/api',
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
  atualizar: (id, dados) => api.put(`/imoveis/${id}`, dados),
  excluir: (id) => api.delete(`/imoveis/${id}`),
  historico: (id) => api.get(`/imoveis/${id}/historico`)
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
  excluir: (id) => api.delete(`/contratos/${id}`)
};

// ===== PAGAMENTOS =====
export const pagamentosService = {
  listar: (params) => api.get('/pagamentos', { params }),
  criar: (dados) => api.post('/pagamentos', dados),
  atualizar: (id, dados) => api.put(`/pagamentos/${id}`, dados),
  excluir: (id) => api.delete(`/pagamentos/${id}`),
  recibo: (id) => api.get(`/pagamentos/${id}/recibo`, { responseType: 'blob' })
};

// ===== DESPESAS =====
export const despesasService = {
  listar: (params) => api.get('/despesas', { params }),
  criar: (dados) => api.post('/despesas', dados),
  atualizar: (id, dados) => api.put(`/despesas/${id}`, dados),
  excluir: (id) => api.delete(`/despesas/${id}`)
};

// ===== REAJUSTES =====
export const reajustesService = {
  listar: (params) => api.get('/reajustes', { params }),
  criar: (dados) => api.post('/reajustes', dados),
  atualizar: (id, dados) => api.put(`/reajustes/${id}`, dados),
  excluir: (id) => api.delete(`/reajustes/${id}`)
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
  imoveisVagos: () => api.get('/relatorios/imoveis-vagos'),
  contratosVencendo: (params) => api.get('/relatorios/contratos-vencendo', { params }),
  despesas: (params) => api.get('/relatorios/despesas', { params }),
  exportarExcel: (params) => api.get('/relatorios/exportar/excel', { params, responseType: 'blob' }),
  exportarPdf: (params) => api.get('/relatorios/exportar/pdf', { params, responseType: 'blob' })
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
