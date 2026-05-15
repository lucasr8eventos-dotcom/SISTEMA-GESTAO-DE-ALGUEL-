import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Imoveis from './pages/Imoveis';
import Inquilinos from './pages/Inquilinos';
import Contratos from './pages/Contratos';
import Pagamentos from './pages/Pagamentos';
import Despesas from './pages/Despesas';
import Reajustes from './pages/Reajustes';
import Relatorios from './pages/Relatorios';
import Usuarios from './pages/Usuarios';

function PrivateRoute({ children, adminOnly = false }) {
  const { usuario, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!usuario) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;

  return <Layout>{children}</Layout>;
}

function PublicRoute({ children }) {
  const { usuario, loading } = useAuth();
  if (loading) return null;
  if (usuario) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <Login />
                </PublicRoute>
              }
            />
            <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/imoveis" element={<PrivateRoute><Imoveis /></PrivateRoute>} />
            <Route path="/inquilinos" element={<PrivateRoute><Inquilinos /></PrivateRoute>} />
            <Route path="/contratos" element={<PrivateRoute><Contratos /></PrivateRoute>} />
            <Route path="/pagamentos" element={<PrivateRoute><Pagamentos /></PrivateRoute>} />
            <Route path="/despesas" element={<PrivateRoute><Despesas /></PrivateRoute>} />
            <Route path="/reajustes" element={<PrivateRoute><Reajustes /></PrivateRoute>} />
            <Route path="/relatorios" element={<PrivateRoute><Relatorios /></PrivateRoute>} />
            <Route path="/usuarios" element={<PrivateRoute adminOnly><Usuarios /></PrivateRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
