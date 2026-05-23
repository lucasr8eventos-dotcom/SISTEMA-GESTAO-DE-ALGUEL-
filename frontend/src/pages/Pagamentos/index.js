import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { pagamentosService, imoveisService, contratosService, inquilinosService, downloadBlob } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { MoneyInput } from '../../components/MaskedInput';
import Pagination, { PER_PAGE } from '../../components/Pagination';
import FilterBar from '../../components/filters/FilterBar';
import StatusPills from '../../components/filters/StatusPills';
import PeriodPicker from '../../components/filters/PeriodPicker';
import SearchInput from '../../components/filters/SearchInput';
import MetricCard from '../../components/MetricCard';
import { EmptyState, EmptyFiltered, ErrorState } from '../../components/StateViews';
import { formatMoeda, formatData, getMesAtual, getAnoAtual, MESES, formaPagamentoLabel } from '../../utils/format';
import { Pencil, Trash2, FileText, Banknote } from 'lucide-react';

const FORM_INICIAL = {
  mes: getMesAtual(), ano: getAnoAtual(), imovel_id: '', contrato_id: '',
  valor_aluguel: '', data_vencimento: '', data_pagamento: '', valor_recebido: '',
  forma_pagamento: '', status: 'pendente', observacoes: ''
};

const STATUS_OPTIONS = [
  { value: '', label: 'Todos', color: 'gray' },
  { value: 'pendente', label: 'Pendente', color: 'warning' },
  { value: 'pago', label: 'Pago', color: 'success' },
  { value: 'atrasado', label: 'Atrasado', color: 'danger' },
  { value: 'parcial', label: 'Parcial', color: 'info' }
];

const StatusBadge = ({ status }) => {
  const map = { pago: 'success', pendente: 'warning', atrasado: 'danger', parcial: 'info' };
  const label = { pago: 'Pago', pendente: 'Pendente', atrasado: 'Atrasado', parcial: 'Parcial' };
  return <span className={`badge badge-${map[status] || 'gray'}`}>{label[status] || status}</span>;
};

