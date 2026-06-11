import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { contratosService, imoveisService, inquilinosService, reajustesService } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import Tabs from '../../components/Tabs';
import { MoneyInput } from '../../components/MaskedInput';
import { formatMoeda, formatData, statusContrato, statusReajuste, garantiaLabel } from '../../utils/format';
import Pagination, { PER_PAGE } from '../../components/Pagination';
import { Pencil, Trash2, Paperclip, FileText, CheckCircle2, AlertCircle, Clock, TrendingUp, AlertTriangle, CalendarClock } from 'lucide-react';

const FORM_INICIAL = {
  imovel_id: '', inquilino_id: '', data_inicio: '', data_fim: '',
  valor: '', garantia: 'fiador', status: 'ativo', renovacao_automatica: true, observacoes: '', arquivo_pdf: null
};

const FORM_REAJUSTE_INICIAL = {
  imovel_id: '', contrato_id: '', valor_atual: '', data_ultimo: '', data_proximo: '',
  percentual: '', novo_valor: '', status: 'pendente', observacoes: ''
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

export default function Contratos() {
  const [contratos, setContratos] = useState([]);
  const [todosContratos, setTodosContratos] = useState([]);
  const [todosReajustes, setTodosReajustes] = useState([]);
  const [imoveis, setImoveis] = useState([]);
  const [inquilinos, setInquilinos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroExtra, setFiltroExtra] = useState(''); // 'proximos' | 'reaj_pendente' | 'reaj_proximo' | 'reaj_atrasado'
  const [modalAberto, setModalAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [page, setPage] = useState(1);
  const [abaAtiva, setAbaAtiva] = useState('dados');

  // Aba Reajustes
  const [reajustesContrato, setReajustesContrato] = useState([]);
  const [formReajuste, setFormReajuste] = useState(FORM_REAJUSTE_INICIAL);
  const [editandoReajuste, setEditandoReajuste] = useState(null);
  const [salvandoReajuste, setSalvandoReajuste] = useState(false);
  const [confirmExcluirReajuste, setConfirmExcluirReajuste] = useState(null);

  // Ações rápidas: informar renovação / reajuste
  const [renovarAlvo, setRenovarAlvo] = useState(null);
  const [renovarAnos, setRenovarAnos] = useState(1);
  const [renovarSalvando, setRenovarSalvando] = useState(false);
  const [reajAlvo, setReajAlvo] = useState(null);
  const [reajForm, setReajForm] = useState({ novo_valor: '', percentual: '', data: '' });
  const [reajSalvando, setReajSalvando] = useState(false);

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

  const fetchTodos = useCallback(async () => {
    try {
      const [cts, rjs] = await Promise.all([
        contratosService.listar().catch(() => ({ data: [] })),
        reajustesService.listar().catch(() => ({ data: [] }))
      ]);
      setTodosContratos(cts.data);
      setTodosReajustes(rjs.data);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { fetchContratos(); }, [fetchContratos]);
  useEffect(() => { fetchTodos(); }, [fetchTodos]);

  useEffect(() => { setPage(1); }, [filtroStatus, filtroExtra]);

  useEffect(() => {
    Promise.all([imoveisService.listar(), inquilinosService.listar()])
      .then(([imRes, inqRes]) => {
        setImoveis(imRes.data);
        setInquilinos(inqRes.data);
      }).catch(() => {});
  }, []);

  // ===== Cálculo dos cards =====
  const stats = useMemo(() => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const ativos = todosContratos.filter((c) => c.status === 'ativo').length;
    const vencidos = todosContratos.filter((c) => {
      if (c.status === 'vencido') return true;
      if (!c.data_fim) return false;
      return new Date(c.data_fim) < hoje && c.status !== 'encerrado';
    }).length;
    const proximos = todosContratos.filter((c) => {
      if (c.status !== 'ativo' || !c.data_fim) return false;
      const dias = Math.ceil((new Date(c.data_fim) - hoje) / 86400000);
      return dias >= 0 && dias <= 30;
    }).length;

    const reajPendentes = todosReajustes.filter((r) => r.status === 'pendente').length;
    const reajProximos = todosReajustes.filter((r) => {
      if (r.status === 'aplicado' || !r.data_proximo) return false;
      const dias = Math.ceil((new Date(r.data_proximo) - hoje) / 86400000);
      return dias >= 0 && dias <= 30;
    }).length;
    const reajAtrasados = todosReajustes.filter((r) => {
      if (r.status === 'aplicado' || !r.data_proximo) return false;
      return new Date(r.data_proximo) < hoje;
    }).length;

    return { ativos, vencidos, proximos, reajPendentes, reajProximos, reajAtrasados };
  }, [todosContratos, todosReajustes]);

  // ===== Aplica filtros extras na lista =====
  const contratosFiltrados = useMemo(() => {
    if (!filtroExtra) return contratos;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    if (filtroExtra === 'proximos') {
      return contratos.filter((c) => {
        if (c.status !== 'ativo' || !c.data_fim) return false;
        const dias = Math.ceil((new Date(c.data_fim) - hoje) / 86400000);
        return dias >= 0 && dias <= 30;
      });
    }
    // Filtros de reajuste — mostra contratos que têm reajuste no critério
    const idsContratos = new Set();
    todosReajustes.forEach((r) => {
      if (filtroExtra === 'reaj_pendente' && r.status === 'pendente') idsContratos.add(r.contrato_id);
      if (filtroExtra === 'reaj_proximo' && r.status !== 'aplicado' && r.data_proximo) {
        const dias = Math.ceil((new Date(r.data_proximo) - hoje) / 86400000);
        if (dias >= 0 && dias <= 30) idsContratos.add(r.contrato_id);
      }
      if (filtroExtra === 'reaj_atrasado' && r.status !== 'aplicado' && r.data_proximo) {
        if (new Date(r.data_proximo) < hoje) idsContratos.add(r.contrato_id);
      }
    });
    return contratos.filter((c) => idsContratos.has(c.id));
  }, [contratos, filtroExtra, todosReajustes]);

  const toggleExtra = (chave) => setFiltroExtra(filtroExtra === chave ? '' : chave);
  const toggleStatus = (s) => setFiltroStatus(filtroStatus === s ? '' : s);

  // ===== Ações rápidas: renovar / reajustar =====
  const calcNovaDataFim = (dataFim, anos) => {
    if (!dataFim) return '—';
    const d = new Date(dataFim);
    d.setFullYear(d.getFullYear() + (parseInt(anos, 10) || 1));
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  };

  const abrirRenovar = (c) => { setRenovarAnos(1); setRenovarAlvo(c); };
  const confirmarRenovar = async () => {
    setRenovarSalvando(true);
    try {
      await contratosService.renovar(renovarAlvo.id, { anos: renovarAnos });
      toast.success('Contrato renovado!');
      setRenovarAlvo(null);
      fetchContratos(); fetchTodos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao renovar contrato');
    } finally {
      setRenovarSalvando(false);
    }
  };

  const abrirReajuste = (c) => {
    setReajForm({ novo_valor: '', percentual: '', data: new Date().toISOString().split('T')[0] });
    setReajAlvo(c);
  };
  const reajNovoValorCalc = () => {
    if (!reajAlvo) return 0;
    if (reajForm.novo_valor) return parseFloat(reajForm.novo_valor) || 0;
    if (reajForm.percentual) return Number((parseFloat(reajAlvo.valor || 0) * (1 + parseFloat(reajForm.percentual) / 100)).toFixed(2));
    return 0;
  };
  const confirmarReajuste = async () => {
    if (!reajForm.novo_valor && !reajForm.percentual) { toast.error('Informe o novo valor ou o percentual'); return; }
    setReajSalvando(true);
    try {
      await contratosService.reajustar(reajAlvo.id, {
        novo_valor: reajForm.novo_valor || undefined,
        percentual: reajForm.percentual || undefined,
        data: reajForm.data || undefined
      });
      toast.success('Reajuste aplicado e registrado no histórico!');
      setReajAlvo(null);
      fetchContratos(); fetchTodos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao reajustar contrato');
    } finally {
      setReajSalvando(false);
    }
  };

  // ===== Modal contrato (somente edição/visualização) =====
  const carregarReajustesContrato = async (contratoId) => {
    try {
      const res = await reajustesService.listar();
      setReajustesContrato(res.data.filter((r) => r.contrato_id === contratoId));
    } catch {
      setReajustesContrato([]);
    }
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
      renovacao_automatica: c.renovacao_automatica !== false,
      observacoes: c.observacoes || '',
      arquivo_pdf: null
    });
    setFormReajuste({ ...FORM_REAJUSTE_INICIAL, contrato_id: c.id, imovel_id: c.imovel_id, valor_atual: c.valor });
    setEditandoReajuste(null);
    setAbaAtiva('dados');
    carregarReajustesContrato(c.id);
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e?.preventDefault();
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
      fetchTodos();
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
      fetchTodos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir contrato');
    }
  };

  const verPdf = async (arquivo) => {
    try {
      const res = await contratosService.baixarArquivo(arquivo);
      const url = window.URL.createObjectURL(res.data);
      window.open(url, '_blank', 'noopener');
      // Libera o object URL depois que o navegador teve tempo de abri-lo
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('Erro ao abrir o PDF do contrato');
    }
  };

  // ===== Reajustes =====
  const calcularNovoValor = (atual, pct) => {
    if (!atual || !pct) return '';
    return (parseFloat(atual) * (1 + parseFloat(pct) / 100)).toFixed(2);
  };

  const setFR = (campo, valor) => {
    setFormReajuste((prev) => {
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

  const novoReajuste = () => {
    setEditandoReajuste(null);
    setFormReajuste({
      ...FORM_REAJUSTE_INICIAL,
      contrato_id: editando,
      imovel_id: form.imovel_id,
      valor_atual: form.valor
    });
  };

  const editarReajuste = (r) => {
    setEditandoReajuste(r.id);
    setFormReajuste({
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
  };

  const salvarReajuste = async (e) => {
    e?.preventDefault();
    setSalvandoReajuste(true);
    try {
      if (editandoReajuste) {
        await reajustesService.atualizar(editandoReajuste, formReajuste);
        toast.success('Reajuste atualizado!');
      } else {
        await reajustesService.criar(formReajuste);
        toast.success('Reajuste cadastrado!');
      }
      setEditandoReajuste(null);
      setFormReajuste({
        ...FORM_REAJUSTE_INICIAL,
        contrato_id: editando,
        imovel_id: form.imovel_id,
        valor_atual: form.valor
      });
      carregarReajustesContrato(editando);
      fetchTodos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar reajuste');
    } finally {
      setSalvandoReajuste(false);
    }
  };

  const excluirReajuste = async () => {
    if (!confirmExcluirReajuste) return;
    try {
      await reajustesService.excluir(confirmExcluirReajuste.id);
      toast.success('Reajuste excluído');
      setConfirmExcluirReajuste(null);
      carregarReajustesContrato(editando);
      fetchTodos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  const setF = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));

  const paginatedContratos = contratosFiltrados.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const getAlertaVencimento = (dias) => {
    if (dias <= 0) return <span className="badge badge-danger">Vencido</span>;
    if (dias <= 7) return <span className="badge badge-danger">Vence em {dias}d</span>;
    if (dias <= 30) return <span className="badge badge-warning">Vence em {dias}d</span>;
    return null;
  };

  const tabs = [
    { id: 'dados', label: 'Dados do Contrato', icon: <FileText size={14} /> },
    { id: 'reajustes', label: 'Reajustes', icon: <TrendingUp size={14} />, disabled: !editando }
  ];

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Contratos</h1>
          <p>Controle contratos ativos, vencidos e próximos do vencimento.</p>
        </div>
        <span className="form-hint" style={{ maxWidth: 280, textAlign: 'right' }}>
          Novos contratos são criados em <strong>Imóveis › Novo Imóvel</strong>. Aqui você acompanha e atualiza os existentes.
        </span>
      </div>

      {/* Bloco 1 — Status dos Contratos */}
      <div className="stats-block-label">Status dos Contratos</div>
      <div className="stats-grid stats-grid-3" style={{ marginBottom: 16 }}>
        <StatCard
          icon={<CheckCircle2 size={22} />}
          value={stats.ativos}
          label="Ativos"
          color="var(--success)"
          active={filtroStatus === 'ativo'}
          onClick={() => { setFiltroExtra(''); toggleStatus('ativo'); }}
        />
        <StatCard
          icon={<AlertCircle size={22} />}
          value={stats.vencidos}
          label="Vencidos"
          color="var(--danger)"
          active={filtroStatus === 'vencido'}
          onClick={() => { setFiltroExtra(''); toggleStatus('vencido'); }}
        />
        <StatCard
          icon={<Clock size={22} />}
          value={stats.proximos}
          label="Próximos de Vencer (30d)"
          color="var(--warning)"
          active={filtroExtra === 'proximos'}
          onClick={() => { setFiltroStatus(''); toggleExtra('proximos'); }}
        />
      </div>

      {/* Bloco 2 — Status dos Reajustes */}
      <div className="stats-block-label">Status dos Reajustes</div>
      <div className="stats-grid stats-grid-3" style={{ marginBottom: 20 }}>
        <StatCard
          icon={<TrendingUp size={22} />}
          value={stats.reajPendentes}
          label="Reajustes Pendentes"
          color="var(--accent)"
          active={filtroExtra === 'reaj_pendente'}
          onClick={() => { setFiltroStatus(''); toggleExtra('reaj_pendente'); }}
        />
        <StatCard
          icon={<CalendarClock size={22} />}
          value={stats.reajProximos}
          label="Próximos do Reajuste (30d)"
          color="var(--info)"
          active={filtroExtra === 'reaj_proximo'}
          onClick={() => { setFiltroStatus(''); toggleExtra('reaj_proximo'); }}
        />
        <StatCard
          icon={<AlertTriangle size={22} />}
          value={stats.reajAtrasados}
          label="Reajuste Atrasado"
          color="var(--danger)"
          active={filtroExtra === 'reaj_atrasado'}
          onClick={() => { setFiltroStatus(''); toggleExtra('reaj_atrasado'); }}
        />
      </div>

      <div className="filters-row">
        <select className="form-control filter-select" value={filtroStatus} onChange={(e) => { setFiltroExtra(''); setFiltroStatus(e.target.value); }}>
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
          ) : contratosFiltrados.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><FileText size={48} /></div>
              <h3>Nenhum contrato encontrado</h3>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Inquilino</th>
                  <th>Vigência</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Vencimento</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginatedContratos.map((c) => {
                  const st = statusContrato(c.status);
                  return (
                    <tr key={c.id} className="clickable-row" onClick={() => abrirEditar(c)}>
                      <td>
                        <strong>{c.imovel_codigo}</strong>
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{c.imovel_endereco}</div>
                      </td>
                      <td>
                        <strong>{c.inquilino_nome}</strong>
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{c.inquilino_telefone}</div>
                      </td>
                      <td>
                        <div>{formatData(c.data_inicio)} — {formatData(c.data_fim)}</div>
                        {c.status === 'ativo' && c.renovacao_automatica !== false && (
                          <span className="chip" style={{ fontSize: 10 }} title="Renova automaticamente +1 ano ao vencer">auto</span>
                        )}
                      </td>
                      <td>
                        <strong>{formatMoeda(c.valor)}</strong>
                        {c.garantia && c.garantia !== 'sem' && (
                          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{garantiaLabel(c.garantia)}</div>
                        )}
                      </td>
                      <td><span className={`badge ${st.className}`}>{st.label}</span></td>
                      <td>{c.status === 'ativo' && getAlertaVencimento(c.dias_para_vencer)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="table-actions">
                          {c.status !== 'encerrado' && (
                            <button className="btn btn-ghost btn-sm btn-icon" title="Informar renovação" onClick={() => abrirRenovar(c)}><CalendarClock size={14} color="var(--accent)" /></button>
                          )}
                          {c.status !== 'encerrado' && (
                            <button className="btn btn-ghost btn-sm btn-icon" title="Informar reajuste" onClick={() => abrirReajuste(c)}><TrendingUp size={14} color="var(--success)" /></button>
                          )}
                          {c.arquivo_pdf && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Ver PDF"
                              onClick={() => verPdf(c.arquivo_pdf)}
                            ><Paperclip size={14} /></button>
                          )}
                          <button className="btn btn-ghost btn-sm btn-icon" title="Editar / detalhes" onClick={() => abrirEditar(c)}><Pencil size={14} /></button>
                          {isAdmin && (
                            <button className="btn btn-outline-danger btn-sm btn-icon" title="Excluir" onClick={() => setConfirmExcluir(c)}><Trash2 size={14} /></button>
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
        <Pagination total={contratosFiltrados.length} page={page} perPage={PER_PAGE} onChange={setPage} />
      </div>

      {/* Modal com abas */}
      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? `Contrato — ${form.imovel_id ? imoveis.find((i) => String(i.id) === String(form.imovel_id))?.codigo || '' : ''}` : 'Novo Contrato'}
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
              <button className="btn btn-primary" onClick={salvarReajuste} disabled={salvandoReajuste}>
                {salvandoReajuste ? 'Salvando...' : editandoReajuste ? 'Atualizar Reajuste' : 'Cadastrar Reajuste'}
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
                <label className="form-label">Imóvel <span className="required">*</span></label>
                <select className="form-control" value={form.imovel_id} onChange={(e) => setF('imovel_id', e.target.value)} required>
                  <option value="">Selecione...</option>
                  {imoveis.map(im => {
                    const statusLabel = { vago: '🟢 Vago', alugado: '🔴 Alugado', negociacao: '🟡 Negociação', encerrado: '⚫ Encerrado', manutencao: '🔧 Manutenção' };
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
                <MoneyInput value={form.valor} onChange={(v) => setF('valor', v)} required />
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
              <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={form.renovacao_automatica}
                  onChange={(e) => setF('renovacao_automatica', e.target.checked)}
                />
                Renovação automática anual
              </label>
              <div className="form-hint">
                Ao vencer, o contrato é prorrogado por +1 ano automaticamente e as parcelas continuam sendo geradas.
                Desmarque para o contrato vencer normalmente na data de fim.
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
        )}

        {abaAtiva === 'reajustes' && editando && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--gray-700)' }}>Histórico de reajustes</h4>
              {reajustesContrato.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <p style={{ margin: 0 }}>Nenhum reajuste registrado para este contrato</p>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Próximo</th>
                        <th>Valor Atual</th>
                        <th>%</th>
                        <th>Novo Valor</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reajustesContrato.map((r) => {
                        const st = statusReajuste(r.status);
                        return (
                          <tr key={r.id}>
                            <td>{formatData(r.data_proximo)}</td>
                            <td>{formatMoeda(r.valor_atual)}</td>
                            <td>+{r.percentual}%</td>
                            <td><strong>{formatMoeda(r.novo_valor)}</strong></td>
                            <td><span className={`badge ${st.className}`}>{st.label}</span></td>
                            <td>
                              <div className="table-actions">
                                <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => editarReajuste(r)}><Pencil size={14} /></button>
                                {isAdmin && <button type="button" className="btn btn-outline-danger btn-sm btn-icon" onClick={() => setConfirmExcluirReajuste(r)}><Trash2 size={14} /></button>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <hr className="divider" />

            <h4 style={{ margin: '12px 0 8px', fontSize: 14, color: 'var(--gray-700)' }}>
              {editandoReajuste ? 'Editar Reajuste' : 'Novo Reajuste'}
            </h4>

            <form onSubmit={salvarReajuste}>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Valor Atual <span className="required">*</span></label>
                  <MoneyInput value={formReajuste.valor_atual} onChange={(v) => setFR('valor_atual', v)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Percentual (%) <span className="required">*</span></label>
                  <input className="form-control" type="number" step="0.01" min="0" value={formReajuste.percentual} onChange={(e) => setFR('percentual', e.target.value)} required />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Novo Valor Calculado</label>
                <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '9px 13px' }}>
                  <strong style={{ color: 'var(--success-dark)', fontSize: 16 }}>
                    {formReajuste.novo_valor ? formatMoeda(formReajuste.novo_valor) : 'Informe valor atual e percentual'}
                  </strong>
                </div>
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Último Reajuste</label>
                  <input className="form-control" type="date" value={formReajuste.data_ultimo} onChange={(e) => setFR('data_ultimo', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Próximo Reajuste <span className="required">*</span></label>
                  <input className="form-control" type="date" value={formReajuste.data_proximo} onChange={(e) => setFR('data_proximo', e.target.value)} required />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-control" value={formReajuste.status} onChange={(e) => setFR('status', e.target.value)}>
                  <option value="pendente">Pendente</option>
                  <option value="avisado">Avisado</option>
                  <option value="aplicado">Aplicado</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Observações</label>
                <textarea className="form-control" value={formReajuste.observacoes} onChange={(e) => setFR('observacoes', e.target.value)} rows={2} />
              </div>

              {editandoReajuste && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={novoReajuste}>
                  Cancelar edição · Cadastrar novo
                </button>
              )}
            </form>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmExcluir}
        onClose={() => setConfirmExcluir(null)}
        onConfirm={handleExcluir}
        title="Excluir Contrato"
        message="Tem certeza que deseja excluir este contrato?"
      />

      <ConfirmDialog
        isOpen={!!confirmExcluirReajuste}
        onClose={() => setConfirmExcluirReajuste(null)}
        onConfirm={excluirReajuste}
        title="Excluir Reajuste"
        message={confirmExcluirReajuste ? `Excluir reajuste previsto para ${formatData(confirmExcluirReajuste.data_proximo)}?` : ''}
      />

      {/* ===== Modal: informar renovação ===== */}
      <Modal
        isOpen={!!renovarAlvo}
        onClose={() => setRenovarAlvo(null)}
        title="Informar renovação do contrato"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRenovarAlvo(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={confirmarRenovar} disabled={renovarSalvando}>
              {renovarSalvando ? 'Renovando...' : 'Confirmar renovação'}
            </button>
          </>
        }
      >
        {renovarAlvo && (
          <>
            <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 16, fontSize: 13 }}>
              <div><span style={{ color: 'var(--gray-500)' }}>Contrato:</span> <strong>{renovarAlvo.imovel_codigo}</strong> · {renovarAlvo.inquilino_nome}</div>
              <div><span style={{ color: 'var(--gray-500)' }}>Vigência atual:</span> {formatData(renovarAlvo.data_inicio)} — {formatData(renovarAlvo.data_fim)}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Renovar por (anos)</label>
              <select className="form-control" value={renovarAnos} onChange={(e) => setRenovarAnos(e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} ano(s)</option>)}
              </select>
            </div>
            <div style={{ fontSize: 14 }}>
              <span style={{ color: 'var(--gray-500)' }}>Nova data de término: </span>
              <strong style={{ color: 'var(--accent)' }}>{calcNovaDataFim(renovarAlvo.data_fim, renovarAnos)}</strong>
            </div>
            <div className="form-hint" style={{ marginTop: 6 }}>O contrato continuará ativo com a nova vigência.</div>
          </>
        )}
      </Modal>

      {/* ===== Modal: informar reajuste ===== */}
      <Modal
        isOpen={!!reajAlvo}
        onClose={() => setReajAlvo(null)}
        title="Informar reajuste do aluguel"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setReajAlvo(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={confirmarReajuste} disabled={reajSalvando}>
              {reajSalvando ? 'Aplicando...' : 'Aplicar reajuste'}
            </button>
          </>
        }
      >
        {reajAlvo && (
          <>
            <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 16, fontSize: 13 }}>
              <div><span style={{ color: 'var(--gray-500)' }}>Contrato:</span> <strong>{reajAlvo.imovel_codigo}</strong> · {reajAlvo.inquilino_nome}</div>
              <div><span style={{ color: 'var(--gray-500)' }}>Valor atual:</span> <strong>{formatMoeda(reajAlvo.valor)}</strong></div>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Percentual (%)</label>
                <input
                  className="form-control" type="number" step="0.01" min="0" placeholder="ex.: 10"
                  value={reajForm.percentual}
                  onChange={(e) => setReajForm((p) => ({ ...p, percentual: e.target.value, novo_valor: '' }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Novo valor (R$)</label>
                <MoneyInput
                  value={reajForm.novo_valor}
                  onChange={(v) => setReajForm((p) => ({ ...p, novo_valor: v, percentual: '' }))}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Data do reajuste</label>
              <input className="form-control" type="date" value={reajForm.data} onChange={(e) => setReajForm((p) => ({ ...p, data: e.target.value }))} />
            </div>
            <div style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 12, fontSize: 14 }}>
              <span style={{ color: 'var(--gray-500)' }}>Novo aluguel: </span>
              <strong style={{ color: 'var(--success)' }}>{formatMoeda(reajNovoValorCalc())}</strong>
            </div>
            <div className="form-hint" style={{ marginTop: 6 }}>
              O valor do contrato será atualizado e o reajuste ficará registrado no histórico (aba Reajustes).
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
