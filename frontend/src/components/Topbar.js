import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Topbar({ title, subtitle, collapsed, onToggleSidebar }) {
  const { usuario } = useAuth();

  const initials = usuario?.nome
    ? usuario.nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : 'U';

  return (
    <header className={`topbar${collapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="topbar-left">
        <button
          className="btn btn-ghost btn-icon"
          onClick={onToggleSidebar}
          title="Expandir/Recolher menu"
        >
          ☰
        </button>
        <div>
          <div className="topbar-title">{title}</div>
          {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div className="topbar-right">
        <div className="user-menu">
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <div className="user-name">{usuario?.nome}</div>
            <div className="user-role">{usuario?.perfil === 'admin' ? 'Administrador' : 'Operador'}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
