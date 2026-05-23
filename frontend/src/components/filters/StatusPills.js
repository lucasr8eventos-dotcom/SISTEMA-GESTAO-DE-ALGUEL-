import React from 'react';

export default function StatusPills({ options, value, onChange, counts = {} }) {
  return (
    <div className="status-pills" role="tablist" aria-label="Filtrar por status">
      {options.map((opt) => {
        const isActive = value === opt.value || (!value && opt.value === '');
        const count = counts[opt.value];
        return (
          <button
            key={opt.value || 'all'}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`status-pill status-pill-${opt.color || 'gray'}${isActive ? ' active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            <span className="status-pill-dot" />
            <span>{opt.label}</span>
            {typeof count === 'number' && count > 0 && (
              <span className="status-pill-count">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
