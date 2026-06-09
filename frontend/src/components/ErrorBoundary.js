import React from 'react';

// Captura erros de renderização e mostra uma tela amigável em vez de
// deixar o app em branco.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Erro de renderização capturado:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center'
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h2 style={{ margin: 0 }}>Algo deu errado nesta tela</h2>
          <p style={{ color: '#6b7280', maxWidth: 420 }}>
            Ocorreu um erro inesperado. Seus dados estão salvos — recarregue a página para continuar.
          </p>
          <button className="btn btn-primary" onClick={this.handleReload}>Recarregar</button>
        </div>
      );
    }
    return this.props.children;
  }
}
