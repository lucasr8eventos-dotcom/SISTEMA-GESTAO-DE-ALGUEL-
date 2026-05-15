import React, { useState } from 'react';
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
  const location = useLocation();
  const { title, subtitle } = pageTitles[location.pathname] || { title: 'Sistema', subtitle: '' };

  return (
    <div className="app-layout">
      <Sidebar collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)} />
      <div className={`main-content${collapsed ? ' sidebar-collapsed' : ''}`}>
        <Topbar
          title={title}
          subtitle={subtitle}
          collapsed={collapsed}
          onToggleSidebar={() => setCollapsed(!collapsed)}
        />
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
