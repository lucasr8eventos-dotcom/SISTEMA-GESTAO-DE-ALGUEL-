import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

export default function Login() {
  const [form, setForm] = useState({ email: '', senha: '' });
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro('');
    setLoading(true);
    try {
      await login(form.email, form.senha);
      toast.success('Bem-vindo ao sistema!');
      navigate('/');
    } catch (err) {
      setErro(err.response?.data?.error || 'Erro ao fazer login. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-box">🏢</div>
          <h1>GestãoAluguel</h1>
          <p>Sistema de Gestão de Imóveis</p>
        </div>

        <form onSubmit={handleSubmit}>
          {erro && (
            <div className="alert alert-danger" style={{ marginBottom: 16 }}>
              <span>⚠</span> {erro}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">E-mail</label>
            <input
              type="email"
              className="form-control"
              placeholder="seu@email.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Senha</label>
            <input
              type="password"
              className="form-control"
              placeholder="••••••••"
              value={form.senha}
              onChange={(e) => setForm({ ...form, senha: e.target.value })}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: 8 }}
            disabled={loading}
          >
            {loading ? '⏳ Entrando...' : '🔐 Entrar'}
          </button>
        </form>

        {process.env.NODE_ENV === 'development' && (
          <div style={{ marginTop: 24, padding: 16, background: 'var(--gray-50)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--gray-500)', border: '1px dashed var(--gray-300)' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>🛠 Ambiente de desenvolvimento</div>
            <div>Admin: admin@sistema.com / admin123</div>
            <div>Operador: operador@sistema.com / admin123</div>
          </div>
        )}
      </div>
    </div>
  );
}
