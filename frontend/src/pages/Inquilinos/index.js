import React, { useState, useEffect, useCallback } from 'react';
import { inquilinosService } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { CpfCnpjInput, PhoneInput } from '../../components/MaskedInput';
import { formatCpfCnpj, formatTelefone } from '../../utils/format';
import { maskCpfCnpj, maskPhone } from '../../utils/masks';
import Pagination, { PER_PAGE } from '../../components/Pagination';
import { Pencil, Trash2, Search, Users } from 'lucide-react';

const FORM_INICIAL = { nome: '', cpf_cnpj: '', telefone: '', email: '', endereco: '', observacoes: '' };

export default function Inquilinos() {
  const [inquilinos, setInquilinos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [page, setPage] = useState(1);
  const toast = useToast();
  const { isAdmin } = useAuth();

  const fetchInquilinos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inquilinosService.listar({ busca: busca || undefined });
      setInquilinos(res.data);
    } catch {
      toast.error('Erro ao carregar inquilinos');
    } finally {
      setLoading(false);
    }
  }, [busca]);

  useEffect(() => {
    const t = setTimeout(fetchInquilinos, 300);
    return () => clearTimeout(t);
  }, [fetchInquilinos]);

  useEffect(() => { setPage(1); }, [busca]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_INICIAL);
    setModalAberto(true);
  };

  const abrirEditar = (inq) => {
    setEditando(inq.id);
    setForm({
      nome: inq.nome || '',
      cpf_cnpj: maskCpfCnpj(inq.cpf_cnpj || ''),
      telefone: maskPhone(inq.telefone || ''),
      email: inq.email || '',
      endereco: inq.endereco || '',
      observacoes: inq.observacoes || ''
    });
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      if (editando) {
        await inquilinosService.atualizar(editando, form);
        toast.success('Inquilino atualizado com sucesso!');
      } else {
        await inquilinosService.criar(form);
        toast.success('Inquilino cadastrado com sucesso!');
      }
      setModalAberto(false);
      fetchInquilinos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar inquilino');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async () => {
    try {
      await inquilinosService.excluir(confirmExcluir.id);
      toast.success('Inquilino excluído com sucesso!');
      setConfirmExcluir(null);
      fetchInquilinos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir inquilino');
    }
  };

  const setF = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));

  const paginatedInquilinos = inquilinos.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Inquilinos</h1>
          <p>{inquilinos.length} inquilino(s) encontrado(s)</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNovo}>+ Novo Inquilino</button>
      </div>

      <div className="filters-row">
        <div className="search-input-wrap">
          <span className="search-icon"><Search size={16} /></span>
          <input
            className="form-control"
            placeholder="Buscar por nome, CPF/CNPJ ou e-mail..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : inquilinos.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Users size={48} /></div>
              <h3>Nenhum inquilino encontrado</h3>
              <p>Cadastre um novo inquilino para começar</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>CPF / CNPJ</th>
                  <th>Telefone</th>
                  <th>E-mail</th>
                  <th>Endereço</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginatedInquilinos.map((inq) => (
                  <tr key={inq.id}>
                    <td><strong>{inq.nome}</strong></td>
                    <td>{formatCpfCnpj(inq.cpf_cnpj)}</td>
                    <td>{formatTelefone(inq.telefone)}</td>
                    <td>{inq.email || '—'}</td>
                    <td style={{ maxWidth: 200 }}>{inq.endereco || '—'}</td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn-ghost btn-sm btn-icon" title="Editar" onClick={() => abrirEditar(inq)}><Pencil size={14} /></button>
                        {isAdmin && (
                          <button className="btn btn-outline-danger btn-sm btn-icon" title="Excluir" onClick={() => setConfirmExcluir(inq)}><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination total={inquilinos.length} page={page} perPage={PER_PAGE} onChange={setPage} />
      </div>

      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? 'Editar Inquilino' : 'Novo Inquilino'}
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
          <div className="form-group">
            <label className="form-label">Nome completo <span className="required">*</span></label>
            <input className="form-control" value={form.nome} onChange={(e) => setF('nome', e.target.value)} required />
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">CPF / CNPJ <span className="required">*</span></label>
              <CpfCnpjInput value={form.cpf_cnpj} onChange={(v) => setF('cpf_cnpj', v)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Telefone <span className="required">*</span></label>
              <PhoneInput value={form.telefone} onChange={(v) => setF('telefone', v)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">E-mail</label>
            <input className="form-control" type="email" value={form.email} onChange={(e) => setF('email', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Endereço</label>
            <input className="form-control" value={form.endereco} onChange={(e) => setF('endereco', e.target.value)} />
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
        title="Excluir Inquilino"
        message={`Tem certeza que deseja excluir o inquilino "${confirmExcluir?.nome}"?`}
      />
    </div>
  );
}
