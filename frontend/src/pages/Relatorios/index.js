import React, { useState } from 'react';
import { relatoriosService, downloadBlob } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { formatMoeda, formatData, getMesAtual, getAnoAtual, MESES } from '../../utils/format';

const anos = Array.from({ length: 5 }, (_, i) => getAnoAtual() - 2 + i);

export default function Relatorios() {
  const [abaAtiva, setAbaAtiva] = useState('mensal');
  const [filtroMes, setFiltroMes] = useState(getMesAtual());
  const [filtroAno, setFiltroAno] = useState(getAnoAtual());
  const [dados, setDados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const toast = useToast();

  const buscarRelatorio = async () => {
    setLoading(true);
    setBuscou(false);
    try {
      let res;
      switch (abaAtiva) {
        case 'mensal': res = await relatoriosService.mensal({ mes: filtroMes, ano: filtroAno }); break;
        case 'inadimplencia': res = await relatoriosService.inadimplencia(); break;
        case 'imoveis-vagos': res = await relatoriosService.imoveisVagos(); break;
        case 'contratos-vencendo': res = await relatoriosService.contratosVencendo({ dias: 60 }); break;
        case 'despesas': res = await relatoriosService.despesas({ mes: filtroMes, ano: filtroAno }); break;
        default: return;
      }
      setDados(res.data);
      setBuscou(true);
    } catch {
      toast.error('Erro ao gerar relatório');
    } finally {
      setLoading(false);
    }
  };

  const exportar = async (formato) => {
    if (exportando) return;
    setExportando(true);
    try {
      const params = { tipo: abaAtiva, mes: filtroMes, ano: filtroAno };
      let res, filename;
      if (formato === 'excel') {
        res = await relatoriosService.exportarExcel(params);
        filename = `relatorio-${abaAtiva}-${filtroMes}-${filtroAno}.xlsx`;
      } else {
        res = await relatoriosService.exportarPdf(params);
        filename = `relatorio-${abaAtiva}-${filtroMes}-${filtroAno}.pdf`;
      }
      downloadBlob(res.data, filename);
      toast.success(`Exportado como ${formato.toUpperCase()}!`);
    } catch {
      toast.error('Erro ao exportar relatório');
    } finally {
      setExportando(false);
    }
  };

  const tabas = [
    { id: 'mensal', label: 'Mensal' },
    { id: 'inadimplencia', label: 'Inadimplência' },
    { id: 'imoveis-vagos', label: 'Imóveis Vagos' },
    { id: 'contratos-vencendo', label: 'Contratos Vencendo' },
    { id: 'despesas', label: 'Despesas' }
  ];

  const usaFiltroMesAno = ['mensal', 'despesas'].includes(abaAtiva);

  const renderTabela = () => {
    if (!buscou) return null;
    if (dados.length === 0) return <div className="empty-state"><p>Nenhum dado encontrado</p></div>;

    if (abaAtiva === 'mensal') {
      const total = dados.reduce((s, p) => s + parseFloat(p.valor_aluguel || 0), 0);
      const recebido = dados.filter(p => p.status === 'pago' || p.status === 'parcial').reduce((s, p) => s + parseFloat(p.valor_recebido || 0), 0);
      return (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'var(--info-light)', color: '#1a6a8a', padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 14 }}>
              Total a Receber: <strong>{formatMoeda(total)}</strong>
            </div>
            <div style={{ background: 'var(--success-light)', color: 'var(--success-dark)', padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 14 }}>
              Total Recebido: <strong>{formatMoeda(recebido)}</strong>
            </div>
            <div style={{ background: 'var(--danger-light)', color: 'var(--danger-dark)', padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 14 }}>
              Em Aberto: <strong>{formatMoeda(total - recebido)}</strong>
            </div>
          </div>
          <table>
            <thead><tr>
              <th>Imóvel</th><th>Endereço</th><th>Inquilino</th>
              <th>Valor</th><th>Recebido</th><th>Pagamento</th><th>Forma</th><th>Status</th>
            </tr></thead>
            <tbody>{dados.map((p, i) => (
              <tr key={i} style={{ background: p.status === 'pago' ? '#f0fff4' : p.status === 'atrasado' ? '#fff5f5' : p.status === 'pendente' ? '#fffff0' : '' }}>
                <td><strong>{p.imovel_codigo}</strong></td>
                <td style={{ maxWidth: 200 }}>{p.imovel_endereco}</td>
                <td>{p.inquilino_nome || '—'}</td>
                <td>{formatMoeda(p.valor_aluguel)}</td>
                <td>{p.valor_recebido ? formatMoeda(p.valor_recebido) : '—'}</td>
                <td>{formatData(p.data_pagamento)}</td>
                <td>{p.forma_pagamento || '—'}</td>
                <td><span className={`badge badge-${p.status === 'pago' ? 'success' : p.status === 'atrasado' ? 'danger' : p.status === 'parcial' ? 'info' : 'warning'}`}>{p.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </>
      );
    }

    if (abaAtiva === 'inadimplencia') return (
      <table>
        <thead><tr><th>Imóvel</th><th>Endereço</th><th>Inquilino</th><th>Telefone</th><th>Mês/Ano</th><th>Valor</th><th>Vencimento</th><th>Dias Atraso</th></tr></thead>
        <tbody>{dados.map((d, i) => (
          <tr key={i} style={{ background: '#fff5f5' }}>
            <td><strong>{d.imovel_codigo}</strong></td>
            <td>{d.imovel_endereco}</td>
            <td>{d.inquilino_nome || '—'}</td>
            <td>{d.inquilino_telefone || '—'}</td>
            <td>{d.mes}/{d.ano}</td>
            <td>{formatMoeda(d.valor_aluguel)}</td>
            <td>{formatData(d.data_vencimento)}</td>
            <td><span className="badge badge-danger">{d.dias_atraso} dias</span></td>
          </tr>
        ))}</tbody>
      </table>
    );

    if (abaAtiva === 'imoveis-vagos') return (
      <table>
        <thead><tr><th>Código</th><th>Tipo</th><th>Endereço</th><th>Valor</th><th>Status</th></tr></thead>
        <tbody>{dados.map((im, i) => (
          <tr key={i}>
            <td><strong>{im.codigo}</strong></td>
            <td>{im.tipo}</td>
            <td>{im.endereco}</td>
            <td>{formatMoeda(im.valor_sem_desconto)}</td>
            <td><span className={`badge ${im.status === 'vago' ? 'badge-warning' : 'badge-info'}`}>{im.status}</span></td>
          </tr>
        ))}</tbody>
      </table>
    );

    if (abaAtiva === 'contratos-vencendo') return (
      <table>
        <thead><tr><th>Imóvel</th><th>Endereço</th><th>Inquilino</th><th>Telefone</th><th>Valor</th><th>Vence em</th><th>Dias</th></tr></thead>
        <tbody>{dados.map((c, i) => (
          <tr key={i} style={{ background: c.dias_para_vencer <= 7 ? '#fff5f5' : '#fffff0' }}>
            <td><strong>{c.imovel_codigo}</strong></td>
            <td>{c.imovel_endereco}</td>
            <td>{c.inquilino_nome}</td>
            <td>{c.inquilino_telefone}</td>
            <td>{formatMoeda(c.valor)}</td>
            <td>{formatData(c.data_fim)}</td>
            <td>
              <span className={`badge ${c.dias_para_vencer <= 7 ? 'badge-danger' : 'badge-warning'}`}>
                {c.dias_para_vencer} dias
              </span>
            </td>
          </tr>
        ))}</tbody>
      </table>
    );

    if (abaAtiva === 'despesas') {
      const total = dados.reduce((s, d) => s + parseFloat(d.valor || 0), 0);
      return (
        <>
          <div style={{ marginBottom: 16, padding: '8px 16px', background: 'var(--danger-light)', color: 'var(--danger-dark)', borderRadius: 'var(--radius)', display: 'inline-block', fontSize: 14 }}>
            Total: <strong>{formatMoeda(total)}</strong>
          </div>
          <table>
            <thead><tr><th>Imóvel</th><th>Tipo</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead>
            <tbody>{dados.map((d, i) => (
              <tr key={i}>
                <td><strong>{d.imovel_codigo}</strong></td>
                <td>{d.tipo}</td>
                <td>{d.descricao || '—'}</td>
                <td>{formatMoeda(d.valor)}</td>
                <td>{formatData(d.vencimento)}</td>
                <td><span className={`badge badge-${d.status === 'pago' ? 'success' : d.status === 'atrasado' ? 'danger' : 'warning'}`}>{d.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </>
      );
    }
    return null;
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Relatórios</h1>
          <p>Gere e exporte relatórios do sistema</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body">
          <div className="tabs">
            {tabas.map(t => (
              <button
                key={t.id}
                className={`tab-btn${abaAtiva === t.id ? ' active' : ''}`}
                onClick={() => { setAbaAtiva(t.id); setDados([]); setBuscou(false); }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {usaFiltroMesAno && (
              <>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Mês</label>
                  <select className="form-control filter-select" value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)}>
                    {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Ano</label>
                  <select className="form-control filter-select" value={filtroAno} onChange={(e) => setFiltroAno(e.target.value)}>
                    {anos.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </>
            )}
            <button className="btn btn-primary" onClick={buscarRelatorio} disabled={loading}>
              {loading ? 'Gerando...' : 'Gerar Relatório'}
            </button>
            {buscou && dados.length > 0 && (
              <>
                <button className="btn btn-success btn-sm" onClick={() => exportar('excel')} disabled={exportando}>
                  {exportando ? '...' : 'Excel'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => exportar('pdf')} disabled={exportando}>
                  {exportando ? '...' : 'PDF'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {buscou && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              {tabas.find(t => t.id === abaAtiva)?.label} — {dados.length} resultado(s)
            </span>
          </div>
          <div className="card-body">
            <div className="table-wrapper">
              {renderTabela()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
