import React, { useEffect } from 'react';

export default function Modal({ isOpen, onClose, title, children, footer, size = '', className = '' }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape' && isOpen) onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${size ? ' modal-' + size : ''} ${className}`}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Excluir', confirmClass = 'btn-danger', extraAction }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay">
      <div className="modal confirm-dialog">
        <div className="modal-header">
          <h2 className="modal-title">{title || 'Confirmar ação'}</h2>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--gray-700)', lineHeight: 1.6 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          {extraAction && (
            <button className={`btn ${extraAction.className || 'btn-danger'}`} onClick={() => { extraAction.onClick(); onClose(); }}>
              {extraAction.label}
            </button>
          )}
          <button className={`btn ${confirmClass}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
