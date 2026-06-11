import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { imoveisService, inquilinosService, contratosService } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import Tabs from '../../components/Tabs';
import CadastroCompleto from './CadastroCompleto';
import { MoneyInput, CpfCnpjInput, PhoneInput } from '../../components/MaskedInput';
import { maskCpfCnpj, maskPhone } from '../../utils/masks';
import { formatMoeda, formatData, statusImovel, tipoImovel } from '../../utils/format';
import Pagination, { PER_PAGE } from '../../components/Pagination';
import { Pencil, Trash2, Search, History, Building2, CheckCircle2, KeyRound, Wrench, User } from 'lucide-react';

const FORM_IMOVEL_INICIAL = {
  codigo: '', tipo: 'apartamento', endereco: '', valor_sem_desconto: '', valor_com_desconto: '',
  dia_vencimento: '', status: 'vago', numero_iptu: '', matricula: '', conta_agua: '',
  conta_energia: '', observacoes: ''
};

const FORM_INQUILINO_INICIAL = {
  nome: '', cpf_cnpj: '', telefone: '', email: '', endereco: '', observacoes: ''
};

const StatCard = ({ icon, value, label, color, active, onClick }) => (
  <div
    className={`stat-card${active ? ' stat-card-active' : ''}`}
    onClick={onClick}
    style={{ cursor: 'pointer' }}
  >
    <div className="stat-icon" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>{icon}</div>
    <div className="stat-info">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  </div>
);

