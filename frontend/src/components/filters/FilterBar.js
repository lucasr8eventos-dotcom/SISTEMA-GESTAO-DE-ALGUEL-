import React from 'react';
import { X } from 'lucide-react';

export default function FilterBar({ children, hasActive, onClear }) {
  return (
    <div className="filter-bar">
      <div className="filter-bar-fields">{children}</div>
      {hasActive && (
        <button type="button" className="filter-clear" onClick={onClear}>
          <X size={14} /> Limpar filtros
        </button>
      )}
    </div>
  );
}
