import React, { useState, useEffect } from 'react';
import { usuariosService } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { formatDataHora } from '../../utils/format';
import { Pencil, Trash2, Eye, EyeOff, Power } from 'lucide-react';

const FORM_INICIAL = { nome: '', email: '', senha: '', confirmaSenha: '', perfil: 'operador', status: 'ativo' };

const PERFIL_DESC = {
  admin: 'Administrador: acesso total — gerencia usuários, exclui registros e acessa todas as áreas.',
  operador: 'Operador: cadastra e gerencia imóveis, contratos, pagamentos e despesas. Não acessa Usuários nem exclui registros.'
};

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const toast = useToast();
  const { usuario: usuarioLogado } = useAuth();

  const fetchUsuarios = async () => {
    setLoading(true);
    try {
      const res = await usuariosService.listar();
      setUsuarios(res.data);
    } catch {
      toast.error('Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsuarios(); }, []);

  const abrirNovo = () => {
    setEditando(null);
    setMostrarSenha(false);
    setForm(FORM_INICIAL);
    setModalAberto(true);
  };

  const abrirEditar = (u) => {
    setEditando(u.id);
    setMostrarSenha(false);
    setForm({ nome: u.nome || '', email: u.email || '', senha: '', confirmaSenha: '', perfil: u.perfil || 'operador', status: u.status || 'ativo' });
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    if (!editando && !form.senha) {
      toast.error('Informe uma senha');
      return;
    }
    if (form.senha && form.senha.length < 6) {
      toast.error('A senha deve ter ao menos 6 caracteres');
      return;
    }
    if (form.senha && form.senha !== form.confirmaSenha) {
      toast.error('As senhas não conferem');
      return;
    }
    setSalvando(true);
    try {
      const dados = { ...form };
      delete dados.confirmaSenha;
      if (!dados.senha) delete dados.senha;

      if (editando) {
        await usuariosService.atualizar(editando, dados);
        toast.success('Usuário atualizado!');
      } else {
        await usuariosService.criar(dados);
        toast.success('Usuário criado!');
      }
      setModalAberto(false);
      fetchUsuarios();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar usuário');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async () => {
    try {
      await usuariosService.excluir(confirmExcluir.id);
      toast.success('Usuário excluído!');
      setConfirmExcluir(null);
      fetchUsuarios();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  const alternarStatus = async (u) => {
    const novo = u.status === 'ativo' ? 'inativo' : 'ativo';
    try {
      await usuariosService.atualizar(u.id, { nome: u.nome, email: u.email, perfil: u.perfil, status: novo });
      toast.success(novo === 'ativo' ? 'Usuário reativado!' : 'Usuário desativado!');
      fetchUsuarios();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao alterar status');
    }
  };

  const setF = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Usuários</h1>
          <p>{usuarios.length} usuário(s) no sistema</p>
        </div>
        <button className="btn btn-primary" onClick={abrirNovo}>+ Novo Usuário</button>
      </div>

      <div className="card">
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th>Cadastrado em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.nome}</strong>
                      {u.id === usuarioLogado?.id && (
                        <span className="badge badge-primary" style={{ marginLeft: 8, fontSize: 11 }}>Você</span>
                      )}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`badge ${u.perfil === 'admin' ? 'badge-primary' : 'badge-gray'}`}>
                        {u.perfil === 'admin' ? 'Administrador' : 'Operador'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.status === 'ativo' ? 'badge-success' : 'badge-gray'}`}>
                        {u.status === 'ativo' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>{formatDataHora(u.created_at)}</td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn-ghost btn-sm btn-icon" title="Editar" onClick={() => abrirEditar(u)}><Pencil size={14} /></button>
                        {u.id !== usuarioLogado?.id && (
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            title={u.status === 'ativo' ? 'Desativar (recomendado)' : 'Reativar'}
                            onClick={() => alternarStatus(u)}
                          ><Power size={14} color={u.status === 'ativo' ? 'var(--warning)' : 'var(--success)'} /></button>
                        )}
                        {u.id !== usuarioLogado?.id && (
                          <button className="btn btn-outline-danger btn-sm btn-icon" title="Excluir" onClick={() => setConfirmExcluir(u)}><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? 'Editar Usuário' : 'Novo Usuário'}
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
            <label className="form-label">Nome <span className="required">*</span></label>
            <input className="form-control" value={form.nome} onChange={(e) => setF('nome', e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">E-mail <span className="required">*</span></label>
            <input className="form-control" type="email" value={form.email} onChange={(e) => setF('email', e.target.value)} required />
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">
                Senha {!editando && <span className="required">*</span>}
                {editando && <span className="form-hint" style={{ display: 'inline', marginLeft: 6 }}>(em branco = não alterar)</span>}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-control"
                  type={mostrarSenha ? 'text' : 'password'}
                  value={form.senha}
                  onChange={(e) => setF('senha', e.target.value)}
                  minLength={6}
                  style={{ paddingRight: 38 }}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  title={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', padding: 0, lineHeight: 0 }}
                >
                  {mostrarSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">
                Confirmar senha {!editando && <span className="required">*</span>}
              </label>
              <input
                className="form-control"
                type={mostrarSenha ? 'text' : 'password'}
                value={form.confirmaSenha}
                onChange={(e) => setF('confirmaSenha', e.target.value)}
                minLength={6}
                autoComplete="new-password"
              />
              {form.confirmaSenha && form.senha !== form.confirmaSenha && (
                <div className="form-hint" style={{ color: 'var(--danger)' }}>As senhas não conferem.</div>
              )}
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Perfil <span className="required">*</span></label>
              <select className="form-control" value={form.perfil} onChange={(e) => setF('perfil', e.target.value)} required>
                <option value="admin">Administrador</option>
                <option value="operador">Operador</option>
              </select>
              <div className="form-hint">{PERFIL_DESC[form.perfil]}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Status <span className="required">*</span></label>
              <select className="form-control" value={form.status} onChange={(e) => setF('status', e.target.value)} required>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmExcluir}
        onClose={() => setConfirmExcluir(null)}
        onConfirm={handleExcluir}
        title="Excluir Usuário"
        message={`Tem certeza que deseja EXCLUIR o usuário "${confirmExcluir?.nome}"? Esta ação é permanente. Para preservar o histórico, prefira desativar o usuário (botão com ícone de energia).`}
      />
    </div>
  );
}