export default function Pagamentos() {
  const [pagamentos, setPagamentos] = useState([]);
  const [pagamentosAnterior, setPagamentosAnterior] = useState([]);
  const [imoveis, setImoveis] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [inquilinos, setInquilinos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [filtroMes, setFiltroMes] = useState(getMesAtual());
  const [filtroAno, setFiltroAno] = useState(getAnoAtual());
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroInquilino, setFiltroInquilino] = useState('');
  const [busca, setBusca] = useState('');
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

  const fetchPagamentos = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await pagamentosService.listar({
        mes: filtroMes || undefined,
        ano: filtroAno || undefined,
        status: filtroStatus || undefined,
        busca: busca || undefined
      });
      setPagamentos(res.data);
    } catch (err) {
      setErro(err.response?.data?.error || 'Não foi possível carregar os pagamentos.');
    } finally {
      setLoading(false);
    }
  }, [filtroMes, filtroAno, filtroStatus, busca]);

  // Pagamentos do mês anterior pra comparativo (sem afetar exibição)
  const fetchPagamentosAnterior = useCallback(async () => {
    if (!filtroMes || !filtroAno) { setPagamentosAnterior([]); return; }
    const m = parseInt(filtroMes);
    const a = parseInt(filtroAno);
    const mesAnt = m === 1 ? 12 : m - 1;
    const anoAnt = m === 1 ? a - 1 : a;
    try {
      const res = await pagamentosService.listar({ mes: mesAnt, ano: anoAnt });
      setPagamentosAnterior(res.data);
    } catch {
      setPagamentosAnterior([]);
    }
  }, [filtroMes, filtroAno]);

  useEffect(() => {
    const t = setTimeout(fetchPagamentos, 300);
    return () => clearTimeout(t);
  }, [fetchPagamentos]);

  useEffect(() => {
    const t = setTimeout(fetchPagamentosAnterior, 300);
    return () => clearTimeout(t);
  }, [fetchPagamentosAnterior]);

  useEffect(() => { setPage(1); }, [filtroMes, filtroAno, filtroStatus, filtroInquilino, busca]);

  useEffect(() => {
    Promise.all([
      imoveisService.listar(),
      contratosService.listar({ status: 'ativo' }),
      inquilinosService.listar()
    ])
      .then(([im, ct, inq]) => {
        setImoveis(im.data);
        setContratos(ct.data);
        setInquilinos(inq.data);
      })
      .catch(() => {});
  }, []);

  const abrirNovo = () => {
    setEditando(null);
    setForm({ ...FORM_INICIAL, mes: filtroMes || getMesAtual(), ano: filtroAno || getAnoAtual() });
    setModalAberto(true);
  };

  const abrirEditar = (p) => {
    setEditando(p.id);
    setForm({
      mes: p.mes, ano: p.ano, imovel_id: p.imovel_id || '',
      contrato_id: p.contrato_id || '',
      valor_aluguel: p.valor_aluguel || '',
      data_vencimento: p.data_vencimento ? p.data_vencimento.split('T')[0] : '',
      data_pagamento: p.data_pagamento ? p.data_pagamento.split('T')[0] : '',
      valor_recebido: p.valor_recebido || '',
      forma_pagamento: p.forma_pagamento || '',
      status: p.status || 'pendente',
      observacoes: p.observacoes || ''
    });
    setModalAberto(true);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    setSalvando(true);
    try {
      if (editando) {
        await pagamentosService.atualizar(editando, form);
        toast.success('Pagamento atualizado!');
      } else {
        await pagamentosService.criar(form);
        toast.success('Pagamento registrado!');
      }
      setModalAberto(false);
      fetchPagamentos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar pagamento');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async () => {
    try {
      await pagamentosService.excluir(confirmExcluir.id);
      toast.success('Pagamento excluído!');
      setConfirmExcluir(null);
      fetchPagamentos();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  const handleRecibo = async (id) => {
    try {
      const res = await pagamentosService.recibo(id);
      downloadBlob(res.data, `recibo-${id}.pdf`);
    } catch {
      toast.error('Erro ao gerar recibo');
    }
  };

  const handleRecibosLote = async () => {
    if (!filtroMes || !filtroAno) {
      toast.error('Selecione um período (mês e ano) para gerar os recibos');
      return;
    }
    try {
      const params = { mes: filtroMes, ano: filtroAno };
      if (filtroInquilino) params.inquilino_id = filtroInquilino;
      const res = await pagamentosService.recibosLote(params);
      const nomeArquivo = filtroInquilino
        ? `recibos-${filtroMes}-${filtroAno}-inq${filtroInquilino}.pdf`
        : `recibos-${filtroMes}-${filtroAno}.pdf`;
      downloadBlob(res.data, nomeArquivo);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao gerar recibos');
    }
  };

  const calcVencimento = (imovelId, mes, ano) => {
    const imovel = imoveis.find(im => String(im.id) === String(imovelId));
    if (!imovel || !imovel.dia_vencimento) return '';
    const dia = Math.min(imovel.dia_vencimento, new Date(ano, mes, 0).getDate());
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  };

  const setF = (campo, valor) => setForm(prev => {
    const next = { ...prev, [campo]: valor };
    if (campo === 'imovel_id') {
      next.contrato_id = '';
      next.valor_aluguel = '';
      next.data_vencimento = calcVencimento(valor, prev.mes || getMesAtual(), prev.ano || getAnoAtual());
    }
    if (campo === 'contrato_id' && valor) {
      const contrato = contratos.find(c => String(c.id) === String(valor));
      if (contrato) {
        next.valor_aluguel = contrato.valor || prev.valor_aluguel;
        next.data_vencimento = calcVencimento(contrato.imovel_id, prev.mes || getMesAtual(), prev.ano || getAnoAtual());
      }
    }
    if ((campo === 'mes' || campo === 'ano') && prev.imovel_id) {
      const mes = campo === 'mes' ? valor : prev.mes;
      const ano = campo === 'ano' ? valor : prev.ano;
      next.data_vencimento = calcVencimento(prev.imovel_id, mes, ano);
    }
    return next;
  });

  // ===== Filtro por inquilino (cliente) =====
  const pagamentosFiltrados = useMemo(() => {
    if (!filtroInquilino) return pagamentos;
    return pagamentos.filter((p) => {
      const c = contratos.find((ct) => ct.id === p.contrato_id);
      return c && String(c.inquilino_id) === String(filtroInquilino);
    });
  }, [pagamentos, filtroInquilino, contratos]);

  // ===== Stats =====
  const stats = useMemo(() => {
    const counts = { pago: 0, pendente: 0, atrasado: 0, parcial: 0 };
    let totalReceber = 0, totalRecebido = 0;
    pagamentosFiltrados.forEach((p) => {
      counts[p.status] = (counts[p.status] || 0) + 1;
      totalReceber += parseFloat(p.valor_aluguel || 0);
      if (p.status === 'pago') totalRecebido += parseFloat(p.valor_recebido || p.valor_aluguel || 0);
      else if (p.status === 'parcial') totalRecebido += parseFloat(p.valor_recebido || 0);
    });
    const totalParcial = pagamentosFiltrados
      .filter((p) => p.status === 'parcial')
      .reduce((s, p) => s + parseFloat(p.valor_aluguel || 0), 0);
    const pagoParcial = pagamentosFiltrados
      .filter((p) => p.status === 'parcial')
      .reduce((s, p) => s + parseFloat(p.valor_recebido || 0), 0);
    return { counts, totalReceber, totalRecebido, totalParcial, pagoParcial };
  }, [pagamentosFiltrados]);

  // ===== Comparativo com mês anterior =====
  const variacoes = useMemo(() => {
    const recAnt = pagamentosAnterior
      .filter((p) => p.status === 'pago' || p.status === 'parcial')
      .reduce((s, p) => s + parseFloat(p.valor_recebido || p.valor_aluguel || 0), 0);
    const totAnt = pagamentosAnterior.reduce((s, p) => s + parseFloat(p.valor_aluguel || 0), 0);
    const atrAnt = pagamentosAnterior.filter((p) => p.status === 'atrasado').length;
    const pct = (atual, anterior) => {
      if (!anterior) return null;
      return ((atual - anterior) / anterior) * 100;
    };
    return {
      receber: pct(stats.totalReceber, totAnt),
      recebido: pct(stats.totalRecebido, recAnt),
      atrasados: pct(stats.counts.atrasado, atrAnt)
    };
  }, [pagamentosAnterior, stats]);

  // ===== Pagination =====
  const paginatedPagamentos = pagamentosFiltrados.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const rowClass = (status) => {
    if (status === 'pago') return 'row-success';
    if (status === 'atrasado') return 'row-danger';
    if (status === 'parcial') return 'row-warn';
    return '';
  };

  const hasFiltrosAtivos =
    !!filtroStatus || !!filtroInquilino || !!busca ||
    !!(filtroMes && filtroAno && (filtroMes !== getMesAtual() || filtroAno !== getAnoAtual()));

  const limparFiltros = () => {
    setFiltroMes(getMesAtual());
    setFiltroAno(getAnoAtual());
    setFiltroStatus('');
    setFiltroInquilino('');
    setBusca('');
  };

  const hasDadosCadastrados = pagamentos.length > 0 || !!filtroStatus || !!busca; // heurística: se NÃO tem nada no mês atual sem filtros, pode ser que não tem cadastrados

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Pagamentos</h1>
          <p>Controle mensal de aluguéis</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-ghost"
            onClick={handleRecibosLote}
            title={filtroInquilino ? 'Gerar PDF dos recibos do inquilino no mês' : 'Gerar PDF de todos os recibos pagos do mês'}
            disabled={!filtroMes || !filtroAno}
          >
            <FileText size={14} /> {filtroInquilino ? 'Recibos do Inquilino' : 'Recibos do Mês'}
          </button>
          <button className="btn btn-primary" onClick={abrirNovo}>+ Registrar Pagamento</button>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="metrics-grid">
        <MetricCard
          label="Total a Receber"
          value={formatMoeda(stats.totalReceber)}
          color="var(--info)"
          variation={variacoes.receber}
          active={!filtroStatus}
          onClick={() => setFiltroStatus('')}
        />
        <MetricCard
          label="Total Recebido"
          value={formatMoeda(stats.totalRecebido)}
          color="var(--success)"
          variation={variacoes.recebido}
          active={filtroStatus === 'pago'}
          onClick={() => setFiltroStatus(filtroStatus === 'pago' ? '' : 'pago')}
        />
        <MetricCard
          label="Em Aberto"
          value={formatMoeda(stats.totalReceber - stats.totalRecebido)}
          color="var(--danger)"
          active={filtroStatus === 'pendente'}
          onClick={() => setFiltroStatus(filtroStatus === 'pendente' ? '' : 'pendente')}
        />
        <MetricCard
          label="Atrasados"
          value={stats.counts.atrasado}
          color="var(--danger)"
          variation={variacoes.atrasados}
          active={filtroStatus === 'atrasado'}
          onClick={() => setFiltroStatus(filtroStatus === 'atrasado' ? '' : 'atrasado')}
        />
        {stats.counts.parcial > 0 && (
          <MetricCard
            label={`Parcial (${stats.counts.parcial})`}
            value={formatMoeda(stats.pagoParcial)}
            color="var(--info)"
            progress={{ pago: stats.pagoParcial, total: stats.totalParcial }}
            hint={`de ${formatMoeda(stats.totalParcial)} totais`}
            active={filtroStatus === 'parcial'}
            onClick={() => setFiltroStatus(filtroStatus === 'parcial' ? '' : 'parcial')}
          />
        )}
      </div>

      {/* Filtros */}
      <FilterBar hasActive={hasFiltrosAtivos} onClear={limparFiltros}>
        <PeriodPicker
          mes={filtroMes}
          ano={filtroAno}
          onChange={({ mes, ano }) => { setFiltroMes(mes); setFiltroAno(ano); }}
        />
        <SearchInput
          value={busca}
          onChange={setBusca}
          placeholder="Buscar imóvel ou inquilino..."
          label="Busca"
        />
        <div className="filter-field">
          <label className="filter-label">Inquilino</label>
          <select className="form-control" value={filtroInquilino} onChange={(e) => setFiltroInquilino(e.target.value)}>
            <option value="">Todos</option>
            {inquilinos.map((inq) => <option key={inq.id} value={inq.id}>{inq.nome}</option>)}
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

      {/* Erro */}
      {erro && <ErrorState message={erro} onRetry={fetchPagamentos} />}

      <div className="card">
        <div className="table-wrapper">
          {loading ? (
            <div className="loading-spinner"><div className="spinner" /></div>
          ) : pagamentosFiltrados.length === 0 ? (
            hasFiltrosAtivos || hasDadosCadastrados ? (
              <EmptyFiltered onClear={limparFiltros} icon={<Banknote size={48} />} />
            ) : (
              <EmptyState
                icon={<Banknote size={48} />}
                title="Nenhum pagamento cadastrado"
                message="Comece registrando o primeiro pagamento do mês."
                action={
                  <button className="btn btn-primary" onClick={abrirNovo}>
                    + Registrar primeiro pagamento
                  </button>
                }
              />
            )
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Mês/Ano</th>
                  <th>Imóvel</th>
                  <th>Inquilino</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Pagamento</th>
                  <th>Recebido</th>
                  <th>Forma</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPagamentos.map((p) => (
                  <tr key={p.id} className={rowClass(p.status)}>
                    <td>{p.mes}/{p.ano}</td>
                    <td>
                      <strong>{p.imovel_codigo}</strong>
                      <div style={{ fontSize: 12, color: 'var(--gray-500)', maxWidth: 160 }}>{p.imovel_endereco}</div>
                    </td>
                    <td>{p.inquilino_nome || '—'}</td>
                    <td>{formatMoeda(p.valor_aluguel)}</td>
                    <td>{formatData(p.data_vencimento)}</td>
                    <td>{formatData(p.data_pagamento)}</td>
                    <td>{p.valor_recebido ? formatMoeda(p.valor_recebido) : '—'}</td>
                    <td>{p.forma_pagamento ? formaPagamentoLabel(p.forma_pagamento) : '—'}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>
                      <div className="table-actions">
                        {(p.status === 'pago' || p.status === 'parcial') && (
                          <button className="btn btn-ghost btn-sm btn-icon" title="Gerar Recibo" onClick={() => handleRecibo(p.id)}><FileText size={14} /></button>
                        )}
                        <button className="btn btn-ghost btn-sm btn-icon" title="Editar" onClick={() => abrirEditar(p)}><Pencil size={14} /></button>
                        {isAdmin && (
                          <button className="btn btn-outline-danger btn-sm btn-icon" title="Excluir" onClick={() => setConfirmExcluir(p)}><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination total={pagamentosFiltrados.length} page={page} perPage={PER_PAGE} onChange={setPage} />
      </div>

      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? 'Editar Pagamento' : 'Registrar Pagamento'}
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
          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Mês <span className="required">*</span></label>
              <select className="form-control" value={form.mes} onChange={(e) => setF('mes', e.target.value)} required>
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Ano <span className="required">*</span></label>
              <select className="form-control" value={form.ano} onChange={(e) => setF('ano', e.target.value)} required>
                {Array.from({ length: 5 }, (_, i) => getAnoAtual() - 2 + i).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Status <span className="required">*</span></label>
              <select className="form-control" value={form.status} onChange={(e) => setF('status', e.target.value)} required>
                <option value="pendente">Pendente</option>
                <option value="pago">Pago</option>
                <option value="atrasado">Atrasado</option>
                <option value="parcial">Parcial</option>
              </select>
            </div>
          </div>

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
                {contratos
                  .filter(c => !form.imovel_id || String(c.imovel_id) === String(form.imovel_id))
                  .map(c => <option key={c.id} value={c.id}>{c.imovel_codigo} — {c.inquilino_nome}</option>)
                }
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Valor do Aluguel <span className="required">*</span></label>
              <MoneyInput value={form.valor_aluguel} onChange={(v) => setF('valor_aluguel', v)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Data de Vencimento <span className="required">*</span></label>
              <input className="form-control" type="date" value={form.data_vencimento} onChange={(e) => setF('data_vencimento', e.target.value)} required />
            </div>
          </div>

          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Data do Pagamento</label>
              <input className="form-control" type="date" value={form.data_pagamento} onChange={(e) => setF('data_pagamento', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Valor Recebido</label>
              <MoneyInput value={form.valor_recebido} onChange={(v) => setF('valor_recebido', v)} />
            </div>
            <div className="form-group">
              <label className="form-label">Forma de Pagamento</label>
              <select className="form-control" value={form.forma_pagamento} onChange={(e) => setF('forma_pagamento', e.target.value)}>
                <option value="">Selecione...</option>
                <option value="pix">PIX</option>
                <option value="transferencia">Transferência</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="boleto">Boleto</option>
                <option value="cartao">Cartão</option>
              </select>
            </div>
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
        title="Excluir Pagamento"
        message="Tem certeza que deseja excluir este registro de pagamento?"
      />
    </div>
  );
}
