import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

const pageTitles = {
  '/': { title: 'Dashboard', subtitle: 'Visão geral do sistema' },
  '/imoveis': { title: 'Imóveis', subtitle: 'Cadastro e gerenciamento de imóveis' },
  '/inquilinos': { title: 'Inquilinos', subtitle: 'Cadastro de inquilinos' },
  '/contratos': { title: 'Contratos', subtitle: 'Gerenciamento de contratos' },
  '/pagamentos': { title: 'Pagamentos', subtitle: 'Controle mensal de aluguéis' },
  '/despesas': { title: 'Despesas', subtitle: 'Despesas fixas dos imóveis' },
  '/reajustes': { title: 'Reajustes', subtitle: 'Controle de reajustes contratuais' },
  '/relatorios': { title: 'Relatórios', subtitle: 'Relatórios e exportações' },
  '/usuarios': { title: 'Usuários', subtitle: 'Gerenciamento de usuários do sistema' }
};

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { title, subtitle } = pageTitles[location.pathname] || { title: 'Sistema', subtitle: '' };

  // Close mobile sidebar on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const handleToggle = () => {
    if (window.innerWidth <= 768) {
      setMobileOpen(prev => !prev);
    } else {
      setCollapsed(prev => !prev);
    }
  };

  return (
    <div className="app-layout">
      {mobileOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
      )}
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onCollapse={handleToggle} />
      <div className={`main-content${collapsed ? ' sidebar-collapsed' : ''}`}>
        <Topbar
          title={title}
          subtitle={subtitle}
          collapsed={collapsed}
          onToggleSidebar={handleToggle}
        />
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
