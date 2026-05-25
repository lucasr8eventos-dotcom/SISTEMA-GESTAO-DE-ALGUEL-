import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { despesasService, imoveisService, downloadBlob } from '../../services/api';
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
import { Pencil, Trash2, Receipt, AlertTriangle, FileText, FileSpreadsheet } from 'lucide-react';

const FORM_INICIAL = {
  imovel_id: '', tipo: 'iptu', valor: '', vencimento: '',
  status: 'pendente', descricao: '', observacoes: '', recorrencia: 'nenhuma'
};

const STATUS_OPTIONS = [
  { value: '', label: 'Todos', color: 'gray' },
  { value: 'pendente', label: 'Pendente', color: 'warning' },
  { value: 'pago', label: 'Pago', color: 'success' },
  { value: 'atrasado', label: 'Atrasado', color: 'danger' }
];

const ALERTA_DIAS = 5;

const diasAteVencimento = (d) => {
  if (!d) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = new Date(d); venc.setHours(0, 0, 0, 0);
  return Math.ceil((venc - hoje) / 86400000);
};

export default function Despesas() {
  const [despesas, setDespesas] = useState([]);
  const [despesasAnterior, setDespesasAnterior] = useState([]);
  const [imoveis, setImoveis] = useState([]);
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
  const toast = useToast();
  const { isAdmin } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const s = params.get('status');
    if (s) setFiltroStatus(s);
  }, [location.search]);

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
      setErro(err.response?.data?.error || 'Não foi possível carregar as despesas.');
    } finally {
      setLoading(false);
    }
  }, [filtroStatus, filtroTipo, filtroImovel, filtroMes, filtroAno]);

  const fetchDespesasAnterior = useCallback(async () => {
    if (!filtroMes || !filtroAno) { setDespesasAnterior([]); return; }
    const m = parseInt(filtroMes);
    const a = parseInt(filtroAno);
    const mesAnt = m === 1 ? 12 : m - 1;
    const anoAnt = m === 1 ? a - 1 : a;
    try {
      const res = await despesasService.listar({ mes: mesAnt, ano: anoAnt });
      setDespesasAnterior(res.data);
    } catch {
      setDespesasAnterior([]);
    }
  }, [filtroMes, filtroAno]);

  useEffect(() => { fetchDespesas(); }, [fetchDespesas]);
  useEffect(() => { fetchDespesasAnterior(); }, [fetchDespesasAnterior]);
  useEffect(() => { setPage(1); }, [filtroStatus, filtroTipo, filtroImovel, filtroMes, filtroAno]);
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
      observacoes: d.observacoes || '',
      recorrencia: 'nenhuma' // ao editar, não regera futuros
    });
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      if (editando) {
        const { recorrencia, ...dados } = form;
        await despesasService.atualizar(editando, dados);
        toast.success('Despesa atualizada!');
      } else {
        await despesasService.criar(form);
        if (form.recorrencia && form.recorrencia !== 'nenhuma') {
          const total = form.recorrencia === 'mensal' ? 12 : 2;
          const unidade = form.recorrencia === 'mensal' ? 'mensais' : 'anuais';
          toast.success(`Despesa cadastrada — ${total} ocorrências ${unidade} geradas`);
        } else {
          toast.success('Despesa cadastrada!');
        }
      }
      setModalAberto(false);
      fetchDespesas();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar despesa');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async (excluirSerie = false) => {
    try {
      const params = excluirSerie ? { excluir_serie: true } : undefined;
      await despesasService.excluir(confirmExcluir.id, params);
      toast.success(excluirSerie ? 'Série de despesas excluída!' : 'Despesa excluída!');
      setConfirmExcluir(null);
      fetchDespesas();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  const handleExportar = async (formato) => {
    try {
      const params = {
        status: filtroStatus || undefined,
        tipo: filtroTipo || undefined,
        imovel_id: filtroImovel || undefined,
        mes: filtroMes || undefined,
        ano: filtroAno || undefined
      };
      const res = await despesasService.exportar(formato, params);
      const ext = formato === 'excel' ? 'xlsx' : 'pdf';
      const stamp = new Date().toISOString().split('T')[0];
      downloadBlob(res.data, `despesas-${stamp}.${ext}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao exportar');
    }
  };

  const setF = (campo, valor) => setForm(prev => ({ ...prev, [campo]: valor }));

  // ===== Stats =====
  const stats = useMemo(() => {
    const counts = { pendente: 0, pago: 0, atrasado: 0 };
    let total = 0, pago = 0, pendente = 0, atrasado = 0, proximas = 0;
    despesas.forEach((d) => {
      counts[d.status] = (counts[d.status] || 0) + 1;
      const valor = parseFloat(d.valor || 0);
      total += valor;
      if (d.status === 'pago') pago += valor;
      else if (d.status === 'pendente') pendente += valor;
      else if (d.status === 'atrasado') atrasado += valor;
      // Próximas a vencer
      const dias = diasAteVencimento(d.vencimento);
      if (d.status === 'pendente' && dias !== null && dias >= 0 && dias <= ALERTA_DIAS) {
        proximas += 1;
      }
    });
    return { counts, total, pago, pendente, atrasado, proximas };
  }, [despesas]);

  const variacoes = useMemo(() => {
    const totAnt = despesasAnterior.reduce((s, d) => s + parseFloat(d.valor || 0), 0);
    const pagAnt = despesasAnterior.filter(d => d.status === 'pago').reduce((s, d) => s + parseFloat(d.valor || 0), 0);
    const atrAnt = despesasAnterior.filter(d => d.status === 'atrasado').length;
    const pct = (atual, anterior) => {
      if (!anterior) return null;
      return ((atual - anterior) / anterior) * 100;
    };
    return {
      total: pct(stats.total, totAnt),
      pago: pct(stats.pago, pagAnt),
      atrasados: pct(stats.counts.atrasado, atrAnt)
    };
  }, [despesasAnterior, stats]);

  const paginatedDespesas = despesas.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const hasFiltrosAtivos =
    !!filtroStatus || !!filtroTipo || !!filtroImovel || !!filtroMes || !!filtroAno;

  const limparFiltros = () => {
    setFiltroStatus('');
    setFiltroTipo('');
    setFiltroImovel('');
    setFiltroMes('');
    setFiltroAno('');
  };

  const rowClassDespesa = (d) => {
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
          <h1>Despesas</h1>
          <p>{despesas.length} despesa(s) encontrada(s)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => handleExportar('excel')} title="Exportar para Excel">
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button className="btn btn-ghost" onClick={() => handleExportar('pdf')} title="Exportar para PDF">
            <FileText size={14} /> PDF
          </button>
          <button className="btn btn-primary" onClick={abrirNovo}>+ Nova Despesa</button>
        </div>
      </div>

      {/* Cards */}
      <div className="metrics-grid">
        <MetricCard
          label="Total"
          value={formatMoeda(stats.total)}
          color="var(--info)"
          variation={variacoes.total}
          active={!filtroStatus}
          onClick={() => setFiltroStatus('')}
        />
        <MetricCard
          label="Pago"
          value={formatMoeda(stats.pago)}
          color="var(--success)"
          variation={variacoes.pago}
          active={filtroStatus === 'pago'}
          onClick={() => setFiltroStatus(filtroStatus === 'pago' ? '' : 'pago')}
        />
        <MetricCard
          label="Pendente"
          value={formatMoeda(stats.pendente)}
          color="var(--warning)"
          hint={
            (filtroStatus === '' || filtroStatus === 'pendente') && stats.proximas > 0
              ? `${stats.proximas} venc. em ${ALERTA_DIAS} dias`
              : null
          }
          active={filtroStatus === 'pendente'}
          onClick={() => setFiltroStatus(filtroStatus === 'pendente' ? '' : 'pendente')}
        />
        <MetricCard
          label="Atrasado"
          value={formatMoeda(stats.atrasado)}
          color="var(--danger)"
          variation={variacoes.atrasados}
          active={filtroStatus === 'atrasado'}
          onClick={() => setFiltroStatus(filtroStatus === 'atrasado' ? '' : 'atrasado')}
        />
      </div>

      {/* Filtros */}
      <FilterBar hasActive={hasFiltrosAtivos} onClear={limparFiltros}>
        <PeriodPicker
          mes={filtroMes}
          ano={filtroAno}
          onChange={({ mes, ano }) => { setFiltroMes(mes); setFiltroAno(ano); }}
        />
        <div className="filter-field">
          <label className="filter-label">Imóvel</label>
          <select className="form-control" value={filtroImovel} onChange={(e) => setFiltroImovel(e.target.value)}>
            <option value="">Todos</option>
            {imoveis.map(im => <option key={im.id} value={im.id}>{im.codigo} — {im.endereco}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo</label>
          <select className="form-control" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="iptu">IPTU</option>
            <option value="condominio">Condomínio</option>
            <option value="agua">Água</option>
            <option value="energia">Energia</option>
            <option value="manutencao">Manutenção</option>
            <option value="seguro">Seguro</option>
            <option value="outros">Outros</option>
          </select>
        </div>
        <div className="filter-field filter-field-full">
          <label className="filter-label">Status</label>
          <StatusPills
            options={STATUS_OPTIONS}
            value={filtroStatus}
            onChange={setFiltroStatus}
            counts={stats.counts}
          />
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
                title="Nenhuma despesa cadastrada"
                message="Comece registrando a primeira despesa do seu negócio."
                action={
                  <button className="btn btn-primary" onClick={abrirNovo}>
                    + Registrar primeira despesa
                  </button>
                }
              />
            )
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
                {paginatedDespesas.map((d) => {
                  const st = statusDespesa(d.status);
                  const dias = diasAteVencimento(d.vencimento);
                  const proximo = d.status === 'pendente' && dias !== null && dias >= 0 && dias <= ALERTA_DIAS;
                  return (
                    <tr key={d.id} className={rowClassDespesa(d)}>
                      <td>
                        <strong>{d.imovel_codigo}</strong>
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{d.imovel_endereco}</div>
                      </td>
                      <td><span className="chip">{tipoDespesaLabel(d.tipo)}</span></td>
                      <td>{d.descricao || '—'}</td>
                      <td>{formatMoeda(d.valor)}</td>
                      <td>
                        {formatData(d.vencimento)}
                        {proximo && (
                          <span className="badge badge-warning" style={{ marginLeft: 6, fontSize: 11 }}>
                            <AlertTriangle size={10} style={{ verticalAlign: 'middle' }} /> {dias === 0 ? 'Hoje' : `${dias}d`}
                          </span>
                        )}
                      </td>
                      <td><span className={`badge ${st.className}`}>{st.label}</span></td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => abrirEditar(d)}><Pencil size={14} /></button>
                          {isAdmin && <button className="btn btn-outline-danger btn-sm btn-icon" onClick={() => setConfirmExcluir(d)}><Trash2 size={14} /></button>}
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

      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? 'Editar Despesa' : 'Nova Despesa'}
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
              <MoneyInput value={form.valor} onChange={(v) => setF('valor', v)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Vencimento <span className="required">*</span></label>
              <input className="form-control" type="date" value={form.vencimento} onChange={(e) => setF('vencimento', e.target.value)} required />
            </div>
          </div>
          {!editando && (
            <div className="form-group">
              <label className="form-label">Recorrência</label>
              <select className="form-control" value={form.recorrencia} onChange={(e) => setF('recorrencia', e.target.value)}>
                <option value="nenhuma">Sem recorrência</option>
                <option value="mensal">Mensal (gera 12 ocorrências)</option>
                <option value="anual">Anual (gera 2 ocorrências)</option>
              </select>
              <div className="form-hint">
                Se marcar recorrência, despesas futuras serão criadas automaticamente com vencimento progressivo.
              </div>
            </div>
          )}
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
        onConfirm={() => handleExcluir(false)}
        title="Excluir Despesa"
        message={
          confirmExcluir?.recorrencia_id
            ? 'Esta despesa faz parte de uma série recorrente. Deseja excluir apenas esta ou toda a série?'
            : 'Tem certeza que deseja excluir esta despesa?'
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
