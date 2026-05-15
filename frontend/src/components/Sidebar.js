import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  {
    section: 'Principal',
    items: [
      { path: '/', icon: '📊', label: 'Dashboard' }
    ]
  },
  {
    section: 'Cadastros',
    items: [
      { path: '/imoveis', icon: '🏠', label: 'Imóveis' },
      { path: '/inquilinos', icon: '👤', label: 'Inquilinos' },
      { path: '/contratos', icon: '📋', label: 'Contratos' }
    ]
  },
  {
    section: 'Financeiro',
    items: [
      { path: '/pagamentos', icon: '💰', label: 'Pagamentos' },
      { path: '/despesas', icon: '📄', label: 'Despesas' },
      { path: '/reajustes', icon: '📈', label: 'Reajustes' }
    ]
  },
  {
    section: 'Análise',
    items: [
      { path: '/relatorios', icon: '📑', label: 'Relatórios' }
    ]
  }
];

const adminItems = [
  {
    section: 'Administração',
    items: [
      { path: '/usuarios', icon: '⚙️', label: 'Usuários' }
    ]
  }
];

export default function Sidebar({ collapsed, onCollapse }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, usuario, logout } = useAuth();

  const allItems = isAdmin ? [...navItems, ...adminItems] : navItems;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-icon">🏢</div>
        <span className="logo-text">GestãoAluguel</span>
      </div>

      <nav className="sidebar-nav">
        {allItems.map((section) => (
          <div className="nav-section" key={section.section}>
            <div className="nav-section-label">{section.section}</div>
            {section.items.map((item) => (
              <button
                key={item.path}
                className={`nav-item${location.pathname === item.path ? ' active' : ''}`}
                onClick={() => navigate(item.path)}
                title={collapsed ? item.label : ''}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="nav-item" onClick={handleLogout} title={collapsed ? 'Sair' : ''}>
          <span className="nav-icon">🚪</span>
          <span className="nav-label">Sair</span>
        </button>
      </div>
    </aside>
  );
}
