import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { imoveisService } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { MoneyInput } from '../../components/MaskedInput';
import { formatMoeda, formatData, statusImovel, tipoImovel } from '../../utils/format';
import Pagination, { PER_PAGE } from '../../components/Pagination';

const FORM_INICIAL = {
  codigo: '', tipo: 'apartamento', endereco: '', valor_sem_desconto: '', valor_com_desconto: '',
  dia_vencimento: '', status: 'vago', numero_iptu: '', matricula: '', conta_agua: '',
  conta_energia: '', observacoes: ''
};

export default function Imoveis() {
  const [imoveis, setImoveis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [page, setPage] = useState(1);
  const [historicoModal, setHistoricoModal] = useState(null);
  const [historico, setHistorico] = useState([]);
  const toast = useToast();
  const { isAdmin } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const s = params.get('status');
    if (s) setFiltroStatus(s);
  }, [location.search]);

  const fetchImoveis = useCallback(async () => {
    setLoading(true);
    try {
      const res = await imoveisService.listar({ busca: busca || undefined, status: filtroStatus || undefined });
      setImoveis(res.data);
    } catch {
      toast.error('Erro ao carregar imóveis');
    } finally {
      setLoading(false);
    }
  }, [busca, filtroStatus]);

  useEffect(() => {
    const t = setTimeout(fetchImoveis, 300);
    return () => clearTimeout(t);
  }, [fetchImoveis]);

  useEffect(() => { setPage(1); }, [busca, filtroStatus]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setModalAberto(true);
  };

  const abrirEditar = (imovel) => {
    setEditando(imovel.id);
    setForm({
      codigo: imovel.codigo || '',
      tipo: imovel.tipo || 'apartamento',
      endereco: imovel.endereco || '',
      valor_sem_desconto: imovel.valor_sem_desconto || '',
      valor_com_desconto: imovel.valor_com_desconto || '',
      dia_vencimento: imovel.dia_vencimento || '',
      status: imovel.status || 'vago',
      numero_iptu: imovel.numero_iptu || '',
      matricula: imovel.matricula || '',
      conta_agua: imovel.conta_agua || '',
      conta_energia: imovel.conta_energia || '',
      observacoes: imovel.observacoes || ''
    });
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    if (
      form.valor_com_desconto &&
      form.valor_sem_desconto &&
      parseFloat(form.valor_com_desconto) > parseFloat(form.valor_sem_desconto)
    ) {
      toast.error('O valor com desconto não pode ser maior que o valor sem desconto');
      return;
    }
    setSalvando(true);
    try {
      if (editando) {
        await imoveisService.atualizar(editando, form);
        toast.success('Imóvel atualizado com sucesso!');
      } else {
        await imoveisService.criar(form);
        toast.success('Imóvel cadastrado com sucesso!');
      }
      setModalAberto(false);
      fetchImoveis();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar imóvel');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async () => {
    try {
      await imoveisService.excluir(confirmExcluir.id);
      toast.success('Imóvel excluído com sucesso!');
      setConfirmExcluir(null);
      fetchImoveis();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir imóvel');
    }
  };

  const verHistorico = async (imovel) => {
    setHistoricoModal(imovel);
    try {
      const res = await imoveisService.historico(imovel.id);
      setHistorico(res.data);
    } catch {
      setHistorico([]);
    }
  };

  const f = form;
  const setF = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));

  const paginatedImoveis = imoveis.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Imóveis</h1>
          <p>{imoveis.length} imóvel(is) encontrado(s)</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNovo}>
          + Novo Imóvel
        </button>
      </div>

      <div className="filters-row">
        <div className="search-input-wrap">
          <span className="search-icon">🔍</span>
          <input
            className="form-control"
            placeholder="Buscar por código ou endereço..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <select className="form-control filter-select" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="alugado">Alugado</option>
          <option value="vago">Vago</option>
          <option value="negociacao">Em Negociação</option>
          <option value="encerrado">Encerrado</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : imoveis.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🏠</div>
              <h3>Nenhum imóvel encontrado</h3>
              <p>Cadastre um novo imóvel para começar</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Tipo</th>
                  <th>Endereço</th>
                  <th>Valor (c/ desc.)</th>
                  <th>Valor (s/ desc.)</th>
                  <th>Venc.</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginatedImoveis.map((im) => {
                  const st = statusImovel(im.status);
                  return (
                    <tr key={im.id}>
                      <td><strong>{im.codigo}</strong></td>
                      <td>{tipoImovel(im.tipo)}</td>
                      <td style={{ maxWidth: 260 }}>{im.endereco}</td>
                      <td>{im.valor_com_desconto ? formatMoeda(im.valor_com_desconto) : '—'}</td>
                      <td>{formatMoeda(im.valor_sem_desconto)}</td>
                      <td>Dia {im.dia_vencimento}</td>
                      <td><span className={`badge ${st.className}`}>{st.label}</span></td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" title="Histórico" onClick={() => verHistorico(im)}>📜</button>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Editar" onClick={() => abrirEditar(im)}>✏️</button>
                          {isAdmin && (
                            <button className="btn btn-outline-danger btn-sm btn-icon" title="Excluir" onClick={() => setConfirmExcluir(im)}>🗑</button>
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
        <Pagination total={imoveis.length} page={page} perPage={PER_PAGE} onChange={setPage} />
      </div>

      {/* Modal Formulário */}
      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? 'Editar Imóvel' : 'Novo Imóvel'}
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
              <label className="form-label">Código <span className="required">*</span></label>
              <input className="form-control" value={f.codigo} onChange={(e) => setF('codigo', e.target.value)} required placeholder="Ex: IM001" />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo <span className="required">*</span></label>
              <select className="form-control" value={f.tipo} onChange={(e) => setF('tipo', e.target.value)} required>
                <option value="apartamento">Apartamento</option>
                <option value="casa">Casa</option>
                <option value="comercial">Comercial</option>
                <option value="terreno">Terreno</option>
                <option value="galpao">Galpão</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Endereço Completo <span className="required">*</span></label>
            <input className="form-control" value={f.endereco} onChange={(e) => setF('endereco', e.target.value)} required placeholder="Rua, número, complemento, bairro, cidade" />
          </div>

          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Valor s/ Desconto <span className="required">*</span></label>
              <MoneyInput value={f.valor_sem_desconto} onChange={(v) => setF('valor_sem_desconto', v)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Valor c/ Desconto</label>
              <MoneyInput value={f.valor_com_desconto} onChange={(v) => setF('valor_com_desconto', v)} />
            </div>
            <div className="form-group">
              <label className="form-label">Dia de Vencimento <span className="required">*</span></label>
              <input className="form-control" type="number" min="1" max="31" value={f.dia_vencimento} onChange={(e) => setF('dia_vencimento', e.target.value)} required />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Status <span className="required">*</span></label>
              <select className="form-control" value={f.status} onChange={(e) => setF('status', e.target.value)} required>
                <option value="vago">Vago</option>
                <option value="alugado">Alugado</option>
                <option value="negociacao">Em Negociação</option>
                <option value="encerrado">Encerrado</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Nº IPTU</label>
              <input className="form-control" value={f.numero_iptu} onChange={(e) => setF('numero_iptu', e.target.value)} />
            </div>
          </div>

          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Matrícula</label>
              <input className="form-control" value={f.matricula} onChange={(e) => setF('matricula', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Conta de Água</label>
              <input className="form-control" value={f.conta_agua} onChange={(e) => setF('conta_agua', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Conta de Energia</label>
              <input className="form-control" value={f.conta_energia} onChange={(e) => setF('conta_energia', e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Observações</label>
            <textarea className="form-control" value={f.observacoes} onChange={(e) => setF('observacoes', e.target.value)} rows={3} />
          </div>
        </form>
      </Modal>

      {/* Modal Histórico */}
      <Modal
        isOpen={!!historicoModal}
        onClose={() => setHistoricoModal(null)}
        title={`Histórico — ${historicoModal?.codigo}`}
        size="lg"
      >
        {historico.length === 0 ? (
          <div className="empty-state"><p>Nenhum pagamento registrado</p></div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Mês/Ano</th>
                  <th>Inquilino</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Pagamento</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((p) => (
                  <tr key={p.id}>
                    <td>{p.mes}/{p.ano}</td>
                    <td>{p.inquilino_nome || '—'}</td>
                    <td>{formatMoeda(p.valor_aluguel)}</td>
                    <td>{formatData(p.data_vencimento)}</td>
                    <td>{formatData(p.data_pagamento)}</td>
                    <td>
                      <span className={`badge badge-${p.status === 'pago' ? 'success' : p.status === 'atrasado' ? 'danger' : p.status === 'parcial' ? 'info' : 'warning'}`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmExcluir}
        onClose={() => setConfirmExcluir(null)}
        onConfirm={handleExcluir}
        title="Excluir Imóvel"
        message={`Tem certeza que deseja excluir o imóvel "${confirmExcluir?.codigo}"? Esta ação não pode ser desfeita.`}
      />
    </div>
  );
}
