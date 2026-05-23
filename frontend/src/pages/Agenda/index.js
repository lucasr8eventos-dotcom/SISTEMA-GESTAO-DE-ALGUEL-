import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  pagamentosService, contratosService, reajustesService, despesasService, imoveisService
} from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { MESES, formatData } from '../../utils/format';
import {
  ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, List,
  Pencil, Trash2, Home, FileText, TrendingUp, Receipt, MapPin
} from 'lucide-react';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const STORAGE_KEY = 'agenda_eventos_manuais';

const TIPOS_MANUAIS = [
  { value: 'vistoria_entrada', label: 'Vistoria de Entrada' },
  { value: 'vistoria_saida', label: 'Vistoria de Saída' },
  { value: 'visita', label: 'Visita' },
  { value: 'manutencao', label: 'Manutenção' },
  { value: 'reuniao', label: 'Reunião' },
  { value: 'outro', label: 'Outro' }
];

const FORM_MANUAL_INICIAL = {
  titulo: '', data: '', hora: '', imovel_id: '', tipo: 'visita', descricao: ''
};

// ============================================================
// Helpers
// ============================================================
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const parseDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

const isoFromDate = (d) => d.toISOString().split('T')[0];

const diasEntre = (a, b) => Math.ceil((a.getTime() - b.getTime()) / 86400000);

// ============================================================
// Geradores de eventos automáticos
// ============================================================
const gerarEventosPagamentos = (pagamentos) => {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return pagamentos
    .map((p) => {
      const data = parseDate(p.data_vencimento);
      if (!data) return null;
      const pago = p.status === 'pago' || p.data_pagamento;
      let cor, status;
      if (pago) { cor = 'cinza'; status = 'concluido'; }
      else if (data < hoje) { cor = 'vermelho'; status = 'atrasado'; }
      else { cor = 'azul'; status = 'pendente'; }
      return {
        id: `pag-${p.id}`,
        tipo: 'aluguel',
        titulo: `Aluguel — ${p.imovel_codigo || 'Imóvel'} / ${p.inquilino_nome || 'Inquilino'}`,
        data,
        cor,
        status,
        navegar: `/pagamentos?imovel=${p.imovel_id || ''}&mes=${p.mes || ''}&ano=${p.ano || ''}`,
        meta: { imovel_id: p.imovel_id }
      };
    })
    .filter(Boolean);
};

const gerarEventosContratos = (contratos) => {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const renovados = new Set(); // Imóveis que têm contrato ativo mais recente
  contratos.forEach((c) => {
    if (c.status === 'ativo' && c.imovel_id) renovados.add(c.imovel_id);
  });

  return contratos
    .map((c) => {
      const data = parseDate(c.data_fim);
      if (!data) return null;
      const dias = diasEntre(data, hoje);
      let cor, status;
      if (c.status === 'encerrado' && renovados.has(c.imovel_id)) {
        cor = 'cinza'; status = 'concluido';
      } else if (dias < 0) {
        cor = 'vermelho'; status = 'atrasado';
      } else if (dias <= 30) {
        cor = 'amarelo'; status = 'pendente';
      } else {
        cor = 'amarelo'; status = 'pendente';
      }
      return {
        id: `cont-${c.id}`,
        tipo: 'contrato',
        titulo: `Contrato — ${c.imovel_codigo || 'Imóvel'} / ${c.inquilino_nome || 'Inquilino'}`,
        data,
        cor,
        status,
        navegar: `/contratos?id=${c.id}`,
        meta: { imovel_id: c.imovel_id, contrato_id: c.id }
      };
    })
    .filter(Boolean);
};

const gerarEventosReajustes = (reajustes) => {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return reajustes
    .map((r) => {
      const data = parseDate(r.data_proximo);
      if (!data) return null;
      let cor, status;
      if (r.status === 'aplicado') { cor = 'cinza'; status = 'concluido'; }
      else if (data < hoje) { cor = 'vermelho'; status = 'atrasado'; }
      else { cor = 'amarelo'; status = 'pendente'; }
      return {
        id: `reaj-${r.id}`,
        tipo: 'reajuste',
        titulo: `Reajuste — ${r.imovel_codigo || 'Imóvel'} / ${r.inquilino_nome || 'Inquilino'}`,
        data,
        cor,
        status,
        navegar: `/contratos?reajuste=${r.id}`,
        meta: { imovel_id: r.imovel_id, contrato_id: r.contrato_id }
      };
    })
    .filter(Boolean);
};

