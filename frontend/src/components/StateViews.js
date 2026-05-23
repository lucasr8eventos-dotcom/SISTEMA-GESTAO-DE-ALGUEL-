import React from 'react';
import { AlertCircle, RefreshCw, Filter } from 'lucide-react';

export function EmptyState({ icon, title, message, action }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function EmptyFiltered({ onClear, icon }) {
  return (
    <EmptyState
      icon={icon || <Filter size={48} />}
      title="Nenhum resultado para os filtros aplicados"
      message="Ajuste ou limpe os filtros para ver mais resultados."
      action={
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          Limpar filtros
        </button>
      }
    />
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state">
      <div className="error-state-icon"><AlertCircle size={28} /></div>
      <div className="error-state-info">
        <div className="error-state-title">Erro ao carregar dados</div>
        <div className="error-state-message">{message || 'Verifique sua conexão e tente novamente.'}</div>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
          <RefreshCw size={14} /> Tentar novamente
        </button>
      )}
    </div>
  );
}
