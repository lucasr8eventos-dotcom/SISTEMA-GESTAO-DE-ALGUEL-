import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  pagamentosService, contratosService, reajustesService, despesasService, imoveisService, agendaService
} from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { MESES } from '../../utils/format';
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2,
  Home, FileText, TrendingUp, Receipt, MapPin
} from 'lucide-react';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const TIPOS_MANUAIS = [
  { value: 'vistoria_entrada', label: 'Vistoria de Entrada' },
  { value: 'vistoria_saida', label: 'Vistoria de Saída' },
  { value: 'visita', label: 'Visita' },
  { value: 'manutencao', label: 'Manutenção' },
  { value: 'reuniao', label: 'Reunião' },
  { value: 'outro', label: 'Outro' }
];

const FORM_MANUAL_INICIAL = { titulo: '', data: '', hora: '', imovel_id: '', tipo: 'visita', descricao: '' };

// ============================================================
// Helpers de data
// ============================================================
const sameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const parseDate = (s) => {
  if (!s) return null;
  // Datas do backend chegam como 'YYYY-MM-DD' ou 'YYYY-MM-DDT00:00:00.000Z'.
  // Extraímos ano/mês/dia direto do texto para NÃO sofrer deslocamento de fuso
  // (ex.: em UTC-3 um '2026-06-15T00:00:00Z' viraria 14/06 ao converter p/ local).
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

const isoFromDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
};

const diasEntre = (a, b) => Math.ceil((a.getTime() - b.getTime()) / 86400000);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const inicioSemana = (d) => addDays(d, -d.getDay()); // domingo
const meiaNoite = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ============================================================
// Geradores de eventos automáticos
// ============================================================
const gerarEventosPagamentos = (pagamentos) => {
  const hoje = meiaNoite(new Date());
  return pagamentos.map((p) => {
    const data = parseDate(p.data_vencimento);
    if (!data) return null;
    const pago = p.status === 'pago' || p.data_pagamento;
    let cor, status;
    if (pago) { cor = 'verde'; status = 'concluido'; }
    else if (data < hoje) { cor = 'vermelho'; status = 'atrasado'; }
    else { cor = 'laranja'; status = 'pendente'; }
    return {
      id: `pag-${p.id}`, tipo: 'aluguel',
      titulo: `Aluguel — ${p.imovel_codigo || 'Imóvel'} / ${p.inquilino_nome || 'Inquilino'}`,
      data, hora: '', cor, status,
      navegar: `/pagamentos?imovel=${p.imovel_id || ''}&mes=${p.mes || ''}&ano=${p.ano || ''}`,
      meta: { imovel_id: p.imovel_id }
    };
  }).filter(Boolean);
};

const gerarEventosContratos = (contratos) => {
  const hoje = meiaNoite(new Date());
  const renovados = new Set();
  contratos.forEach((c) => { if (c.status === 'ativo' && c.imovel_id) renovados.add(c.imovel_id); });
  return contratos.map((c) => {
    const data = parseDate(c.data_fim);
    if (!data) return null;
    const dias = diasEntre(data, hoje);
    let cor, status;
    if (c.status === 'encerrado' && renovados.has(c.imovel_id)) { cor = 'cinza'; status = 'concluido'; }
    else { cor = 'roxo'; status = dias < 0 ? 'atrasado' : 'pendente'; }
    return {
      id: `cont-${c.id}`, tipo: 'contrato',
      titulo: `Contrato — ${c.imovel_codigo || 'Imóvel'} / ${c.inquilino_nome || 'Inquilino'}`,
      data, hora: '', cor, status,
      navegar: `/contratos?id=${c.id}`, meta: { imovel_id: c.imovel_id }
    };
  }).filter(Boolean);
};

const gerarEventosReajustes = (reajustes) => {
  const hoje = meiaNoite(new Date());
  return reajustes.map((r) => {
    const data = parseDate(r.data_proximo);
    if (!data) return null;
    let cor, status;
    if (r.status === 'aplicado') { cor = 'cinza'; status = 'concluido'; }
    else if (data < hoje) { cor = 'vermelho'; status = 'atrasado'; }
    else { cor = 'laranja'; status = 'pendente'; }
    return {
      id: `reaj-${r.id}`, tipo: 'reajuste',
      titulo: `Reajuste — ${r.imovel_codigo || 'Imóvel'} / ${r.inquilino_nome || 'Inquilino'}`,
      data, hora: '', cor, status,
      navegar: `/contratos?reajuste=${r.id}`, meta: { imovel_id: r.imovel_id }
    };
  }).filter(Boolean);
};