const gerarEventosDespesas = (despesas) => {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return despesas
    .map((d) => {
      // Tabela despesas usa "vencimento" (não data_vencimento) e não tem data_pagamento
      const data = parseDate(d.vencimento || d.data_vencimento);
      if (!data) return null;
      const paga = d.status === 'pago';
      let cor, status;
      if (paga) { cor = 'cinza'; status = 'concluido'; }
      else if (data < hoje) { cor = 'vermelho'; status = 'atrasado'; }
      else { cor = 'laranja'; status = 'pendente'; }
      return {
        id: `desp-${d.id}`,
        tipo: 'despesa',
        titulo: `Despesa — ${d.tipo || 'Outro'} / ${d.imovel_codigo || 'Geral'}`,
        data,
        cor,
        status,
        navegar: `/despesas`,
        meta: { imovel_id: d.imovel_id }
      };
    })
    .filter(Boolean);
};

const carregarManuais = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const salvarManuais = (lista) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lista)); } catch {}
};

const tipoIcon = (tipo) => {
  const map = {
    aluguel: <Home size={14} />,
    contrato: <FileText size={14} />,
    reajuste: <TrendingUp size={14} />,
    despesa: <Receipt size={14} />,
    manual: <MapPin size={14} />
  };
  return map[tipo] || null;
};

