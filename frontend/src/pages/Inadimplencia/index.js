import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { relatoriosService } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import MetricCard from '../../components/MetricCard';
import { EmptyState, ErrorState } from '../../components/StateViews';
import SearchInput from '../../components/filters/SearchInput';
import { formatMoeda, formatData, MESES } from '../../utils/format';
import { AlertTriangle, ChevronDown, ChevronRight, Phone, Copy, MessageCircle, CheckCircle2 } from 'lucide-react';

const statusInfo = (s) => {
  const map = {
    atrasado: { label: 'Atrasado', cls: 'badge-danger' },
    pendente: { label: 'Vencido', cls: 'badge-warning' },
    parcial: { label: 'Parcial', cls: 'badge-info' }
  };
  return map[s] || { label: s, cls: 'badge-gray' };
};

// Severidade pela quantidade de meses em aberto
const nivel = (meses) => {
  if (meses >= 3) return { cls: 'badge-danger', label: 'Crítico', cor: 'var(--danger)' };
  if (meses === 2) return { cls: 'badge-warning', label: 'Atenção', cor: 'var(--warning)' };
  return { cls: 'badge-info', label: '', cor: 'var(--info)' };
};

const soDigitos = (t) => (t || '').replace(/\D/g, '');
// Chave estável por inquilino (não usar índice, pois a lista é filtrável)
const keyOf = (inq) => (inq.inquilino_id != null ? `i${inq.inquilino_id}` : `n${inq.inquilino_nome}`);

