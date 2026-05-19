import React, { useState, useEffect, useCallback } from 'react';
import { reajustesService, imoveisService, contratosService } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { MoneyInput } from '../../components/MaskedInput';
import { formatMoeda, formatData, statusReajuste } from '../../utils/format';
import Pagination, { PER_PAGE } from '../../components/Pagination';
import { Pencil, Trash2, TrendingUp } from 'lucide-react';

const FORM_INICIAL = {
  imovel_id: '', contrato_id: '', valor_atual: '', data_ultimo: '', data_proximo: '',
  percentual: '', novo_valor: '', status: 'pendente', observacoes: ''
};

export default function Reajustes() {
  const [reajustes, setReajustes] = useState([]);
  const [imoveis, setImoveis] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [page, setPage] = useState(1);
  const toast = useToast();
  const { isAdmin } = useAuth();

  const fetchReajustes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await reajustesService.listar({ status: filtroStatus || undefined });
      setReajustes(res.data);
    } catch {
      toast.error('Erro ao carregar reajustes');
    } finally {
      setLoading(false);
    }
  }, [filtroStatus]);

  useEffect(() => { fetchReajustes(); }, [fetchReajustes]);

  useEffect(() => { setPage(1); }, [filtroStatus]);

  useEffect(() => {
    Promise.all([imoveisService.listar(), contratosService.listar({ status: 'ativo' })])
      .then(([im, ct]) => { setImoveis(im.data); setContratos(ct.data); })
      .catch(() => {});
  }, []);

  const calcularNovoValor = (valorAtual, percentual) => {
    if (!valorAtual || !percentual) return '';
    const novo = parseFloat(valorAtual) * (1 + parseFloat(percentual) / 100);
    return novo.toFixed(2);
  };

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setModalAberto(true);
  };

  const abrirEditar = (r) => {
    setEditando(r.id);
    setForm({
      imovel_id: r.imovel_id || '',
      contrato_id: r.contrato_id || '',
      valor_atual: r.valor_atual || '',
      data_ultimo: r.data_ultimo ? r.data_ultimo.split('T')[0] : '',
      data_proximo: r.data_proximo ? r.data_proximo.split('T')[0] : '',
      percentual: r.percentual || '',
      novo_valor: r.novo_valor || '',
      status: r.status || 'pendente',
      observacoes: r.observacoes || ''
    });
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      if (editando) {
        await reajustesService.atualizar(editando, form);
        toast.success('Reajuste atualizado!');
      } else {
        await reajustesService.criar(form);
        toast.success('Reajuste cadastrado!');
      }
      setModalAberto(false);
      fetchReajustes();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar reajuste');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async () => {
    try {
      await reajustesService.excluir(confirmExcluir.id);
      toast.success('Reajuste excluído!');
      setConfirmExcluir(null);
      fetchReajustes();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  const paginatedReajustes = reajustes.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const setF = (campo, valor) => {
    setForm(prev => {
      const next = { ...prev, [campo]: valor };
      if (campo === 'valor_atual' || campo === 'percentual') {
        next.novo_valor = calcularNovoValor(
          campo === 'valor_atual' ? valor : prev.valor_atual,
          campo === 'percentual' ? valor : prev.percentual
        );
      }
      return next;
    });
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Reajustes</h1>
          <p>{reajustes.length} reajuste(s)</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNovo}>+ Novo Reajuste</button>
      </div>

      <div className="filters-row">
        <select className="form-control filter-select" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="avisado">Avisado</option>
          <option value="aplicado">Aplicado</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : reajustes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><TrendingUp size={48} /></div>
              <h3>Nenhum reajuste encontrado</h3>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Inquilino</th>
                  <th>Valor Atual</th>
                  <th>Percentual</th>
                  <th>Novo Valor</th>
                  <th>Último Reaj.</th>
                  <th>Próximo Reaj.</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginatedReajustes.map((r) => {
                  const st = statusReajuste(r.status);
                  const diasRestantes = r.data_proximo
                    ? Math.ceil((new Date(r.data_proximo) - new Date()) / 86400000)
                    : null;
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.imovel_codigo}</strong>
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{r.imovel_endereco}</div>
                      </td>
                      <td>{r.inquilino_nome || '—'}</td>
                      <td>{formatMoeda(r.valor_atual)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: 'var(--success-dark)' }}>
                          +{r.percentual}%
                        </span>
                      </td>
                      <td>
                        <strong style={{ color: 'var(--primary)' }}>{formatMoeda(r.novo_valor)}</strong>
                      </td>
                      <td>{formatData(r.data_ultimo)}</td>
                      <td>
                        <div>{formatData(r.data_proximo)}</div>
                        {diasRestantes !== null && diasRestantes <= 30 && diasRestantes > 0 && (
                          <span className="badge badge-warning" style={{ marginTop: 2, fontSize: 11 }}>
                            {diasRestantes}d
                          </span>
                        )}
                        {diasRestantes !== null && diasRestantes <= 0 && r.status !== 'aplicado' && (
                          <span className="badge badge-danger" style={{ marginTop: 2, fontSize: 11 }}>Urgente</span>
                        )}
                      </td>
                      <td><span className={`badge ${st.className}`}>{st.label}</span></td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => abrirEditar(r)}><Pencil size={14} /></button>
                          {isAdmin && <button className="btn btn-outline-danger btn-sm btn-icon" onClick={() => setConfirmExcluir(r)}><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination total={reajustes.length} page={page} perPage={PER_PAGE} onChange={setPage} />
      </div>

      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? 'Editar Reajuste' : 'Novo Reajuste'}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalAberto(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSalvar} disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSalvar}>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Imóvel <span className="required">*</span></label>
              <select className="form-control" value={form.imovel_id} onChange={(e) => setF('imovel_id', e.target.value)} required>
                <option value="">Selecione...</option>
                {imoveis.map(im => <option key={im.id} value={im.id}>{im.codigo} — {im.endereco}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Contrato</label>
              <select className="form-control" value={form.contrato_id} onChange={(e) => setF('contrato_id', e.target.value)}>
                <option value="">Selecione...</option>
                {contratos.map(c => <option key={c.id} value={c.id}>{c.imovel_codigo} — {c.inquilino_nome}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Valor Atual <span className="required">*</span></label>
              <MoneyInput value={form.valor_atual} onChange={(v) => setF('valor_atual', v)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Percentual de Reajuste (%) <span className="required">*</span></label>
              <input className="form-control" type="number" step="0.01" min="0" value={form.percentual} onChange={(e) => setF('percentual', e.target.value)} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Novo Valor Calculado</label>
            <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '9px 13px' }}>
              <strong style={{ color: 'var(--success-dark)', fontSize: 16 }}>
                {form.novo_valor ? formatMoeda(form.novo_valor) : 'Informe valor atual e percentual'}
              </strong>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Último Reajuste</label>
              <input className="form-control" type="date" value={form.data_ultimo} onChange={(e) => setF('data_ultimo', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Próximo Reajuste <span className="required">*</span></label>
              <input className="form-control" type="date" value={form.data_proximo} onChange={(e) => setF('data_proximo', e.target.value)} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Status <span className="required">*</span></label>
            <select className="form-control" value={form.status} onChange={(e) => setF('status', e.target.value)} required>
              <option value="pendente">Pendente</option>
              <option value="avisado">Avisado</option>
              <option value="aplicado">Aplicado</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Observações</label>
            <textarea className="form-control" value={form.observacoes} onChange={(e) => setF('observacoes', e.target.value)} rows={2} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmExcluir}
        onClose={() => setConfirmExcluir(null)}
        onConfirm={handleExcluir}
        title="Excluir Reajuste"
        message="Tem certeza que deseja excluir este reajuste?"
      />
    </div>
  );
}
