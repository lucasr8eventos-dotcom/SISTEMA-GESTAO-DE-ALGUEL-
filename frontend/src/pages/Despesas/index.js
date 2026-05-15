import React, { useState, useEffect, useCallback } from 'react';
import { despesasService, imoveisService } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { formatMoeda, formatData, statusDespesa, tipoDespesaLabel, getMesAtual, getAnoAtual, MESES } from '../../utils/format';

const FORM_INICIAL = {
  imovel_id: '', tipo: 'iptu', valor: '', vencimento: '',
  status: 'pendente', descricao: '', observacoes: ''
};

export default function Despesas() {
  const [despesas, setDespesas] = useState([]);
  const [imoveis, setImoveis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroMes, setFiltroMes] = useState('');
  const [filtroAno, setFiltroAno] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const toast = useToast();
  const { isAdmin } = useAuth();

  const fetchDespesas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await despesasService.listar({
        status: filtroStatus || undefined,
        tipo: filtroTipo || undefined,
        mes: filtroMes || undefined,
        ano: filtroAno || undefined
      });
      setDespesas(res.data);
    } catch {
      toast.error('Erro ao carregar despesas');
    } finally {
      setLoading(false);
    }
  }, [filtroStatus, filtroTipo, filtroMes, filtroAno]);

  useEffect(() => { fetchDespesas(); }, [fetchDespesas]);
  useEffect(() => { imoveisService.listar().then(r => setImoveis(r.data)).catch(() => {}); }, []);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setModalAberto(true);
  };

  const abrirEditar = (d) => {
    setEditando(d.id);
    setForm({
      imovel_id: d.imovel_id || '',
      tipo: d.tipo || 'iptu',
      valor: d.valor || '',
      vencimento: d.vencimento ? d.vencimento.split('T')[0] : '',
      status: d.status || 'pendente',
      descricao: d.descricao || '',
      observacoes: d.observacoes || ''
    });
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      if (editando) {
        await despesasService.atualizar(editando, form);
        toast.success('Despesa atualizada!');
      } else {
        await despesasService.criar(form);
        toast.success('Despesa cadastrada!');
      }
      setModalAberto(false);
      fetchDespesas();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar despesa');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async () => {
    try {
      await despesasService.excluir(confirmExcluir.id);
      toast.success('Despesa excluída!');
      setConfirmExcluir(null);
      fetchDespesas();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  const setF = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));

  const totalDespesas = despesas.reduce((s, d) => s + parseFloat(d.valor || 0), 0);
  const totalPago = despesas.filter(d => d.status === 'pago').reduce((s, d) => s + parseFloat(d.valor || 0), 0);
  const anos = Array.from({ length: 5 }, (_, i) => getAnoAtual() - 2 + i);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Despesas</h1>
          <p>{despesas.length} despesa(s) encontrada(s)</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNovo}>+ Nova Despesa</button>
      </div>

      <div className="filters-row">
        <select className="form-control filter-select" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
          <option value="atrasado">Atrasado</option>
        </select>
        <select className="form-control filter-select" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="iptu">IPTU</option>
          <option value="condominio">Condomínio</option>
          <option value="agua">Água</option>
          <option value="energia">Energia</option>
          <option value="manutencao">Manutenção</option>
          <option value="seguro">Seguro</option>
          <option value="outros">Outros</option>
        </select>
        <select className="form-control filter-select" value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)}>
          <option value="">Todos os meses</option>
          {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select className="form-control filter-select" value={filtroAno} onChange={(e) => setFiltroAno(e.target.value)}>
          <option value="">Todos os anos</option>
          {anos.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total', value: formatMoeda(totalDespesas), color: 'var(--info)' },
          { label: 'Pago', value: formatMoeda(totalPago), color: 'var(--success)' },
          { label: 'Pendente', value: formatMoeda(totalDespesas - totalPago), color: 'var(--warning)' }
        ].map(item => (
          <div key={item.label} style={{ background: 'white', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '10px 18px', borderTop: `3px solid ${item.color}` }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: item.color }}>{item.value}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{item.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : despesas.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <h3>Nenhuma despesa encontrada</h3>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Tipo</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {despesas.map((d) => {
                  const st = statusDespesa(d.status);
                  return (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.imovel_codigo}</strong>
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{d.imovel_endereco}</div>
                      </td>
                      <td><span className="chip">{tipoDespesaLabel(d.tipo)}</span></td>
                      <td>{d.descricao || '—'}</td>
                      <td>{formatMoeda(d.valor)}</td>
                      <td>{formatData(d.vencimento)}</td>
                      <td><span className={`badge ${st.className}`}>{st.label}</span></td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => abrirEditar(d)}>✏️</button>
                          {isAdmin && <button className="btn btn-outline-danger btn-sm btn-icon" onClick={() => setConfirmExcluir(d)}>🗑</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? 'Editar Despesa' : 'Nova Despesa'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalAberto(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSalvar} disabled={salvando}>
              {salvando ? '⏳ Salvando...' : '💾 Salvar'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSalvar}>
          <div className="form-group">
            <label className="form-label">Imóvel <span className="required">*</span></label>
            <select className="form-control" value={form.imovel_id} onChange={(e) => setF('imovel_id', e.target.value)} required>
              <option value="">Selecione...</option>
              {imoveis.map(im => <option key={im.id} value={im.id}>{im.codigo} — {im.endereco}</option>)}
            </select>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Tipo <span className="required">*</span></label>
              <select className="form-control" value={form.tipo} onChange={(e) => setF('tipo', e.target.value)} required>
                <option value="iptu">IPTU</option>
                <option value="condominio">Condomínio</option>
                <option value="agua">Água</option>
                <option value="energia">Energia</option>
                <option value="manutencao">Manutenção</option>
                <option value="seguro">Seguro</option>
                <option value="outros">Outros</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Status <span className="required">*</span></label>
              <select className="form-control" value={form.status} onChange={(e) => setF('status', e.target.value)} required>
                <option value="pendente">Pendente</option>
                <option value="pago">Pago</option>
                <option value="atrasado">Atrasado</option>
              </select>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Valor <span className="required">*</span></label>
              <input className="form-control" type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setF('valor', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Vencimento <span className="required">*</span></label>
              <input className="form-control" type="date" value={form.vencimento} onChange={(e) => setF('vencimento', e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Descrição</label>
            <input className="form-control" value={form.descricao} onChange={(e) => setF('descricao', e.target.value)} />
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
        title="Excluir Despesa"
        message="Tem certeza que deseja excluir esta despesa?"
      />
    </div>
  );
}