const gerarEventosDespesas = (despesas) => {
  const hoje = meiaNoite(new Date());
  return despesas.map((d) => {
    const data = parseDate(d.vencimento || d.data_vencimento);
    if (!data) return null;
    const paga = d.status === 'pago';
    let cor, status;
    if (paga) { cor = 'cinza'; status = 'concluido'; }
    else if (data < hoje) { cor = 'vermelho'; status = 'atrasado'; }
    else { cor = 'laranja'; status = 'pendente'; }
    return {
      id: `desp-${d.id}`, tipo: 'despesa',
      titulo: `Conta — ${d.descricao || d.tipo || 'Outro'} / ${d.imovel_codigo || 'Geral'}`,
      data, hora: '', cor, status,
      navegar: `/contas-a-pagar`, meta: { imovel_id: d.imovel_id }
    };
  }).filter(Boolean);
};

const tipoIcon = (tipo) => {
  const map = {
    aluguel: <Home size={13} />, contrato: <FileText size={13} />,
    reajuste: <TrendingUp size={13} />, despesa: <Receipt size={13} />, manual: <MapPin size={13} />
  };
  return map[tipo] || null;
};

// Ordena eventos: com hora primeiro (por hora), depois os "dia todo"
const ordenarPorHora = (lista) => [...lista].sort((a, b) => {
  if (a.hora && b.hora) return a.hora.localeCompare(b.hora);
  if (a.hora) return -1;
  if (b.hora) return 1;
  return 0;
});