// ============================================================
// Componente principal
// ============================================================
export default function Agenda() {
  const [auto, setAuto] = useState([]);
  const [manuais, setManuais] = useState(carregarManuais());
  const [loading, setLoading] = useState(true);
  const [imoveis, setImoveis] = useState([]);
  const [mesAtual, setMesAtual] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [view, setView] = useState('calendario');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroImovel, setFiltroImovel] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState(FORM_MANUAL_INICIAL);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();

  const fetchAuto = useCallback(async () => {
    setLoading(true);
    try {
      const [pgs, cts, rjs, dps, ims] = await Promise.all([
        pagamentosService.listar().catch(() => ({ data: [] })),
        contratosService.listar().catch(() => ({ data: [] })),
        reajustesService.listar().catch(() => ({ data: [] })),
        despesasService.listar().catch(() => ({ data: [] })),
        imoveisService.listar().catch(() => ({ data: [] }))
      ]);
      setImoveis(ims.data);
      setAuto([
        ...gerarEventosPagamentos(pgs.data),
        ...gerarEventosContratos(cts.data),
        ...gerarEventosReajustes(rjs.data),
        ...gerarEventosDespesas(dps.data)
      ]);
    } catch {
      toast.error('Erro ao carregar agenda');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAuto(); }, [fetchAuto]);

  const manuaisComoEventos = useMemo(() => manuais.map((m) => {
    const data = parseDate(m.data);
    return {
      ...m,
      tipo: 'manual',
      data,
      cor: 'verde',
      status: 'pendente',
      titulo: m.titulo,
      meta: { imovel_id: m.imovel_id, manual: true }
    };
  }), [manuais]);

  const todosEventos = useMemo(() => [...auto, ...manuaisComoEventos], [auto, manuaisComoEventos]);

  const eventosFiltrados = useMemo(() => {
    return todosEventos.filter((ev) => {
      if (filtroTipo && ev.tipo !== filtroTipo) return false;
      if (filtroStatus && ev.status !== filtroStatus) return false;
      if (filtroImovel && String(ev.meta?.imovel_id) !== String(filtroImovel)) return false;
      return true;
    });
  }, [todosEventos, filtroTipo, filtroStatus, filtroImovel]);

  // ===== Calendário =====
  const diasDoMes = useMemo(() => {
    const ano = mesAtual.getFullYear();
    const mes = mesAtual.getMonth();
    const primeiroDia = new Date(ano, mes, 1).getDay();
    const ultimoDiaMes = new Date(ano, mes + 1, 0).getDate();
    const dias = [];
    for (let i = 0; i < primeiroDia; i++) dias.push(null);
    for (let d = 1; d <= ultimoDiaMes; d++) dias.push(new Date(ano, mes, d));
    while (dias.length % 7 !== 0) dias.push(null);
    return dias;
  }, [mesAtual]);

  const eventosPorDia = useMemo(() => {
    const map = new Map();
    eventosFiltrados.forEach((ev) => {
      if (!ev.data) return;
      const key = isoFromDate(ev.data);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    });
    return map;
  }, [eventosFiltrados]);

  const eventosOrdenados = useMemo(() => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    return [...eventosFiltrados].sort((a, b) => {
      // Atrasados primeiro
      if (a.status === 'atrasado' && b.status !== 'atrasado') return -1;
      if (b.status === 'atrasado' && a.status !== 'atrasado') return 1;
      // Concluídos por último
      if (a.status === 'concluido' && b.status !== 'concluido') return 1;
      if (b.status === 'concluido' && a.status !== 'concluido') return -1;
      return (a.data?.getTime() || 0) - (b.data?.getTime() || 0);
    });
  }, [eventosFiltrados]);

  const navegarMes = (delta) => {
    setMesAtual((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };

  // ===== Eventos manuais =====
  const abrirNovoManual = () => {
    setEditandoId(null);
    setForm(FORM_MANUAL_INICIAL);
    setModalAberto(true);
  };

  const abrirEditarManual = (m) => {
    setEditandoId(m.id);
    setForm({
      titulo: m.titulo || '',
      data: m.data || '',
      hora: m.hora || '',
      imovel_id: m.imovel_id || '',
      tipo: m.tipo || 'visita',
      descricao: m.descricao || ''
    });
    setModalAberto(true);
  };

  const handleSalvarManual = (e) => {
    e.preventDefault();
    if (!form.titulo || !form.data) {
      toast.error('Título e data são obrigatórios');
      return;
    }
    if (editandoId) {
      const novos = manuais.map((m) => m.id === editandoId ? { ...m, ...form } : m);
      setManuais(novos);
      salvarManuais(novos);
      toast.success('Evento atualizado');
    } else {
      const novo = { ...form, id: `manual-${Date.now()}` };
      const novos = [...manuais, novo];
      setManuais(novos);
      salvarManuais(novos);
      toast.success('Evento criado');
    }
    setModalAberto(false);
  };

  const handleExcluirManual = () => {
    const novos = manuais.filter((m) => m.id !== confirmExcluir.id);
    setManuais(novos);
    salvarManuais(novos);
    setConfirmExcluir(null);
    toast.success('Evento excluído');
  };

  const clicarEvento = (ev) => {
    if (ev.tipo === 'manual') {
      abrirEditarManual(ev);
    } else {
      navigate(ev.navegar);
    }
  };

  const setF = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Agenda</h1>
          <p>{eventosFiltrados.length} evento(s)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="agenda-view-toggle">
            <button
              type="button"
              className={`agenda-view-btn${view === 'calendario' ? ' active' : ''}`}
              onClick={() => setView('calendario')}
              title="Calendário"
            ><CalendarIcon size={16} /></button>
            <button
              type="button"
              className={`agenda-view-btn${view === 'lista' ? ' active' : ''}`}
              onClick={() => setView('lista')}
              title="Lista"
            ><List size={16} /></button>
          </div>
          <button className="btn btn-primary" onClick={abrirNovoManual}>
            <Plus size={16} /> Novo Evento
          </button>
        </div>
      </div>

      <div className="filters-row">
        <select className="form-control filter-select" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="aluguel">Aluguel</option>
          <option value="contrato">Contrato</option>
          <option value="reajuste">Reajuste</option>
          <option value="despesa">Despesa</option>
          <option value="manual">Manual</option>
        </select>
        <select className="form-control filter-select" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="atrasado">Em atraso</option>
          <option value="concluido">Concluído</option>
        </select>
        <select className="form-control filter-select" value={filtroImovel} onChange={(e) => setFiltroImovel(e.target.value)}>
          <option value="">Todos os imóveis</option>
          {imoveis.map((im) => (
            <option key={im.id} value={im.id}>{im.codigo} — {im.endereco}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : view === 'calendario' ? (
        <div className="card">
          <div className="agenda-cal-header">
            <button className="btn btn-ghost btn-icon" onClick={() => navegarMes(-1)}><ChevronLeft size={18} /></button>
            <h3 style={{ margin: 0, fontSize: 18 }}>
              {MESES[mesAtual.getMonth()]} de {mesAtual.getFullYear()}
            </h3>
            <button className="btn btn-ghost btn-icon" onClick={() => navegarMes(1)}><ChevronRight size={18} /></button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 12 }}
              onClick={() => {
                const d = new Date();
                setMesAtual(new Date(d.getFullYear(), d.getMonth(), 1));
              }}
            >Hoje</button>
          </div>

          <div className="agenda-cal-grid agenda-cal-weekdays">
            {DIAS_SEMANA.map((d) => <div key={d} className="agenda-cal-weekday">{d}</div>)}
          </div>

          <div className="agenda-cal-grid">
            {diasDoMes.map((d, i) => {
              if (!d) return <div key={`empty-${i}`} className="agenda-cal-cell empty" />;
              const ehHoje = sameDay(d, new Date());
              const evs = eventosPorDia.get(isoFromDate(d)) || [];
              return (
                <div key={isoFromDate(d)} className={`agenda-cal-cell${ehHoje ? ' today' : ''}`}>
                  <div className="agenda-cal-daynum">{d.getDate()}</div>
                  <div className="agenda-cal-events">
                    {evs.slice(0, 3).map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        className={`agenda-evt agenda-evt-${ev.cor}${ev.status === 'concluido' ? ' concluido' : ''}`}
                        onClick={() => clicarEvento(ev)}
                        title={ev.titulo}
                      >
                        {tipoIcon(ev.tipo)}
                        <span className="agenda-evt-titulo">{ev.titulo}</span>
                      </button>
                    ))}
                    {evs.length > 3 && (
                      <button
                        type="button"
                        className="agenda-evt-mais"
                        onClick={() => setView('lista')}
                      >+ {evs.length - 3} mais</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card">
          {eventosOrdenados.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><CalendarIcon size={48} /></div>
              <h3>Nenhum evento encontrado</h3>
              <p>Ajuste os filtros ou crie um novo evento</p>
            </div>
          ) : (
            <ul className="agenda-lista">
              {eventosOrdenados.map((ev) => (
                <li
                  key={ev.id}
                  className={`agenda-lista-item agenda-evt-${ev.cor}${ev.status === 'concluido' ? ' concluido' : ''}${ev.status === 'atrasado' ? ' atrasado' : ''}`}
                >
                  <button type="button" className="agenda-lista-btn" onClick={() => clicarEvento(ev)}>
                    <div className="agenda-lista-icon">{tipoIcon(ev.tipo)}</div>
                    <div className="agenda-lista-info">
                      <div className="agenda-lista-titulo">{ev.titulo}</div>
                      <div className="agenda-lista-meta">
                        {formatData(ev.data)} {ev.hora ? `às ${ev.hora}` : ''} ·{' '}
                        <span className={`agenda-status agenda-status-${ev.status}`}>
                          {ev.status === 'atrasado' ? 'Em atraso' : ev.status === 'concluido' ? 'Concluído' : 'Pendente'}
                        </span>
                      </div>
                    </div>
                  </button>
                  {ev.tipo === 'manual' && (
                    <div className="table-actions">
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => abrirEditarManual(ev)} title="Editar"><Pencil size={14} /></button>
                      <button className="btn btn-outline-danger btn-sm btn-icon" onClick={() => setConfirmExcluir(ev)} title="Excluir"><Trash2 size={14} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editandoId ? 'Editar Evento' : 'Novo Evento'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalAberto(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSalvarManual}>Salvar</button>
          </>
        }
      >
        <form onSubmit={handleSalvarManual}>
          <div className="form-group">
            <label className="form-label">Título <span className="required">*</span></label>
            <input className="form-control" value={form.titulo} onChange={(e) => setF('titulo', e.target.value)} required />
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Data <span className="required">*</span></label>
              <input className="form-control" type="date" value={form.data} onChange={(e) => setF('data', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Hora</label>
              <input className="form-control" type="time" value={form.hora} onChange={(e) => setF('hora', e.target.value)} />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Tipo</label>
              <select className="form-control" value={form.tipo} onChange={(e) => setF('tipo', e.target.value)}>
                {TIPOS_MANUAIS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Imóvel</label>
              <select className="form-control" value={form.imovel_id} onChange={(e) => setF('imovel_id', e.target.value)}>
                <option value="">Nenhum</option>
                {imoveis.map((im) => <option key={im.id} value={im.id}>{im.codigo} — {im.endereco}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Descrição</label>
            <textarea className="form-control" rows={3} value={form.descricao} onChange={(e) => setF('descricao', e.target.value)} />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmExcluir}
        onClose={() => setConfirmExcluir(null)}
        onConfirm={handleExcluirManual}
        title="Excluir Evento"
        message={`Tem certeza que deseja excluir "${confirmExcluir?.titulo}"?`}
      />
    </div>
  );
}
