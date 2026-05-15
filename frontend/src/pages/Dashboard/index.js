import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { dashboardService } from '../../services/api';
import { formatMoeda, formatMesAno, MESES } from '../../utils/format';

const StatCard = ({ icon, value, label, color, onClick }) => (
  <div className="stat-card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
    <div className="stat-icon" style={{ background: color + '18', color }}>
      {icon}
    </div>
    <div className="stat-info">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  </div>
);

const AlertCard = ({ icon, title, value, description, color, onClick }) => (
  <div
    className="card"
    style={{ cursor: onClick ? 'pointer' : 'default', borderLeft: `4px solid ${color}` }}
    onClick={onClick}
  >
    <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ fontSize: 28 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--gray-700)' }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>{description}</div>
      </div>
    </div>
  </div>
);

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [evolucao, setEvolucao] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
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
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="loading-spinner"><div className="spinner" /></div>;
  }

  if (!stats) return null;

  const mesAtual = MESES[new Date().getMonth()];
  const anoAtual = new Date().getFullYear();

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--gray-800)', margin: 0 }}>Dashboard</h1>
        <p style={{ color: 'var(--gray-500)', margin: '4px 0 0', fontSize: 14 }}>
          Resumo de {mesAtual} de {anoAtual}
        </p>
      </div>
      <div className="stats-grid">
        <StatCard
          icon="🏠"
          value={stats.totalImoveis}
          label="Total de Imóveis"
          color="var(--primary)"
          onClick={() => navigate('/imoveis')}
        />
        <StatCard
          icon="✅"
          value={stats.imoveisAlugados}
          label="Imóveis Alugados"
          color="var(--success)"
          onClick={() => navigate('/imoveis?status=alugado')}
        />
        <StatCard
          icon="🔑"
          value={stats.imoveisVagos}
          label="Imóveis Vagos"
          color="var(--warning)"
          onClick={() => navigate('/imoveis?status=vago')}
        />
        <StatCard
          icon="💵"
          value={formatMoeda(stats.totalReceber)}
          label={`A Receber — ${mesAtual}`}
          color="var(--info)"
          onClick={() => navigate('/pagamentos')}
        />
        <StatCard
          icon="💰"
          value={formatMoeda(stats.totalRecebido)}
          label={`Recebido — ${mesAtual}`}
          color="var(--success)"
          onClick={() => navigate('/pagamentos')}
        />
        <StatCard
          icon="🔴"
          value={formatMoeda(stats.valorAberto)}
          label="Valor em Aberto"
          color="var(--danger)"
          onClick={() => navigate('/pagamentos?status=atrasado')}
        />
        <StatCard
          icon="⚠️"
          value={stats.alugueisAtrasados}
          label="Aluguéis Atrasados"
          color="var(--danger)"
          onClick={() => navigate('/pagamentos?status=atrasado')}
        />
        <StatCard
          icon="📄"
          value={formatMoeda(stats.despesasMes)}
          label={`Despesas — ${mesAtual}`}
          color="var(--warning)"
          onClick={() => navigate('/despesas')}
        />
        <StatCard
          icon="📋"
          value={stats.contratosVencendo}
          label="Contratos Vencendo (30d)"
          color="var(--warning)"
          onClick={() => navigate('/contratos')}
        />
        <StatCard
          icon="📈"
          value={stats.reajustesPendentes}
          label="Reajustes Pendentes"
          color="var(--accent)"
          onClick={() => navigate('/reajustes')}
        />
      </div>

      <div className="charts-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Evolução Mensal de Aluguéis</span>
          </div>
          <div className="card-body">
            {evolucao.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={evolucao} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => formatMoeda(v)} />
                  <Legend />
                  <Bar dataKey="A Receber" fill="var(--accent)" radius={[4,4,0,0]} />
                  <Bar dataKey="Recebido" fill="var(--success)" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">
                <div>Sem dados para exibir</div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Distribuição dos Imóveis</span>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Alugados', value: stats.imoveisAlugados, total: stats.totalImoveis, color: 'var(--success)' },
                { label: 'Vagos', value: stats.imoveisVagos, total: stats.totalImoveis, color: 'var(--warning)' },
                { label: 'Em Negociação', value: stats.imoveisNegociacao, total: stats.totalImoveis, color: 'var(--info)' }
              ].map((item) => {
                const pct = stats.totalImoveis > 0 ? Math.round((item.value / stats.totalImoveis) * 100) : 0;
                return (
                  <div key={item.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 14 }}>
                      <span style={{ color: 'var(--gray-700)', fontWeight: 500 }}>{item.label}</span>
                      <span style={{ color: item.color, fontWeight: 600 }}>{item.value} ({pct}%)</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: item.color, borderRadius: 4, transition: 'width 0.5s' }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <hr className="divider" />

            <div style={{ fontSize: 14, color: 'var(--gray-600)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>Taxa de Ocupação</span>
                <strong style={{ color: 'var(--primary)' }}>
                  {stats.totalImoveis > 0 ? Math.round((stats.imoveisAlugados / stats.totalImoveis) * 100) : 0}%
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Receita potencial mensal</span>
                <strong style={{ color: 'var(--success)' }}>{formatMoeda(stats.totalReceber)}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {(stats.alertas.contratosVencendo7Dias > 0 || stats.alertas.reajustesUrgentes > 0 || stats.alertas.despesasAtrasadas > 0 || stats.alugueisAtrasados > 0) && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: 'var(--gray-700)' }}>
            ⚠️ Alertas
          </h2>
          <div className="alerts-grid">
            {stats.alugueisAtrasados > 0 && (
              <AlertCard
                icon="🔴"
                title="Aluguéis Atrasados"
                value={stats.alugueisAtrasados}
                description={`Pagamentos em atraso em ${mesAtual}/${anoAtual}`}
                color="var(--danger)"
                onClick={() => navigate('/pagamentos?status=atrasado')}
              />
            )}
            {stats.alertas.contratosVencendo7Dias > 0 && (
              <AlertCard
                icon="📋"
                title="Contratos Vencendo"
                value={stats.alertas.contratosVencendo7Dias}
                description="Contratos que vencem nos próximos 7 dias"
                color="var(--warning)"
                onClick={() => navigate('/contratos')}
              />
            )}
            {stats.alertas.reajustesUrgentes > 0 && (
              <AlertCard
                icon="📈"
                title="Reajustes Urgentes"
                value={stats.alertas.reajustesUrgentes}
                description="Reajustes pendentes para os próximos 30 dias"
                color="var(--accent)"
                onClick={() => navigate('/reajustes')}
              />
            )}
            {stats.alertas.despesasAtrasadas > 0 && (
              <AlertCard
                icon="📄"
                title="Despesas Atrasadas"
                value={stats.alertas.despesasAtrasadas}
                description="Despesas com pagamento em atraso"
                color="var(--warning)"
                onClick={() => navigate('/despesas?status=atrasado')}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
