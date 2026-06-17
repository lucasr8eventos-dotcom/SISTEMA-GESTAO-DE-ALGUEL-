import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { dashboardService } from '../../services/api';
import { formatMoeda, MESES } from '../../utils/format';
import {
  Home, PieChart as PieIcon, Wallet, AlertTriangle, Clock, TrendingUp, CalendarClock,
  DollarSign, ArrowDownCircle, CheckCircle2, ArrowUpCircle, CreditCard, Building2,
  FileText, Calendar, AlertCircle
} from 'lucide-react';

// Card de métrica do topo (ícone em círculo + rótulo + valor)
const DashStat = ({ icon, label, value, color, valueColor, onClick }) => (
  <div className="dash-stat" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
    <div className="dash-stat-icon" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      {icon}
    </div>
    <div className="dash-stat-text">
      <div className="dash-stat-label">{label}</div>
      <div className="dash-stat-value" style={{ color: valueColor || 'var(--gray-800)' }}>{value}</div>
    </div>
  </div>
);

// Cores da rosca / legenda de distribuição
const RADIAN = Math.PI / 180;

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [evolucao, setEvolucao] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      setErro(null);
      try {
        const [statsRes, evolucaoRes] = await Promise.all([
          dashboardService.stats(),
          dashboardService.evolucao()
        ]);
        setStats(statsRes.data);

        const evData = evolucaoRes.data.map(r => ({
          name: `${MESES[r.mes - 1].slice(0, 3)}/${String(r.ano).slice(2)}`,
          'A Receber': parseFloat(r.total_receber || 0),
          'Recebido': parseFloat(r.total_recebido || 0)
        }));
        setEvolucao(evData);
      } catch (err) {
        setErro(err.response?.data?.error || 'Não foi possível carregar o dashboard. Verifique sua conexão.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="loading-spinner"><div className="spinner" /></div>;
  }

  if (erro) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <AlertCircle size={48} color="var(--danger)" style={{ marginBottom: 16 }} />
        <h2 style={{ color: 'var(--gray-700)', marginBottom: 8 }}>Erro ao carregar dashboard</h2>
        <p style={{ color: 'var(--gray-500)' }}>{erro}</p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!stats) return null;

  const taxaOcupacao = stats.totalImoveis > 0
    ? Math.round((stats.imoveisAlugados / stats.totalImoveis) * 100)
    : 0;
  const saldoPrevisto = parseFloat(stats.totalRecebido || 0) - parseFloat(stats.despesasMes || 0);

  const plural = (n, sing, plur) => `${n} ${n === 1 ? sing : plur}`;

  // Alertas (somente os que têm contagem > 0)
  const alertas = [
    {
      cond: (stats.atrasadosGeral ?? stats.alugueisAtrasados) > 0,
      icon: <Clock size={18} />, color: 'var(--danger)',
      texto: plural(stats.atrasadosGeral ?? stats.alugueisAtrasados, 'aluguel em aberto', 'aluguéis em aberto'),
      onClick: () => navigate('/inadimplencia')
    },
    {
      cond: stats.reajustesPendentes > 0,
      icon: <TrendingUp size={18} />, color: 'var(--warning)',
      texto: plural(stats.reajustesPendentes, 'reajuste pendente', 'reajustes pendentes'),
      onClick: () => navigate('/contratos')
    },
    {
      cond: stats.contratosVencendo > 0,
      icon: <CalendarClock size={18} />, color: '#d97706',
      texto: plural(stats.contratosVencendo, 'contrato vencendo', 'contratos vencendo'),
      onClick: () => navigate('/contratos')
    },
    {
      cond: stats.alertas?.despesasAtrasadas > 0,
      icon: <DollarSign size={18} />, color: 'var(--danger)',
      texto: plural(stats.alertas.despesasAtrasadas, 'despesa atrasada', 'despesas atrasadas'),
      onClick: () => navigate('/contas-a-pagar?status=atrasado')
    }
  ].filter(a => a.cond);

  // Distribuição dos imóveis
  const distribuicao = [
    { label: 'Alugados', value: stats.imoveisAlugados, color: 'var(--accent)' },
    { label: 'Vagos', value: stats.imoveisVagos, color: 'var(--success)' },
    { label: 'Em Negociação', value: stats.imoveisNegociacao, color: 'var(--warning)' },
    { label: 'Em Manutenção', value: stats.imoveisManutencao, color: 'var(--gray-400)' }
  ];
  const pieData = distribuicao.filter(d => d.value > 0);

  const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
    if (!value) return null;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700}>
        {value}
      </text>
    );
  };

  // Resumo financeiro do mês
  const resumo = [
    { icon: <ArrowDownCircle size={18} />, color: 'var(--success)', label: 'A receber:', value: formatMoeda(stats.totalReceber), valueColor: 'var(--success)' },
    { icon: <CheckCircle2 size={18} />, color: 'var(--success)', label: 'Recebido:', value: formatMoeda(stats.totalRecebido), valueColor: 'var(--success)' },
    { icon: <Clock size={18} />, color: 'var(--warning)', label: 'Em aberto:', value: formatMoeda(stats.valorAberto), valueColor: 'var(--warning)' },
    { icon: <ArrowUpCircle size={18} />, color: 'var(--danger)', label: 'Despesas:', value: formatMoeda(stats.despesasMes), valueColor: 'var(--danger)' },
    { icon: <CreditCard size={18} />, color: 'var(--accent)', label: 'Saldo previsto:', value: formatMoeda(saldoPrevisto), valueColor: 'var(--accent)' }
  ];

  // Atalhos rápidos
  const atalhos = [
    { icon: <Building2 size={22} />, color: 'var(--accent)', label: 'Cadastrar Imóvel', onClick: () => navigate('/imoveis') },
    { icon: <FileText size={22} />, color: 'var(--success)', label: 'Novo Contrato', onClick: () => navigate('/contratos') },
    { icon: <DollarSign size={22} />, color: '#8b5cf6', label: 'Registrar Pagamento', onClick: () => navigate('/pagamentos') },
    { icon: <Calendar size={22} />, color: '#f97316', label: 'Ver Agenda', onClick: () => navigate('/agenda') }
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--gray-800)', margin: 0 }}>Dashboard</h1>
        <p style={{ color: 'var(--gray-500)', margin: '4px 0 0', fontSize: 14 }}>
          Resumo geral dos imóveis, contratos, pagamentos e pendências.
        </p>
      </div>

      {/* Cards do topo */}
      <div className="dash-stats">
        <DashStat
          icon={<Home size={24} />} label="Imóveis Cadastrados" value={stats.totalImoveis}
          color="var(--accent)" onClick={() => navigate('/imoveis')}
        />
        <DashStat
          icon={<PieIcon size={24} />} label="Taxa de Ocupação" value={`${taxaOcupacao}%`}
          color="var(--success)" onClick={() => navigate('/imoveis')}
        />
        <DashStat
          icon={<Wallet size={24} />} label="A Receber no Mês" value={formatMoeda(stats.totalReceber)}
          color="var(--accent)" valueColor="var(--accent)" onClick={() => navigate('/pagamentos?status=pendente')}
        />
        <DashStat
          icon={<AlertTriangle size={24} />} label="Em Aberto (total)" value={formatMoeda(stats.totalEmAberto ?? stats.valorAberto)}
          color="#f97316" valueColor="#f97316" onClick={() => navigate('/inadimplencia')}
        />
      </div>

      {/* Alertas importantes */}
      {alertas.length > 0 && (
        <div className="card dash-alerts">
          <div className="card-header"><span className="card-title">Alertas Importantes</span></div>
          <div className="dash-alerts-row">
            {alertas.map((a, i) => (
              <div key={i} className="dash-alert-item" onClick={a.onClick}>
                <span className="dash-alert-icon" style={{ background: `color-mix(in srgb, ${a.color} 14%, transparent)`, color: a.color }}>
                  {a.icon}
                </span>
                <span className="dash-alert-text" style={{ color: a.color }}>{a.texto}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evolução + Distribuição */}
      <div className="charts-grid">
        <div className="card">
          <div className="card-header"><span className="card-title">Evolução Mensal de Aluguéis</span></div>
          <div className="card-body">
            {evolucao.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={evolucao} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gradAReceber" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => formatMoeda(v)} />
                  <Area
                    type="monotone" dataKey="A Receber" stroke="var(--accent)" strokeWidth={2}
                    fill="url(#gradAReceber)" dot={{ r: 3, fill: 'var(--accent)' }} activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><div>Sem dados para exibir</div></div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Distribuição dos Imóveis</span></div>
          <div className="card-body">
            <div className="dash-donut">
              <div className="dash-donut-chart">
                {stats.totalImoveis > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={pieData} dataKey="value" nameKey="label"
                        cx="50%" cy="50%" innerRadius={50} outerRadius={85}
                        paddingAngle={2} labelLine={false} label={renderPieLabel}
                      >
                        {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [v, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state"><div>Nenhum imóvel cadastrado</div></div>
                )}
              </div>
              <div className="dash-donut-legend">
                {distribuicao.map((d) => {
                  const pct = stats.totalImoveis > 0 ? Math.round((d.value / stats.totalImoveis) * 100) : 0;
                  return (
                    <div key={d.label} className="dash-legend-item">
                      <span className="dash-legend-dot" style={{ background: d.color }} />
                      <span className="dash-legend-label">{d.label}</span>
                      <span className="dash-legend-value">{d.value} ({pct}%)</span>
                    </div>
                  );
                })}
                <div className="dash-legend-ocupacao">
                  Taxa de ocupação: <strong style={{ color: 'var(--accent)' }}>{taxaOcupacao}%</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Resumo financeiro + Atalhos */}
      <div className="charts-grid">
        <div className="card">
          <div className="card-header"><span className="card-title">Resumo Financeiro do Mês</span></div>
          <div className="card-body">
            <div className="dash-resumo">
              {resumo.map((r, i) => (
                <div key={i} className="dash-resumo-row">
                  <span className="dash-resumo-icon" style={{ color: r.color }}>{r.icon}</span>
                  <span className="dash-resumo-label">{r.label}</span>
                  <span className="dash-resumo-value" style={{ color: r.valueColor }}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Atalhos Rápidos</span></div>
          <div className="card-body">
            <div className="dash-shortcuts">
              {atalhos.map((a, i) => (
                <button key={i} className="dash-shortcut" onClick={a.onClick}>
                  <span className="dash-shortcut-icon" style={{ background: `color-mix(in srgb, ${a.color} 14%, transparent)`, color: a.color }}>
                    {a.icon}
                  </span>
                  <span className="dash-shortcut-label" style={{ color: a.color }}>{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