// ============================================================
// Componente principal
// ============================================================
export default function Agenda() {
  const [auto, setAuto] = useState([]);
  const [manuais, setManuais] = useState([]);
  const [loading, setLoading] = useState(true);
  const [imoveis, setImoveis] = useState([]);
  const [ref, setRef] = useState(() => meiaNoite(new Date()));
  const [view, setView] = useState('mes'); // 'dia' | 'semana' | 'mes'
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroImovel, setFiltroImovel] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState(FORM_MANUAL_INICIAL);
  const [salvando, setSalvando] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();

  const fetchManuais = useCallback(async () => {
    try {
      const r = await agendaService.listar();
      setManuais(r.data.map((m) => ({
        id: `man-${m.id}`, rawId: m.id, tipo: 'manual', subtipo: m.tipo,
        titulo: m.titulo, data: parseDate(m.data), hora: m.hora ? String(m.hora).slice(0, 5) : '',
        cor: 'azul', status: 'pendente',
        meta: { imovel_id: m.imovel_id, manual: true },
        _raw: m
      })));
    } catch {
      toast.error('Erro ao carregar eventos da agenda');
    }
  }, [toast]);

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

  useEffect(() => { fetchAuto(); fetchManuais(); }, [fetchAuto, fetchManuais]);

  const todosEventos = useMemo(() => [...auto, ...manuais], [auto, manuais]);

  const eventosFiltrados = useMemo(() => todosEventos.filter((ev) => {
    if (filtroTipo && ev.tipo !== filtroTipo) return false;
    if (filtroStatus && ev.status !== filtroStatus) return false;
    if (filtroImovel && String(ev.meta?.imovel_id) !== String(filtroImovel)) return false;
    return true;
  }), [todosEventos, filtroTipo, filtroStatus, filtroImovel]);

  const eventosPorDia = useMemo(() => {
    const map = new Map();
    eventosFiltrados.forEach((ev) => {
      if (!ev.data) return;
      const key = isoFromDate(ev.data);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    });
    map.forEach((v, k) => map.set(k, ordenarPorHora(v)));
    return map;
  }, [eventosFiltrados]);

  const eventosDoDia = (d) => eventosPorDia.get(isoFromDate(d)) || [];

  // ===== Navegação =====
  const navegar = (delta) => {
    setRef((r) => {
      if (view === 'mes') return new Date(r.getFullYear(), r.getMonth() + delta, 1);
      if (view === 'semana') return addDays(r, delta * 7);
      return addDays(r, delta);
    });
  };

  const titulo = useMemo(() => {
    if (view === 'mes') return `${MESES[ref.getMonth()]} de ${ref.getFullYear()}`;
    if (view === 'dia') return ref.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const ini = inicioSemana(ref);
    const fim = addDays(ini, 6);
    const mesmoMes = ini.getMonth() === fim.getMonth();
    return mesmoMes
      ? `${ini.getDate()} – ${fim.getDate()} de ${MESES[ini.getMonth()]} ${ini.getFullYear()}`
      : `${ini.getDate()} ${MESES[ini.getMonth()].slice(0, 3)} – ${fim.getDate()} ${MESES[fim.getMonth()].slice(0, 3)} ${fim.getFullYear()}`;
  }, [view, ref]);

  // ===== Grade do mês =====
  const diasDoMes = useMemo(() => {
    const ano = ref.getFullYear();
    const mes = ref.getMonth();
    const primeiro = new Date(ano, mes, 1).getDay();
    const ultimo = new Date(ano, mes + 1, 0).getDate();
    const dias = [];
    for (let i = 0; i < primeiro; i++) dias.push(null);
    for (let d = 1; d <= ultimo; d++) dias.push(new Date(ano, mes, d));
    while (dias.length % 7 !== 0) dias.push(null);
    return dias;
  }, [ref]);

  const diasDaSemana = useMemo(() => {
    const ini = inicioSemana(ref);
    return Array.from({ length: 7 }, (_, i) => addDays(ini, i));
  }, [ref]);

  // ===== Eventos manuais (CRUD via API) =====
  const abrirNovoManual = () => {
    setEditandoId(null);
    setForm({ ...FORM_MANUAL_INICIAL, data: isoFromDate(view === 'mes' ? new Date() : ref) });
    setModalAberto(true);
  };

  const abrirEditarManual = (ev) => {
    const m = ev._raw;
    setEditandoId(ev.rawId);
    setForm({
      titulo: m.titulo || '', data: m.data ? String(m.data).split('T')[0] : '',
      hora: m.hora ? String(m.hora).slice(0, 5) : '', imovel_id: m.imovel_id || '',
      tipo: m.tipo || 'visita', descricao: m.descricao || ''
    });
    setModalAberto(true);
  };

  const setF = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const handleSalvarManual = async (e) => {
    e.preventDefault();
    if (!form.titulo.trim() || !form.data) { toast.error('Título e data são obrigatórios'); return; }
    setSalvando(true);
    try {
      const payload = {
        titulo: form.titulo.trim(), data: form.data, hora: form.hora || undefined,
        tipo: form.tipo, imovel_id: form.imovel_id || undefined, descricao: form.descricao || undefined
      };
      if (editandoId) {
        await agendaService.atualizar(editandoId, payload);
        toast.success('Evento atualizado');
      } else {
        await agendaService.criar(payload);
        toast.success('Evento criado');
      }
      setModalAberto(false);
      fetchManuais();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar evento');
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluirManual = async () => {
    try {
      await agendaService.excluir(confirmExcluir.rawId);
      setConfirmExcluir(null);
      toast.success('Evento excluído');
      fetchManuais();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  const clicarEvento = (ev) => {
    if (ev.tipo === 'manual') abrirEditarManual(ev);
    else navigate(ev.navegar);
  };

  // ===== Chip de evento =====
  const Chip = ({ ev, comHora }) => (
    <button
      type="button"
      className={`agenda-evt agenda-evt-${ev.cor}${ev.status === 'concluido' ? ' concluido' : ''}`}
      onClick={(e) => { e.stopPropagation(); clicarEvento(ev); }}
      title={ev.titulo}
      style={{ width: '100%' }}
    >
      {tipoIcon(ev.tipo)}
      {comHora && ev.hora && <span style={{ fontWeight: 600, marginRight: 2 }}>{ev.hora}</span>}
      <span className="agenda-evt-titulo">{ev.titulo}</span>
    </button>
  );

  const ehHojeRef = sameDay(ref, new Date());

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Agenda</h1>
          <p>Controle compromissos, vencimentos, cobranças e eventos dos imóveis.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="agenda-view-toggle">
            {[{ id: 'dia', label: 'Dia' }, { id: 'semana', label: 'Semana' }, { id: 'mes', label: 'Mês' }].map((v) => (
              <button
                key={v.id}
                type="button"
                className={`agenda-view-btn${view === v.id ? ' active' : ''}`}
                onClick={() => setView(v.id)}
                style={{ padding: '6px 12px', fontSize: 13 }}
              >{v.label}</button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={abrirNovoManual}>
            <Plus size={16} /> Novo Evento
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="filters-row">
        <select className="form-control filter-select" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="aluguel">Aluguel</option>
          <option value="contrato">Contrato</option>
          <option value="reajuste">Reajuste</option>
          <option value="despesa">Conta a pagar</option>
          <option value="manual">Evento manual</option>
        </select>
        <select className="form-control filter-select" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="atrasado">Em atraso</option>
          <option value="concluido">Concluído</option>
        </select>
        <select className="form-control filter-select" value={filtroImovel} onChange={(e) => setFiltroImovel(e.target.value)}>
          <option value="">Todos os imóveis</option>
          {imoveis.map((im) => <option key={im.id} value={im.id}>{im.codigo} — {im.endereco}</option>)}
        </select>
        {(filtroTipo || filtroStatus || filtroImovel) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setFiltroTipo(''); setFiltroStatus(''); setFiltroImovel(''); }}>
            Limpar filtros
          </button>
        )}
      </div>

      {/* Legenda de cores */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', margin: '0 0 14px', fontSize: 12, color: 'var(--gray-600)' }}>
        {[
          { c: '#3b82f6', t: 'Evento manual' },
          { c: '#f97316', t: 'Vencimento próximo' },
          { c: '#ef4444', t: 'Pagamento atrasado' },
          { c: '#8b5cf6', t: 'Contrato vencendo' },
          { c: '#22c55e', t: 'Pagamento recebido' },
          { c: 'var(--gray-400)', t: 'Concluído' }
        ].map((l) => (
          <span key={l.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: l.c, display: 'inline-block' }} />
            {l.t}
          </span>
        ))}
      </div>

      {/* Barra de navegação */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="agenda-cal-header">
          <button className="btn btn-ghost btn-icon" onClick={() => navegar(-1)}><ChevronLeft size={18} /></button>
          <h3 style={{ margin: 0, fontSize: 17, textTransform: 'capitalize', minWidth: 240, textAlign: 'center' }}>{titulo}</h3>
          <button className="btn btn-ghost btn-icon" onClick={() => navegar(1)}><ChevronRight size={18} /></button>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }} onClick={() => setRef(meiaNoite(new Date()))}>Hoje</button>
        </div>

        {loading ? (
          <div className="loading-spinner"><div className="spinner" /></div>
        ) : view === 'mes' ? (
          <>
            <div className="agenda-cal-grid agenda-cal-weekdays">
              {DIAS_SEMANA.map((d) => <div key={d} className="agenda-cal-weekday">{d}</div>)}
            </div>
            <div className="agenda-cal-grid">
              {diasDoMes.map((d, i) => {
                if (!d) return <div key={`empty-${i}`} className="agenda-cal-cell empty" />;
                const evs = eventosDoDia(d);
                return (
                  <div key={isoFromDate(d)} className={`agenda-cal-cell${sameDay(d, new Date()) ? ' today' : ''}`}>
                    <div className="agenda-cal-daynum" style={{ cursor: 'pointer' }} onClick={() => { setRef(d); setView('dia'); }}>{d.getDate()}</div>
                    <div className="agenda-cal-events">
                      {evs.slice(0, 3).map((ev) => <Chip key={ev.id} ev={ev} />)}
                      {evs.length > 3 && (
                        <button type="button" className="agenda-evt-mais" onClick={() => { setRef(d); setView('dia'); }}>+ {evs.length - 3} mais</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : view === 'semana' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, padding: 8 }}>
            {diasDaSemana.map((d) => {
              const evs = eventosDoDia(d);
              const hoje = sameDay(d, new Date());
              return (
                <div key={isoFromDate(d)} style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden', minHeight: 320, background: hoje ? 'var(--info-light)' : 'var(--card-bg, #fff)' }}>
                  <div onClick={() => { setRef(d); setView('dia'); }} style={{ padding: '8px 6px', textAlign: 'center', cursor: 'pointer', borderBottom: '1px solid var(--gray-200)', background: hoje ? 'var(--info)' : 'transparent', color: hoje ? '#fff' : 'inherit' }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', opacity: 0.8 }}>{DIAS_SEMANA[d.getDay()]}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{d.getDate()}</div>
                  </div>
                  <div style={{ padding: 5, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
                    {evs.length === 0
                      ? <div style={{ fontSize: 11, color: 'var(--gray-400)', textAlign: 'center', padding: 8 }}>—</div>
                      : evs.map((ev) => <Chip key={ev.id} ev={ev} comHora />)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // ===== Dia =====
          <div style={{ padding: 16 }}>
            <div style={{ background: ehHojeRef ? 'var(--info-light)' : 'var(--gray-50)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
              <strong style={{ textTransform: 'capitalize' }}>
                {ref.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </strong>
              {ehHojeRef && <span className="badge badge-info" style={{ marginLeft: 8 }}>Hoje</span>}
            </div>
            {eventosDoDia(ref).length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <p style={{ color: 'var(--gray-500)' }}>Nenhum evento encontrado para este período. Clique em "Novo Evento" para cadastrar um compromisso.</p>
                <button className="btn btn-ghost btn-sm" onClick={abrirNovoManual}><Plus size={14} /> Novo Evento</button>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {eventosDoDia(ref).map((ev) => (
                  <li key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 8 }}>
                    <div style={{ width: 64, fontSize: 13, fontWeight: 600, color: 'var(--gray-600)', flexShrink: 0 }}>
                      {ev.hora || 'Dia todo'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}><Chip ev={ev} /></div>
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
      </div>

      {/* Modal evento manual */}
      <Modal
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editandoId ? 'Editar Evento' : 'Novo Evento'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModalAberto(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleSalvarManual} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
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
