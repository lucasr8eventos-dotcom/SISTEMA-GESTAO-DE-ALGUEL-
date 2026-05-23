import React from 'react';
import { Search, X } from 'lucide-react';

export default function SearchInput({ value, onChange, placeholder = 'Buscar...', label = 'Busca' }) {
  return (
    <div className="filter-field filter-field-grow">
      <label className="filter-label">{label}</label>
      <div className="search-input-wrap">
        <span className="search-icon"><Search size={16} /></span>
        <input
          className="form-control"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button
            type="button"
            className="search-clear"
            onClick={() => onChange('')}
            aria-label="Limpar busca"
          ><X size={14} /></button>
        )}
      </div>
    </div>
  );
}