export default function Imoveis() {
  const [imoveis, setImoveis] = useState([]);
  const [todosImoveis, setTodosImoveis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const [form, setForm] = useState(FORM_IMOVEL_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [page, setPage] = useState(1);
  const [historicoModal, setHistoricoModal] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [abaAtiva, setAbaAtiva] = useState('dados');
  const [cadastroCompleto, setCadastroCompleto] = useState(false);

  // Aba Inquilino
  const [formInquilino, setFormInquilino] = useState(FORM_INQUILINO_INICIAL);
  const [inquilinoVinculado, setInquilinoVinculado] = useState(null);
  const [salvandoInquilino, setSalvandoInquilino] = useState(false);

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

  // Lista completa pra contar cards do mini dashboard
  const fetchTodos = useCallback(async () => {
    try {
      const res = await imoveisService.listar();
      setTodosImoveis(res.data);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    const t = setTimeout(fetchImoveis, 300);
    return () => clearTimeout(t);
  }, [fetchImoveis]);

  useEffect(() => { fetchTodos(); }, [fetchTodos]);

  useEffect(() => { setPage(1); }, [busca, filtroStatus]);

  const stats = useMemo(() => {
    const total = todosImoveis.length;
    const ocupados = todosImoveis.filter((im) => im.status === 'alugado').length;
    const vagos = todosImoveis.filter((im) => im.status === 'vago').length;
    const manutencao = todosImoveis.filter((im) => im.status === 'manutencao').length;
    return { total, ocupados, vagos, manutencao };
  }, [todosImoveis]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_IMOVEL_INICIAL);
    setFormInquilino(FORM_INQUILINO_INICIAL);
    setInquilinoVinculado(null);
    setAbaAtiva('dados');
    setModalAberto(true);
  };

  const carregarInquilinoDoImovel = async (imovelId) => {
    try {
      const res = await contratosService.listar();
      const contratoAtivo = res.data.find((c) => c.imovel_id === imovelId && c.status === 'ativo');
      if (contratoAtivo?.inquilino_id) {
        const inqRes = await inquilinosService.buscarPorId(contratoAtivo.inquilino_id);
        const inq = inqRes.data;
        setInquilinoVinculado(inq);
        setFormInquilino({
          nome: inq.nome || '',
          cpf_cnpj: maskCpfCnpj(inq.cpf_cnpj || ''),
          telefone: maskPhone(inq.telefone || ''),
          email: inq.email || '',
          endereco: inq.endereco || '',
          observacoes: inq.observacoes || ''
        });
      } else {
        setInquilinoVinculado(null);
        setFormInquilino(FORM_INQUILINO_INICIAL);
      }
    } catch {
      setInquilinoVinculado(null);
      setFormInquilino(FORM_INQUILINO_INICIAL);
    }
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
    setAbaAtiva('dados');
    carregarInquilinoDoImovel(imovel.id);
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e?.preventDefault();
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
      fetchTodos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar imóvel');
    } finally {
      setSalvando(false);
    }
  };

  const handleSalvarInquilino = async (e) => {
    e?.preventDefault();
    setSalvandoInquilino(true);
    try {
      if (inquilinoVinculado) {
        await inquilinosService.atualizar(inquilinoVinculado.id, formInquilino);
        toast.success('Inquilino atualizado');
      } else {
        await inquilinosService.criar(formInquilino);
        toast.success('Inquilino cadastrado. Para vinculá-lo ao imóvel, crie um contrato.');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar inquilino');
    } finally {
      setSalvandoInquilino(false);
    }
  };

  const handleExcluir = async () => {
    try {
      await imoveisService.excluir(confirmExcluir.id);
      toast.success('Imóvel excluído com sucesso!');
      setConfirmExcluir(null);
      fetchImoveis();
      fetchTodos();
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

  const setF = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));
  const setFI = (campo, valor) => setFormInquilino(prev => ({ ...prev, [campo]: valor }));

  const paginatedImoveis = imoveis.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const f = form;

  const tabs = [
    { id: 'dados', label: 'Dados do Imóvel', icon: <Building2 size={14} /> },
    { id: 'inquilino', label: 'Inquilino', icon: <User size={14} /> }
  ];

  const toggleFiltroCard = (status) => {
    setFiltroStatus(filtroStatus === status ? '' : status);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Imóveis</h1>
          <p>Gerencie os imóveis cadastrados, status de locação e dados principais.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setCadastroCompleto(true)}>Cadastro completo</button>
          <button className="btn btn-primary" onClick={abrirNovo}>+ Novo Imóvel</button>
        </div>
      </div>

      <div className="stats-grid stats-grid-4" style={{ marginBottom: 20 }}>
        <StatCard
          icon={<Building2 size={22} />}
          value={stats.total}
          label="Total de Imóveis"
          color="var(--primary)"
          active={filtroStatus === ''}
          onClick={() => setFiltroStatus('')}
        />
        <StatCard
          icon={<CheckCircle2 size={22} />}
          value={stats.ocupados}
          label="Ocupados"
          color="var(--success)"
          active={filtroStatus === 'alugado'}
          onClick={() => toggleFiltroCard('alugado')}
        />
        <StatCard
          icon={<KeyRound size={22} />}
          value={stats.vagos}
          label="Vagos"
          color="var(--warning)"
          active={filtroStatus === 'vago'}
          onClick={() => toggleFiltroCard('vago')}
        />
        <StatCard
          icon={<Wrench size={22} />}
          value={stats.manutencao}
          label="Em Manutenção"
          color="var(--danger)"
          active={filtroStatus === 'manutencao'}
          onClick={() => toggleFiltroCard('manutencao')}
        />
      </div>

      <div className="filters-row">
        <div className="search-input-wrap">
          <span className="search-icon"><Search size={16} /></span>
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
          <option value="manutencao">Em Manutenção</option>
          <option value="encerrado">Encerrado</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : imoveis.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Building2 size={48} /></div>
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
                  <th>Valor</th>
                  <th>Venc.</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginatedImoveis.map((im) => {
                  const st = statusImovel(im.status);
                  return (
                    <tr key={im.id} className="clickable-row" onClick={() => abrirEditar(im)}>
                      <td><strong>{im.codigo}</strong></td>
                      <td>{tipoImovel(im.tipo)}</td>
                      <td style={{ maxWidth: 260 }}>{im.endereco}</td>
                      <td>
                        <strong>{formatMoeda(im.valor_com_desconto || im.valor_sem_desconto)}</strong>
                        {im.valor_com_desconto && parseFloat(im.valor_com_desconto) !== parseFloat(im.valor_sem_desconto) && (
                          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>s/ desc.: {formatMoeda(im.valor_sem_desconto)}</div>
                        )}
                      </td>
                      <td>Dia {im.dia_vencimento}</td>
                      <td><span className={`badge ${st.className}`}>{st.label}</span></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="table-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" title="Histórico" onClick={() => verHistorico(im)}><History size={14} /></button>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Editar" onClick={() => abrirEditar(im)}><Pencil size={14} /></button>
                          {isAdmin && (
                            <button className="btn btn-outline-danger btn-sm btn-icon" title="Excluir" onClick={() => setConfirmExcluir(im)}><Trash2 size={14} /></button>
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

      {/* Modal Formulário com abas */}
      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? `Imóvel — ${form.codigo}` : 'Novo Imóvel'}
        size="lg"
        footer={
          abaAtiva === 'dados' ? (
            <>
              <button className="btn btn-ghost" onClick={() => setModalAberto(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSalvar} disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setModalAberto(false)}>Fechar</button>
              <button className="btn btn-primary" onClick={handleSalvarInquilino} disabled={salvandoInquilino}>
                {salvandoInquilino ? 'Salvando...' : inquilinoVinculado ? 'Atualizar Inquilino' : 'Cadastrar Inquilino'}
              </button>
            </>
          )
        }
      >
        <Tabs tabs={tabs} active={abaAtiva} onChange={setAbaAtiva} />

        {abaAtiva === 'dados' && (
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
                  <option value="manutencao">Em Manutenção</option>
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
        )}

        {abaAtiva === 'inquilino' && (
          <form onSubmit={handleSalvarInquilino}>
            {inquilinoVinculado ? (
              <div className="alert alert-info" style={{ marginBottom: 16 }}>
                <strong>Inquilino atual:</strong> {inquilinoVinculado.nome} (vínculo via contrato ativo)
              </div>
            ) : editando ? (
              <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                Este imóvel não tem inquilino ativo. Cadastre os dados abaixo — para vincular ao imóvel, crie um contrato em <strong>Contratos</strong>.
              </div>
            ) : (
              <div className="alert alert-info" style={{ marginBottom: 16 }}>
                Salve primeiro os dados do imóvel. Em seguida, cadastre o inquilino e crie um contrato vinculando os dois.
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Nome completo <span className="required">*</span></label>
              <input className="form-control" value={formInquilino.nome} onChange={(e) => setFI('nome', e.target.value)} required />
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">CPF / CNPJ <span className="required">*</span></label>
                <CpfCnpjInput value={formInquilino.cpf_cnpj} onChange={(v) => setFI('cpf_cnpj', v)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Telefone <span className="required">*</span></label>
                <PhoneInput value={formInquilino.telefone} onChange={(v) => setFI('telefone', v)} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">E-mail</label>
              <input className="form-control" type="email" value={formInquilino.email} onChange={(e) => setFI('email', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Endereço</label>
              <input className="form-control" value={formInquilino.endereco} onChange={(e) => setFI('endereco', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Observações</label>
              <textarea className="form-control" value={formInquilino.observacoes} onChange={(e) => setFI('observacoes', e.target.value)} rows={3} />
            </div>
          </form>
        )}
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

      <CadastroCompleto
        isOpen={cadastroCompleto}
        onClose={() => setCadastroCompleto(false)}
        onDone={fetchImoveis}
        toast={toast}
      />
    </div>
  );
}
