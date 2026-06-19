import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wallet, Receipt, Calendar } from 'lucide-react';

// Navegação inferior (estilo app) exibida apenas no celular.
// Mantém só as opções do dia a dia: Dashboard, Pagamentos, Contas a Pagar e Agenda.
const ITEMS = [
  { path: '/', icon: LayoutDashboard, label: 'Início' },
  { path: '/pagamentos', icon: Wallet, label: 'Pagamentos' },
  { path: '/contas-a-pagar', icon: Receipt, label: 'A Pagar' },
  { path: '/agenda', icon: Calendar, label: 'Agenda' }
];

export default function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="mobile-nav" aria-label="Navegação principal (celular)">
      {ITEMS.map((item) => {
        const active = location.pathname === item.path;
        return (
          <button
            key={item.path}
            className={`mobile-nav-item${active ? ' active' : ''}`}
            onClick={() => navigate(item.path)}
            aria-current={active ? 'page' : undefined}
          >
            <item.icon size={22} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
