import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { despesasService, despesaTiposService, imoveisService, downloadBlob } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { MoneyInput } from '../../components/MaskedInput';
import Pagination, { PER_PAGE } from '../../components/Pagination';
import FilterBar from '../../components/filters/FilterBar';
import StatusPills from '../../components/filters/StatusPills';
import PeriodPicker from '../../components/filters/PeriodPicker';
import MetricCard from '../../components/MetricCard';
import { EmptyState, EmptyFiltered, ErrorState } from '../../components/StateViews';
import { formatMoeda, formatData, statusDespesa, tipoDespesaLabel } from '../../utils/format';
import { Pencil, Trash2, Receipt, AlertTriangle, FileText, FileSpreadsheet, Banknote, RotateCcw, Tags, Plus } from 'lucide-react';

const hoje = () => new Date().toISOString().split('T')[0];

const FORM_INICIAL = {
  imovel_id: '', tipo: '', valor: '', vencimento: '',
  status: 'pendente', descricao: '', observacoes: '',
  repetir: false, recorrencia_meses: 2
};

const PAG_INICIAL = {
  data_pagamento: hoje(), forma_pagamento: 'pix',
  valor_pago: '', juros: '', multa: '', desconto: ''
};

const FORMAS = [
  { value: 'pix', label: 'PIX' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'ted', label: 'TED' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'debito_automatico', label: 'Débito automático' },
  { value: 'outro', label: 'Outro' }
];

const STATUS_OPTIONS = [
  { value: '', label: 'Todos', color: 'gray' },
  { value: 'pendente', label: 'Em aberto', color: 'warning' },
  { value: 'parcial', label: 'Parcial', color: 'info' },
  { value: 'pago', label: 'Pago', color: 'success' },
  { value: 'atrasado', label: 'Atrasado', color: 'danger' }
];

const ALERTA_DIAS = 5;

const diasAteVencimento = (d) => {
  if (!d) return null;
  const h = new Date(); h.setHours(0, 0, 0, 0);
  const venc = new Date(d); venc.setHours(0, 0, 0, 0);
  return Math.ceil((venc - h) / 86400000);
};

const devidoDe = (d) => (parseFloat(d.valor || 0) + parseFloat(d.juros || 0) + parseFloat(d.multa || 0) - parseFloat(d.desconto || 0));
const faltaDe = (d) => Math.max(0, devidoDe(d) - parseFloat(d.valor_pago || 0));

