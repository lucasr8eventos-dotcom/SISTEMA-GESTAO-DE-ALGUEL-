import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { authService } from '../services/api';

// ============================================================
// ⚠️  MODO MOCK TEMPORÁRIO - REMOVER ANTES DE PRODUÇÃO ⚠️
// Bypass de autenticação para desenvolvimento sem backend.
// Para desativar: defina MOCK_AUTH = false (ou reverta este arquivo).
// ============================================================
const MOCK_AUTH = true;
const MOCK_USER = {
  id: 1,
  nome: 'Admin (modo teste)',
  email: 'admin@sistema.com',
  perfil: 'admin',
  status: 'ativo'
};

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [usuario, setUsuario] = useState(() => {
    if (MOCK_AUTH) return MOCK_USER;
    try { return JSON.parse(localStorage.getItem('usuario')); } catch { return null; }
  });
  const [loading, setLoading] = useState(!MOCK_AUTH);

  const logout = useCallback(() => {
    if (MOCK_AUTH) return;
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    setUsuario(null);
  }, []);

  const login = useCallback(async (email, senha) => {
    if (MOCK_AUTH) {
      setUsuario(MOCK_USER);
      return { usuario: MOCK_USER, token: 'mock-token' };
    }
    const res = await authService.login(email, senha);
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('usuario', JSON.stringify(res.data.usuario));
    setUsuario(res.data.usuario);
    return res.data;
  }, []);

  useEffect(() => {
    if (MOCK_AUTH) {
      setLoading(false);
      return;
    }
    const token = localStorage.getItem('token');
    if (token) {
      authService.verify()
        .then((res) => {
          if (!res.data.valid) logout();
        })
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [logout]);

  const value = useMemo(() => ({
    usuario,
    login,
    logout,
    isAdmin: usuario?.perfil === 'admin',
    loading
  }), [usuario, login, logout, loading]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
};