export default function Inadimplencia() {
  const [resumo, setResumo] = useState(null);
  const [inquilinos, setInquilinos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [abertos, setAbertos] = useState(new Set());
  const [busca, setBusca] = useState('');
  const toast = useToast();

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await relatoriosService.inadimplenciaConsolidada();
      setResumo(res.data.resumo);
      setInquilinos(res.data.inquilinos);
      // já abre os críticos (3+ meses) por padrão — chave estável (não índice)
      const criticos = new Set();
      res.data.inquilinos.forEach((inq) => { if (inq.meses_em_aberto >= 3) criticos.add(keyOf(inq)); });
      setAbertos(criticos);
    } catch (err) {
      setErro(err.response?.data?.error || 'Não foi possível carregar a inadimplência.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const toggle = (k) => setAbertos((prev) => {
    const n = new Set(prev);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });

  const construirMensagem = (inq) => {
    const linhas = inq.pagamentos
      .map((p) => `• ${MESES[p.mes - 1]}/${p.ano} (${p.imovel_codigo}): ${formatMoeda(p.falta)}${p.status === 'parcial' ? ' — parcial' : ''}`)
      .join('\n');
    return `Olá ${inq.inquilino_nome}, identificamos pagamento(s) em aberto no seu cadastro:\n${linhas}\n\nTotal em aberto: ${formatMoeda(inq.total_devido)}.\nPor favor, regularize assim que possível. Qualquer dúvida, estamos à disposição.`;
  };

  const copiarCobranca = async (inq) => {
    try {
      await navigator.clipboard.writeText(construirMensagem(inq));
      toast.success('Mensagem de cobrança copiada!');
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  const linkWhatsApp = (inq) => {
    const tel = soDigitos(inq.inquilino_telefone);
    if (!tel) return null;
    const num = tel.length <= 11 ? `55${tel}` : tel;
    return `https://wa.me/${num}?text=${encodeURIComponent(construirMensagem(inq))}`;
  };

  const inquilinosFiltrados = useMemo(() => {
    if (!busca.trim()) return inquilinos;
    const t = busca.toLowerCase();
    return inquilinos.filter((i) => i.inquilino_nome.toLowerCase().includes(t));
  }, [inquilinos, busca]);

  const totalAtrasado = (resumo?.total_atrasado || 0) + (resumo?.total_pendente || 0);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Inadimplência</h1>
          <p>
            Visualize aluguéis em atraso e envie cobranças.
            {resumo && resumo.total_inquilinos > 0 && <> · {resumo.total_inquilinos} inquilino(s), {resumo.meses_em_aberto} mês(es) em aberto</>}
          </p>
        </div>
      </div>

      {erro && <ErrorState message={erro} onRetry={carregar} />}

      {/* Cards de resumo (valores ACUMULADOS, não só do mês) */}
      {resumo && resumo.total_inquilinos > 0 && (
        <div className="metrics-grid">
          <MetricCard label="Total em Aberto" value={formatMoeda(resumo.total_devido)} color="var(--danger)" hint="somando todos os meses" />
          <MetricCard label="Atrasado" value={formatMoeda(totalAtrasado)} color="var(--danger)" />
          <MetricCard label="Parcial (falta)" value={formatMoeda(resumo.total_parcial)} color="var(--info)" />
          <MetricCard
            label="Inquilinos devendo"
            value={resumo.total_inquilinos}
            color="var(--warning)"
            hint={resumo.criticos > 0 ? `${resumo.criticos} crítico(s) — 3+ meses` : 'nenhum crítico'}
          />
        </div>
      )}

      {/* Busca */}
      {resumo && resumo.total_inquilinos > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 12 }}>
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar inquilino..." label="Buscar inquilino" />
        </div>
      )}

      {loading ? (
        <div className="card"><div className="loading-spinner"><div className="spinner" /></div></div>
      ) : !resumo || resumo.total_inquilinos === 0 ? (
        <div className="card">
          <EmptyState
            icon={<CheckCircle2 size={48} />}
            title="Tudo em dia!"
            message="Nenhum inquilino com pagamentos em aberto no momento."
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {inquilinosFiltrados.map((inq, i) => {
            const k = keyOf(inq);
            const aberto = abertos.has(k);
            const nv = nivel(inq.meses_em_aberto);
            const critico = inq.meses_em_aberto >= 3;
            const wa = linkWhatsApp(inq);
            return (
              <div
                key={inq.inquilino_id || `x${i}`}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  borderLeft: `4px solid ${nv.cor}`
                }}
              >
                {/* Cabeçalho clicável */}
                <div
                  onClick={() => toggle(k)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}
                >
                  <span style={{ color: 'var(--gray-400)' }}>
                    {aberto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15 }}>{inq.inquilino_nome}</strong>
                      {critico && (
                        <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <AlertTriangle size={11} /> Crítico
                        </span>
                      )}
                      <span className={`badge ${nv.cls}`}>{inq.meses_em_aberto} {inq.meses_em_aberto === 1 ? 'mês' : 'meses'}</span>
                      {inq.dias_atraso_max > 0 && (
                        <span className="badge badge-gray">atraso de {inq.dias_atraso_max} dias</span>
                      )}
                    </div>
                    {inq.inquilino_telefone && (
                      <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Phone size={11} /> {inq.inquilino_telefone}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total devido</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>{formatMoeda(inq.total_devido)}</div>
                  </div>
                </div>

                {/* Detalhes */}
                {aberto && (
                  <div style={{ borderTop: '1px solid var(--gray-200)', padding: '12px 16px', background: 'var(--gray-50)' }}>
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Mês/Ano</th>
                            <th>Imóvel</th>
                            <th>Vencimento</th>
                            <th>Status</th>
                            <th>Valor</th>
                            <th>Recebido</th>
                            <th>Falta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inq.pagamentos.map((p) => {
                            const st = statusInfo(p.status);
                            return (
                              <tr key={p.id}>
                                <td><strong>{MESES[p.mes - 1]}/{p.ano}</strong></td>
                                <td>{p.imovel_codigo}</td>
                                <td>
                                  {formatData(p.data_vencimento)}
                                  {p.dias_atraso > 0 && <span style={{ color: 'var(--danger)', fontSize: 12 }}> ({p.dias_atraso}d)</span>}
                                </td>
                                <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                                <td>{formatMoeda(p.valor_aluguel)}</td>
                                <td>{p.valor_recebido ? formatMoeda(p.valor_recebido) : '—'}</td>
                                <td><strong style={{ color: 'var(--danger)' }}>{formatMoeda(p.falta)}</strong></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Ações de cobrança */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => copiarCobranca(inq)}>
                        <Copy size={13} /> Copiar cobrança
                      </button>
                      {wa && (
                        <a className="btn btn-success btn-sm" href={wa} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <MessageCircle size={13} /> Cobrar no WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {inquilinosFiltrados.length === 0 && (
            <div className="card"><EmptyState icon={<AlertTriangle size={40} />} title="Nenhum inquilino encontrado" message="Ajuste a busca." /></div>
          )}
        </div>
      )}
    </div>
  );
}