export default function Despesas() {
  const [despesas, setDespesas] = useState([]);
  const [imoveis, setImoveis] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroImovel, setFiltroImovel] = useState('');
  const [filtroMes, setFiltroMes] = useState('');
  const [filtroAno, setFiltroAno] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [page, setPage] = useState(1);
  // Informar pagamento
  const [pagAlvo, setPagAlvo] = useState(null);
  const [pagForm, setPagForm] = useState(PAG_INICIAL);
  const [pagSalvando, setPagSalvando] = useState(false);
  // Categorias
  const [catModalOpen, setCatModalOpen] = useState(false);
  const toast = useToast();
  const { isAdmin } = useAuth();
  const location = useLocation();

  const tipoLabelMap = useMemo(() => {
    const m = {};
    tipos.forEach((t) => { m[t.codigo] = t.nome; });
    return m;
  }, [tipos]);
  const labelTipo = (codigo) => tipoLabelMap[codigo] || tipoDespesaLabel(codigo);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const s = params.get('status');
    if (s) setFiltroStatus(s);
  }, [location.search]);

  const fetchTipos = useCallback(async () => {
    try { const r = await despesaTiposService.listar(); setTipos(r.data); } catch { /* silencioso */ }
  }, []);

  const fetchDespesas = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await despesasService.listar({
        status: filtroStatus || undefined,
        tipo: filtroTipo || undefined,
        imovel_id: filtroImovel || undefined,
        mes: filtroMes || undefined,
        ano: filtroAno || undefined
      });
      setDespesas(res.data);
    } catch (err) {
      setErro(err.response?.data?.error || 'Não foi possível carregar as contas.');
    } finally {
      setLoading(false);
    }
  }, [filtroStatus, filtroTipo, filtroImovel, filtroMes, filtroAno]);

  useEffect(() => { fetchDespesas(); }, [fetchDespesas]);
  useEffect(() => { setPage(1); }, [filtroStatus, filtroTipo, filtroImovel, filtroMes, filtroAno]);
  useEffect(() => { imoveisService.listar().then(r => setImoveis(r.data)).catch(() => {}); fetchTipos(); }, [fetchTipos]);

  const setF = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));
  const setPF = (campo, valor) => setPagForm(prev => ({ ...prev, [campo]: valor }));

  const abrirNovo = () => {
    setEditando(null);
    setForm({ ...FORM_INICIAL, tipo: tipos[0]?.codigo || '' });
    setModalAberto(true);
  };

  const abrirEditar = (d) => {
    setEditando(d.id);
    setForm({
      imovel_id: d.imovel_id || '',
      tipo: d.tipo || (tipos[0]?.codigo || ''),
      valor: d.valor || '',
      vencimento: d.vencimento ? d.vencimento.split('T')[0] : '',
      status: d.status || 'pendente',
      descricao: d.descricao || '',
      observacoes: d.observacoes || '',
      repetir: false,
      recorrencia_meses: 2
    });
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    if (!form.tipo) { toast.error('Selecione uma categoria'); return; }
    setSalvando(true);
    try {
      if (editando) {
        const { repetir, recorrencia_meses, ...dados } = form;
        await despesasService.atualizar(editando, dados);
        toast.success('Conta atualizada!');
      } else {
        const payload = { ...form, recorrencia_meses: form.repetir ? Number(form.recorrencia_meses) : 1 };
        const res = await despesasService.criar(payload);
        const n = res.data.ocorrencias_criadas || 1;
        toast.success(n > 1 ? `Conta cadastrada — ${n} parcelas geradas` : 'Conta cadastrada!');
      }
      setModalAberto(false);
      fetchDespesas();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar conta');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async (excluirSerie = false) => {
    try {
      const params = excluirSerie ? { excluir_serie: true } : undefined;
      await despesasService.excluir(confirmExcluir.id, params);
      toast.success(excluirSerie ? 'Série de contas excluída!' : 'Conta excluída!');
      setConfirmExcluir(null);
      fetchDespesas();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  const handleReabrir = async (d) => {
    try {
      await despesasService.reabrir(d.id);
      toast.success('Conta reaberta (baixa estornada).');
      fetchDespesas();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao reabrir');
    }
  };

  const handleExportar = async (formato) => {
    try {
      const params = {
        status: filtroStatus || undefined, tipo: filtroTipo || undefined,
        imovel_id: filtroImovel || undefined, mes: filtroMes || undefined, ano: filtroAno || undefined
      };
      const res = await despesasService.exportar(formato, params);
      const ext = formato === 'excel' ? 'xlsx' : 'pdf';
      const stamp = new Date().toISOString().split('T')[0];
      downloadBlob(res.data, `contas-a-pagar-${stamp}.${ext}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao exportar');
    }
  };

  // ===== Informar pagamento =====
  const abrirPagamento = (d) => {
    setPagAlvo(d);
    setPagForm({
      ...PAG_INICIAL,
      data_pagamento: hoje(),
      // pré-preenche o valor pago com o que ainda falta
      valor_pago: faltaDe(d) > 0 ? faltaDe(d).toFixed(2) : parseFloat(d.valor || 0).toFixed(2)
    });
  };

  const pagJaPago = pagAlvo ? parseFloat(pagAlvo.valor_pago || 0) : 0;
  const pagTotalDevido = pagAlvo
    ? (parseFloat(pagAlvo.valor || 0) + (parseFloat(pagForm.juros) || 0) + (parseFloat(pagForm.multa) || 0) - (parseFloat(pagForm.desconto) || 0))
    : 0;
  const pagValorPago = parseFloat(pagForm.valor_pago) || 0;
  // Saldo já desconta o que foi pago em baixas anteriores (pagamentos acumulam)
  const pagSaldo = pagTotalDevido - pagJaPago - pagValorPago;

  const handleConfirmarPagamento = async () => {
    if (!pagValorPago || pagValorPago <= 0) { toast.error('Informe o valor pago'); return; }
    setPagSalvando(true);
    try {
      await despesasService.pagar(pagAlvo.id, {
        data_pagamento: pagForm.data_pagamento,
        valor_pago: pagValorPago,
        forma_pagamento: pagForm.forma_pagamento || undefined,
        juros: parseFloat(pagForm.juros) || 0,
        multa: parseFloat(pagForm.multa) || 0,
        desconto: parseFloat(pagForm.desconto) || 0
      });
      toast.success(pagSaldo > 0.005 ? 'Pagamento parcial registrado!' : 'Pagamento registrado — conta quitada!');
      setPagAlvo(null);
      fetchDespesas();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao informar pagamento');
    } finally {
      setPagSalvando(false);
    }
  };

  // ===== Stats =====
  const stats = useMemo(() => {
    const counts = { pendente: 0, pago: 0, atrasado: 0, parcial: 0 };
    let total = 0, pago = 0, aberto = 0, atrasado = 0, proximas = 0;
    despesas.forEach((d) => {
      counts[d.status] = (counts[d.status] || 0) + 1;
      total += parseFloat(d.valor || 0);
      pago += parseFloat(d.valor_pago || 0);
      const falta = faltaDe(d);
      if (d.status !== 'pago') aberto += falta;
      if (d.status === 'atrasado') atrasado += falta;
      const dias = diasAteVencimento(d.vencimento);
      if ((d.status === 'pendente' || d.status === 'parcial') && dias !== null && dias >= 0 && dias <= ALERTA_DIAS) proximas += 1;
    });
    return { counts, total, pago, aberto, atrasado, proximas };
  }, [despesas]);

  const paginated = despesas.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const hasFiltrosAtivos = !!filtroStatus || !!filtroTipo || !!filtroImovel || !!filtroMes || !!filtroAno;
  const limparFiltros = () => {
    setFiltroStatus(''); setFiltroTipo(''); setFiltroImovel(''); setFiltroMes(''); setFiltroAno('');
  };

  const rowClass = (d) => {
    if (d.status === 'pago') return '';
    if (d.status === 'atrasado') return 'row-danger';
    const dias = diasAteVencimento(d.vencimento);
    if (dias !== null && dias >= 0 && dias <= ALERTA_DIAS) return 'row-warn';
    return '';
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Contas a Pagar</h1>
          <p>Controle despesas dos imóveis e pagamentos pendentes.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setCatModalOpen(true)} title="Gerenciar categorias">
            <Tags size={14} /> Categorias
          </button>
          <button className="btn btn-ghost" onClick={() => handleExportar('excel')} title="Exportar para Excel">
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button className="btn btn-ghost" onClick={() => handleExportar('pdf')} title="Exportar para PDF">
            <FileText size={14} /> PDF
          </button>
          <button className="btn btn-primary" onClick={abrirNovo}>+ Nova Conta</button>
        </div>
      </div>

      {/* Cards */}
      <div className="metrics-grid">
        <MetricCard label="Total" value={formatMoeda(stats.total)} color="var(--info)" active={!filtroStatus} onClick={() => setFiltroStatus('')} />
        <MetricCard label="Pago" value={formatMoeda(stats.pago)} color="var(--success)" active={filtroStatus === 'pago'} onClick={() => setFiltroStatus(filtroStatus === 'pago' ? '' : 'pago')} />
        <MetricCard
          label="Em aberto"
          value={formatMoeda(stats.aberto)}
          color="var(--warning)"
          hint={stats.proximas > 0 ? `${stats.proximas} venc. em ${ALERTA_DIAS} dias` : null}
          active={filtroStatus === 'pendente'}
          onClick={() => setFiltroStatus(filtroStatus === 'pendente' ? '' : 'pendente')}
        />
        <MetricCard label="Atrasado" value={formatMoeda(stats.atrasado)} color="var(--danger)" active={filtroStatus === 'atrasado'} onClick={() => setFiltroStatus(filtroStatus === 'atrasado' ? '' : 'atrasado')} />
      </div>

      {/* Filtros */}
      <FilterBar hasActive={hasFiltrosAtivos} onClear={limparFiltros}>
        <PeriodPicker mes={filtroMes} ano={filtroAno} onChange={({ mes, ano }) => { setFiltroMes(mes); setFiltroAno(ano); }} />
        <div className="filter-field">
          <label className="filter-label">Imóvel</label>
          <select className="form-control" value={filtroImovel} onChange={(e) => setFiltroImovel(e.target.value)}>
            <option value="">Todos</option>
            {imoveis.map(im => <option key={im.id} value={im.id}>{im.codigo} — {im.endereco}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Categoria</label>
          <select className="form-control" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <option value="">Todas</option>
            {tipos.map(t => <option key={t.id} value={t.codigo}>{t.nome}</option>)}
          </select>
        </div>
        <div className="filter-field filter-field-full">
          <label className="filter-label">Status</label>
          <StatusPills options={STATUS_OPTIONS} value={filtroStatus} onChange={setFiltroStatus} counts={stats.counts} />
        </div>
      </FilterBar>

      {erro && <ErrorState message={erro} onRetry={fetchDespesas} />}

      <div className="card">
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : despesas.length === 0 ? (
            hasFiltrosAtivos ? (
              <EmptyFiltered onClear={limparFiltros} icon={<Receipt size={48} />} />
            ) : (
              <EmptyState
                icon={<Receipt size={48} />}
                title="Nenhuma conta cadastrada"
                message="Comece registrando a primeira conta a pagar."
                action={<button className="btn btn-primary" onClick={abrirNovo}>+ Registrar primeira conta</button>}
              />
            )
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Categoria</th>
                  <th>Imóvel</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((d) => {
                  const st = statusDespesa(d.status);
                  const dias = diasAteVencimento(d.vencimento);
                  const proximo = (d.status === 'pendente' || d.status === 'parcial') && dias !== null && dias >= 0 && dias <= ALERTA_DIAS;
                  const falta = faltaDe(d);
                  return (
                    <tr key={d.id} className={rowClass(d)}>
                      <td>
                        <strong>{d.descricao || labelTipo(d.tipo)}</strong>
                        {d.parcela_total > 1 && (
                          <span className="chip" style={{ marginLeft: 6, fontSize: 11 }}>{d.parcela_num}/{d.parcela_total}</span>
                        )}
                      </td>
                      <td><span className="chip">{labelTipo(d.tipo)}</span></td>
                      <td>{d.imovel_codigo || <span style={{ color: 'var(--gray-400)' }}>Geral</span>}</td>
                      <td>
                        {formatMoeda(d.valor)}
                        {d.status === 'parcial' && (
                          <div style={{ fontSize: 11, color: 'var(--info)' }}>pago {formatMoeda(d.valor_pago)} · falta {formatMoeda(falta)}</div>
                        )}
                      </td>
                      <td>
                        {formatData(d.vencimento)}
                        {proximo && (
                          <span className="badge badge-warning" style={{ marginLeft: 6, fontSize: 11 }}>
                            <AlertTriangle size={10} style={{ verticalAlign: 'middle' }} /> {dias === 0 ? 'Hoje' : `${dias}d`}
                          </span>
                        )}
                        {d.status === 'pago' && d.data_pagamento && (
                          <div style={{ fontSize: 11, color: 'var(--success)' }}>pago em {formatData(d.data_pagamento)}</div>
                        )}
                      </td>
                      <td><span className={`badge ${st.className}`}>{st.label}</span></td>
                      <td>
                        <div className="table-actions">
                          {d.status !== 'pago' && (
                            <button className="btn btn-success btn-sm btn-icon" title="Informar pagamento" onClick={() => abrirPagamento(d)}>
                              <Banknote size={14} />
                            </button>
                          )}
                          {(d.status === 'pago' || d.status === 'parcial') && (
                            <button className="btn btn-ghost btn-sm btn-icon" title="Reabrir / estornar baixa" onClick={() => handleReabrir(d)}>
                              <RotateCcw size={14} />
                            </button>
                          )}
                          <button className="btn btn-ghost btn-sm btn-icon" title="Editar" onClick={() => abrirEditar(d)}><Pencil size={14} /></button>
                          {isAdmin && <button className="btn btn-outline-danger btn-sm btn-icon" title="Excluir" onClick={() => setConfirmExcluir(d)}><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <Pagination total={despesas.length} page={page} perPage={PER_PAGE} onChange={setPage} />
      </div>

      {/* ===== Modal cadastro/edição ===== */}
      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? 'Editar Conta' : 'Nova Conta'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalAberto(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSalvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
          </>
        }
      >
        <form onSubmit={handleSalvar}>
          <div className="form-group">
            <label className="form-label">Descrição</label>
            <input className="form-control" value={form.descricao} onChange={(e) => setF('descricao', e.target.value)} placeholder="Ex.: Conta de energia — junho" />
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Categoria <span className="required">*</span></label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select className="form-control" value={form.tipo} onChange={(e) => setF('tipo', e.target.value)} required>
                  <option value="">Selecione...</option>
                  {tipos.map(t => <option key={t.id} value={t.codigo}>{t.nome}</option>)}
                </select>
                <button type="button" className="btn btn-ghost btn-icon" title="Nova categoria" onClick={() => setCatModalOpen(true)}><Plus size={16} /></button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Imóvel <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>(opcional)</span></label>
              <select className="form-control" value={form.imovel_id} onChange={(e) => setF('imovel_id', e.target.value)}>
                <option value="">Geral (sem imóvel)</option>
                {imoveis.map(im => <option key={im.id} value={im.id}>{im.codigo} — {im.endereco}</option>)}
              </select>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Valor <span className="required">*</span></label>
              <MoneyInput value={form.valor} onChange={(v) => setF('valor', v)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Vencimento <span className="required">*</span></label>
              <input className="form-control" type="date" value={form.vencimento} onChange={(e) => setF('vencimento', e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Status <span className="required">*</span></label>
            <select className="form-control" value={form.status} onChange={(e) => setF('status', e.target.value)} required>
              <option value="pendente">Em aberto</option>
              <option value="pago">Pago</option>
              <option value="atrasado">Atrasado</option>
            </select>
          </div>
          {!editando && (
            <>
              <div className="form-group">
                <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={form.repetir} onChange={(e) => setF('repetir', e.target.checked)} />
                  Repetir esta conta nos próximos meses
                </label>
              </div>
              {form.repetir && (
                <div className="form-group">
                  <label className="form-label">Repetir por quantos meses?</label>
                  <input className="form-control" type="number" min={2} max={120} value={form.recorrencia_meses}
                    onChange={(e) => setF('recorrencia_meses', e.target.value)} style={{ maxWidth: 140 }} />
                  <div className="form-hint">
                    Serão criadas {form.recorrencia_meses || 0} contas (uma por mês), com o vencimento avançando mês a mês.
                  </div>
                </div>
              )}
            </>
          )}
          <div className="form-group">
            <label className="form-label">Observações</label>
            <textarea className="form-control" value={form.observacoes} onChange={(e) => setF('observacoes', e.target.value)} rows={2} />
          </div>
        </form>
      </Modal>

      {/* ===== Modal informar pagamento (dar baixa) ===== */}
      <Modal
        isOpen={!!pagAlvo}
        onClose={() => setPagAlvo(null)}
        title="Informar pagamento"
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPagAlvo(null)}>Cancelar</button>
            <button className="btn btn-success" onClick={handleConfirmarPagamento} disabled={pagSalvando}>
              {pagSalvando ? 'Confirmando...' : 'Confirmar pagamento'}
            </button>
          </>
        }
      >
        {pagAlvo && (
          <>
            {/* Resumo do lançamento */}
            <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                <div><span style={{ color: 'var(--gray-500)' }}>Conta:</span> <strong>{pagAlvo.descricao || labelTipo(pagAlvo.tipo)}</strong></div>
                <div><span style={{ color: 'var(--gray-500)' }}>Categoria:</span> {labelTipo(pagAlvo.tipo)}</div>
                <div><span style={{ color: 'var(--gray-500)' }}>Vencimento:</span> {formatData(pagAlvo.vencimento)}</div>
                <div><span style={{ color: 'var(--gray-500)' }}>Valor da conta:</span> <strong>{formatMoeda(pagAlvo.valor)}</strong></div>
                {pagJaPago > 0 && (
                  <div><span style={{ color: 'var(--gray-500)' }}>Já pago antes:</span> <strong style={{ color: 'var(--info)' }}>{formatMoeda(pagJaPago)}</strong></div>
                )}
              </div>
              <div className="form-hint" style={{ marginTop: 8 }}>
                Você pode fazer o pagamento total ou parcial. O valor restante fica em aberto.
              </div>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Data do pagamento <span className="required">*</span></label>
                <input className="form-control" type="date" value={pagForm.data_pagamento} onChange={(e) => setPF('data_pagamento', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Forma de pagamento</label>
                <select className="form-control" value={pagForm.forma_pagamento} onChange={(e) => setPF('forma_pagamento', e.target.value)}>
                  {FORMAS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Valor pago <span className="required">*</span></label>
                <MoneyInput value={pagForm.valor_pago} onChange={(v) => setPF('valor_pago', v)} />
              </div>
              <div className="form-group">
                <label className="form-label">Desconto</label>
                <MoneyInput value={pagForm.desconto} onChange={(v) => setPF('desconto', v)} />
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Juros</label>
                <MoneyInput value={pagForm.juros} onChange={(v) => setPF('juros', v)} />
              </div>
              <div className="form-group">
                <label className="form-label">Multa</label>
                <MoneyInput value={pagForm.multa} onChange={(v) => setPF('multa', v)} />
              </div>
            </div>

            {/* Totais */}
            <div style={{ borderTop: '1px solid var(--gray-200)', marginTop: 8, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <div>
                <div style={{ color: 'var(--gray-500)' }}>Total a pagar (c/ encargos)</div>
                <strong>{formatMoeda(pagTotalDevido)}</strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: 'var(--gray-500)' }}>{pagSaldo > 0.005 ? 'Ficará em aberto' : 'Saldo'}</div>
                <strong style={{ color: pagSaldo > 0.005 ? 'var(--warning)' : 'var(--success)' }}>
                  {formatMoeda(Math.max(0, pagSaldo))}
                </strong>
              </div>
            </div>
            {pagSaldo > 0.005 && (
              <div className="form-hint" style={{ marginTop: 6 }}>
                Pagamento <strong>parcial</strong>: a conta ficará como "Parcial" e o restante continua em aberto.
              </div>
            )}
          </>
        )}
      </Modal>

      <CategoriaManager
        isOpen={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        tipos={tipos}
        onChange={fetchTipos}
        toast={toast}
      />

      <ConfirmDialog
        isOpen={!!confirmExcluir}
        onClose={() => setConfirmExcluir(null)}
        onConfirm={() => handleExcluir(false)}
        title="Excluir Conta"
        message={
          confirmExcluir?.recorrencia_id
            ? 'Esta conta faz parte de uma série recorrente. Deseja excluir apenas esta ou toda a série?'
            : 'Tem certeza que deseja excluir esta conta?'
        }
        extraAction={
          confirmExcluir?.recorrencia_id
            ? { label: 'Excluir Série Toda', onClick: () => handleExcluir(true), className: 'btn-danger' }
            : undefined
        }
      />
    </div>
  );
}

// ============================================================
// Gerenciador de Categorias
// ============================================================
function CategoriaManager({ isOpen, onClose, tipos, onChange, toast }) {
  const [nova, setNova] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => { if (isOpen) setNova(''); }, [isOpen]);

  const adicionar = async (e) => {
    e?.preventDefault();
    if (!nova.trim()) return;
    setSalvando(true);
    try {
      await despesaTiposService.criar(nova.trim());
      setNova('');
      await onChange();
      toast.success('Categoria adicionada!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao adicionar categoria');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    try {
      await despesaTiposService.excluir(confirm.id);
      setConfirm(null);
      await onChange();
      toast.success('Categoria excluída!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Categorias de contas"
        footer={<button className="btn btn-ghost" onClick={onClose}>Fechar</button>}
      >
        <form onSubmit={adicionar} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input className="form-control" placeholder="Nova categoria (ex.: Internet, Salário, Material...)" value={nova} onChange={(e) => setNova(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={salvando}><Plus size={14} /> Adicionar</button>
        </form>
        {tipos.length === 0 ? (
          <p style={{ color: 'var(--gray-500)' }}>Nenhuma categoria cadastrada.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Categoria</th><th>Ações</th></tr></thead>
              <tbody>
                {tipos.map((t) => (
                  <tr key={t.id}>
                    <td>{t.nome}</td>
                    <td>
                      <button className="btn btn-outline-danger btn-sm btn-icon" onClick={() => setConfirm(t)} title="Excluir"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={excluir}
        title="Excluir categoria"
        message={`Excluir a categoria "${confirm?.nome}"? Contas já lançadas com ela não são afetadas.`}
      />
    </>
  );
}
