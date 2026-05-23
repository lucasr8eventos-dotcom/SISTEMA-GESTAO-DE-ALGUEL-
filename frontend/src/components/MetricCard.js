import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function MetricCard({
  label,
  value,
  color = 'var(--primary)',
  active = false,
  onClick,
  variation,           // número (% vs mês anterior) ou null
  progress,            // { pago: number, total: number } para barra de progresso
  hint
}) {
  const showVariation = typeof variation === 'number' && !isNaN(variation);
  const variationIcon = !showVariation ? null
    : variation > 0.5 ? <TrendingUp size={12} />
    : variation < -0.5 ? <TrendingDown size={12} />
    : <Minus size={12} />;
  const variationColor = !showVariation ? null
    : variation > 0.5 ? 'var(--success)'
    : variation < -0.5 ? 'var(--danger)'
    : 'var(--gray-500)';

  return (
    <button
      type="button"
      className={`metric-card${active ? ' active' : ''}${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      style={{ borderTopColor: color }}
      aria-pressed={onClick ? active : undefined}
    >
      <div className="metric-card-value" style={{ color }}>{value}</div>
      <div className="metric-card-label">{label}</div>
      {showVariation && (
        <div className="metric-card-variation" style={{ color: variationColor }}>
          {variationIcon}
          <span>
            {variation > 0 ? '+' : ''}{variation.toFixed(0)}% vs mês ant.
          </span>
        </div>
      )}
      {progress && progress.total > 0 && (
        <div className="metric-card-progress" title={`${Math.round((progress.pago / progress.total) * 100)}% pago`}>
          <div
            className="metric-card-progress-bar"
            style={{ width: `${Math.min(100, (progress.pago / progress.total) * 100)}%`, background: color }}
          />
        </div>
      )}
      {hint && <div className="metric-card-hint">{hint}</div>}
    </button>
  );
}
