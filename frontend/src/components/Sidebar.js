import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, Building2, FileText, Wallet, Receipt, ReceiptText, BarChart2, Settings, LogOut, Calendar, AlertTriangle } from 'lucide-react';

const buildNavItems = (isAdmin) => [
  {
    section: 'Principal',
    items: [
      { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/agenda', icon: Calendar, label: 'Agenda' }
    ]
  },
  {
    section: 'Imóveis',
    items: [
      { path: '/imoveis', icon: Building2, label: 'Imóveis' }
    ]
  },
  {
    section: 'Contratos',
    items: [
      { path: '/contratos', icon: FileText, label: 'Contratos' }
    ]
  },
  {
    section: 'Financeiro',
    items: [
      { path: '/pagamentos', icon: Wallet, label: 'Pagamentos' },
      { path: '/inadimplencia', icon: AlertTriangle, label: 'Inadimplência' },
      { path: '/despesas', icon: Receipt, label: 'Contas a Pagar' },
      { path: '/recibos', icon: ReceiptText, label: 'Recibos' }
    ]
  },
  {
    section: 'Análise',
    items: [
      { path: '/relatorios', icon: BarChart2, label: 'Relatórios' }
    ]
  },
  ...(isAdmin ? [{
    section: 'Administração',
    items: [
      { path: '/usuarios', icon: Settings, label: 'Usuários' }
    ]
  }] : [])
];

export default function Sidebar({ collapsed, mobileOpen }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, logout } = useAuth();

  const allItems = buildNavItems(isAdmin);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' open' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-icon"><Building2 size={20} /></div>
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
                <span className="nav-icon"><item.icon size={18} /></span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="nav-item" onClick={handleLogout} title={collapsed ? 'Sair' : ''}>
          <span className="nav-icon"><LogOut size={18} /></span>
          <span className="nav-label">Sair</span>
        </button>
      </div>
    </aside>
  );
}
