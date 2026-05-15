import React, { useState, useEffect, useCallback } from 'react';
import { contratosService, imoveisService, inquilinosService } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { formatMoeda, formatData, statusContrato, garantiaLabel } from '../../utils/format';

const FORM_INICIAL = {
  imovel_id: '', inquilino_id: '', data_inicio: '', data_fim: '',
  valor: '', garantia: 'fiador', status: 'ativo', observacoes: '', arquivo_pdf: null
};

export default function Contratos() {
  const [contratos, setContratos] = useState([]);
  const [imoveis, setImoveis] = useState([]);
  const [inquilinos, setInquilinos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const toast = useToast();
  const { isAdmin } = useAuth();

  const fetchContratos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await contratosService.listar({ status: filtroStatus || undefined });
      setContratos(res.data);
    } catch {
      toast.error('Erro ao carregar contratos');
    } finally {
      setLoading(false);
    }
  }, [filtroStatus]);

  useEffect(() => { fetchContratos(); }, [fetchContratos]);

  useEffect(() => {
    Promise.all([
      imoveisService.listar(),
      inquilinosService.listar()
    ]).then(([imRes, inqRes]) => {
      setImoveis(imRes.data);
      setInquilinos(inqRes.data);
    }).catch(() => {});
  }, []);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setModalAberto(true);
  };

  const abrirEditar = (c) => {
    setEditando(c.id);
    setForm({
      imovel_id: c.imovel_id || '',
      inquilino_id: c.inquilino_id || '',
      data_inicio: c.data_inicio ? c.data_inicio.split('T')[0] : '',
      data_fim: c.data_fim ? c.data_fim.split('T')[0] : '',
      valor: c.valor || '',
      garantia: c.garantia || 'fiador',
      status: c.status || 'ativo',
      observacoes: c.observacoes || '',
      arquivo_pdf: null
    });
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    if (form.data_fim && form.data_inicio && form.data_fim <= form.data_inicio) {
      toast.error('A data de fim deve ser posterior à data de início');
      return;
    }
    setSalvando(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') fd.append(k, v);
      });

      if (editando) {
        await contratosService.atualizar(editando, fd);
        toast.success('Contrato atualizado com sucesso!');
      } else {
        await contratosService.criar(fd);
        toast.success('Contrato criado com sucesso!');
      }
      setModalAberto(false);
      fetchContratos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar contrato');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async () => {
    try {
      await contratosService.excluir(confirmExcluir.id);
      toast.success('Contrato excluído!');
      setConfirmExcluir(null);
      fetchContratos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir contrato');
    }
  };

  const setF = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));

  const getAlertaVencimento = (dias) => {
    if (dias <= 0) return <span className="badge badge-danger">Vencido</span>;
    if (dias <= 7) return <span className="badge badge-danger">Vence em {dias}d</span>;
    if (dias <= 30) return <span className="badge badge-warning">Vence em {dias}d</span>;
    return null;
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Contratos</h1>
          <p>{contratos.length} contrato(s)</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNovo}>+ Novo Contrato</button>
      </div>

      <div className="filters-row">
        <select className="form-control filter-select" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="ativo">Ativo</option>
          <option value="vencido">Vencido</option>
          <option value="encerrado">Encerrado</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : contratos.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>Nenhum contrato encontrado</h3>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Inquilino</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Valor</th>
                  <th>Garantia</th>
                  <th>Status</th>
                  <th>Vencimento</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {contratos.map((c) => {
                  const st = statusContrato(c.status);
                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.imovel_codigo}</strong>
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{c.imovel_endereco}</div>
                      </td>
                      <td>
                        <strong>{c.inquilino_nome}</strong>
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{c.inquilino_telefone}</div>
                      </td>
                      <td>{formatData(c.data_inicio)}</td>
                      <td>{formatData(c.data_fim)}</td>
                      <td>{formatMoeda(c.valor)}</td>
                      <td>{garantiaLabel(c.garantia)}</td>
                      <td><span className={`badge ${st.className}`}>{st.label}</span></td>
                      <td>{c.status === 'ativo' && getAlertaVencimento(c.dias_para_vencer)}</td>
                      <td>
                        <div className="table-actions">
                          {c.arquivo_pdf && (
                            <a
                              href={`/uploads/${c.arquivo_pdf}`}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Ver PDF"
                            >📎</a>
                          )}
                          <button className="btn btn-ghost btn-sm btn-icon" title="Editar" onClick={() => abrirEditar(c)}>✏️</button>
                          {isAdmin && (
                            <button className="btn btn-outline-danger btn-sm btn-icon" title="Excluir" onClick={() => setConfirmExcluir(c)}>🗑</button>
                          )}
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
        title={editando ? 'Editar Contrato' : 'Novo Contrato'}
        size="lg"
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
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Imóvel <span className="required">*</span></label>
              <select className="form-control" value={form.imovel_id} onChange={(e) => setF('imovel_id', e.target.value)} required>
                <option value="">Selecione...</option>
                {imoveis.map(im => {
                  const statusLabel = { vago: '🟢 Vago', alugado: '🔴 Alugado', negociacao: '🟡 Negociação', encerrado: '⚫ Encerrado' };
                  return (
                    <option key={im.id} value={im.id}>
                      {im.codigo} — {im.endereco} [{statusLabel[im.status] || im.status}]
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Inquilino <span className="required">*</span></label>
              <select className="form-control" value={form.inquilino_id} onChange={(e) => setF('inquilino_id', e.target.value)} required>
                <option value="">Selecione...</option>
                {inquilinos.map(inq => (
                  <option key={inq.id} value={inq.id}>{inq.nome}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Data de Início <span className="required">*</span></label>
              <input className="form-control" type="date" value={form.data_inicio} onChange={(e) => setF('data_inicio', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Data de Fim <span className="required">*</span></label>
              <input className="form-control" type="date" value={form.data_fim} onChange={(e) => setF('data_fim', e.target.value)} required />
            </div>
          </div>

          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Valor do Aluguel <span className="required">*</span></label>
              <input className="form-control" type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setF('valor', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Garantia <span className="required">*</span></label>
              <select className="form-control" value={form.garantia} onChange={(e) => setF('garantia', e.target.value)} required>
                <option value="fiador">Fiador</option>
                <option value="caucao">Caução</option>
                <option value="seguro">Seguro Fiança</option>
                <option value="sem">Sem Garantia</option>
                <option value="outro">Outro</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Status <span className="required">*</span></label>
              <select className="form-control" value={form.status} onChange={(e) => setF('status', e.target.value)} required>
                <option value="ativo">Ativo</option>
                <option value="vencido">Vencido</option>
                <option value="encerrado">Encerrado</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Anexo do Contrato (PDF)</label>
            <input
              className="form-control"
              type="file"
              accept=".pdf"
              onChange={(e) => setF('arquivo_pdf', e.target.files[0])}
            />
            <div className="form-hint">Máximo 10MB. Formato PDF.</div>
          </div>

          <div className="form-group">
            <label className="form-label">Observações</label>
            <textarea className="form-control" value={form.observacoes} onChange={(e) => setF('observacoes', e.target.value)} rows={3} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmExcluir}
        onClose={() => setConfirmExcluir(null)}
        onConfirm={handleExcluir}
        title="Excluir Contrato"
        message="Tem certeza que deseja excluir este contrato?"
      />
    </div>
  );
}
