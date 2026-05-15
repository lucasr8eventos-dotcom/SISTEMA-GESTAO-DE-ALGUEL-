import React from 'react';

export const PER_PAGE = 20;

export default function Pagination({ total, page, perPage = PER_PAGE, onChange }) {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;

  const pages = [];
  const delta = 2;
  const start = Math.max(1, page - delta);
  const end = Math.min(totalPages, page + delta);

  if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages) { if (end < totalPages - 1) pages.push('...'); pages.push(totalPages); }

  return (
    <div className="pagination">
      <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => onChange(page - 1)}>
        ← Anterior
      </button>
      {pages.map((p, i) =>
        p === '...'
          ? <span key={`e${i}`} className="pagination-ellipsis">…</span>
          : <button key={p} className={`btn btn-sm ${page === p ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onChange(p)}>{p}</button>
      )}
      <button className="btn btn-ghost btn-sm" disabled={page === totalPages} onClick={() => onChange(page + 1)}>
        Próximo →
      </button>
      <span className="pagination-info">{total} registro(s)</span>
    </div>
  );
}
