import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { recibosService, downloadBlob } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal, { ConfirmDialog } from '../../components/Modal';
import { MoneyInput, CpfCnpjInput, PhoneInput } from '../../components/MaskedInput';
import Pagination, { PER_PAGE } from '../../components/Pagination';
import { EmptyState, ErrorState } from '../../components/StateViews';
import { formatMoeda, formatData } from '../../utils/format';
import { valorPorExtenso, FORMAS_PAGAMENTO_RECIBO, formaReciboLabel } from '../../utils/extenso';
import { ReceiptText, Download, Trash2, Pencil, Users, Building2, Plus, FileText } from 'lucide-react';

const hoje = () => new Date().toISOString().split('T')[0];

const FORM_INICIAL = {
  recebedorSel: 'manual',
  recebedor_nome: '',
  recebedor_documento: '',
  salvar_recebedor: false,
  pagadorSel: 'manual',
  pagador_nome: '',
  pagador_documento: '',
  salvar_pagador: false,
  valor: '',
  forma_pagamento: 'pix',
  data_pagamento: hoje(),
  local: 'Brasília',
  referente: '',
  com_canhoto: true
};

const REC_FORM_INICIAL = {
  nome: '', documento: '', endereco: '', telefone: '',
  whatsapp: '', email: '', site: '', logo_url: '', padrao: false
};

export default function Recibos() {
  const [recibos, setRecibos] = useState([]);
  const [recebedores, setRecebedores] = useState([]);
  const [pagadores, setPagadores] = useState([]);
  const [proximo, setProximo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [gerando, setGerando] = useState(false);
  const [page, setPage] = useState(1);
  const [confirmExcluir, setConfirmExcluir] = useState(null);

  // Modais de gerenciamento
  const [recManagerOpen, setRecManagerOpen] = useState(false);
  const [pagManagerOpen, setPagManagerOpen] = useState(false);

  const toast = useToast();
  const { isAdmin } = useAuth();

  const setF = (campo, valor) => setForm((p) => ({ ...p, [campo]: valor }));

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const [r, rec, pag, prox] = await Promise.all([
        recibosService.listar(),
        recibosService.listarRecebedores(),
        recibosService.listarPagadores(),
        recibosService.proximoNumero()
      ]);
      setRecibos(r.data);
      setRecebedores(rec.data);
      setPagadores(pag.data);
      setProximo(prox.data.proximo);
      // Pré-seleciona o recebedor padrão, se houver
      const padrao = rec.data.find((x) => x.padrao);
      if (padrao) setForm((p) => (p.recebedorSel === 'manual' && !p.recebedor_nome ? { ...p, recebedorSel: String(padrao.id) } : p));
    } catch (err) {
      setErro(err.response?.data?.error || 'Não foi possível carregar os recibos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const recarregarRecebedores = async () => {
    const r = await recibosService.listarRecebedores();
    setRecebedores(r.data);
  };
  const recarregarPagadores = async () => {
    const r = await recibosService.listarPagadores();
    setPagadores(r.data);
  };

  const extensoPreview = useMemo(
    () => (form.valor ? valorPorExtenso(parseFloat(form.valor)) : ''),
    [form.valor]
  );

  const baixarPdf = async (recibo) => {
    try {
      const res = await recibosService.pdf(recibo.id);
      downloadBlob(res.data, `recibo-${String(recibo.numero).padStart(4, '0')}.pdf`);
    } catch (err) {
      toast.error('Erro ao baixar o PDF do recibo');
    }
  };

  const handleGerar = async (e) => {
    e.preventDefault();
    // Validação client-side
    if (form.recebedorSel === 'manual' && !form.recebedor_nome.trim()) {
      toast.error('Informe quem está recebendo');
      return;
    }
    if (form.pagadorSel === 'manual' && !form.pagador_nome.trim()) {
      toast.error('Informe quem está pagando');
      return;
    }
    if (!form.valor || parseFloat(form.valor) <= 0) {
      toast.error('Informe um valor maior que zero');
      return;
    }
    if (!form.referente.trim()) {
      toast.error('Informe a que se refere o pagamento');
      return;
    }

    const payload = {
      valor: parseFloat(form.valor),
      data_pagamento: form.data_pagamento,
      referente: form.referente.trim(),
      forma_pagamento: form.forma_pagamento || undefined,
      local: form.local || undefined,
      com_canhoto: form.com_canhoto
    };
    if (form.recebedorSel === 'manual') {
      payload.recebedor_nome = form.recebedor_nome.trim();
      payload.recebedor_documento = form.recebedor_documento || undefined;
      payload.salvar_recebedor = form.salvar_recebedor;
    } else {
      payload.recebedor_id = Number(form.recebedorSel);
    }
    if (form.pagadorSel === 'manual') {
      payload.pagador_nome = form.pagador_nome.trim();
      payload.pagador_documento = form.pagador_documento || undefined;
      payload.salvar_pagador = form.salvar_pagador;
    } else {
      payload.pagador_id = Number(form.pagadorSel);
    }

    setGerando(true);
    try {
      const res = await recibosService.criar(payload);
      toast.success(`Recibo Nº ${String(res.data.numero).padStart(4, '0')} gerado!`);
      await baixarPdf(res.data);
      // limpa campos do pagamento mantendo o recebedor escolhido
      setForm((p) => ({
        ...p,
        pagadorSel: 'manual', pagador_nome: '', pagador_documento: '', salvar_pagador: false,
        valor: '', referente: '', com_canhoto: true, data_pagamento: hoje()
      }));
      await carregar();
    } catch (err) {
      const det = err.response?.data?.detalhes?.[0]?.msg;
      toast.error(det || err.response?.data?.error || 'Erro ao gerar recibo');
    } finally {
      setGerando(false);
    }
  };

  const handleExcluir = async () => {
    try {
      await recibosService.excluir(confirmExcluir.id);
      toast.success('Recibo excluído!');
      setConfirmExcluir(null);
      carregar();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  const paginados = recibos.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const recebedorSelObj = recebedores.find((r) => String(r.id) === form.recebedorSel);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Recibos</h1>
          <p>
            {recibos.length} recibo(s) emitido(s)
            {proximo != null && <> · próximo Nº <strong>{String(proximo).padStart(4, '0')}</strong></>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setRecManagerOpen(true)}>
            <Building2 size={14} /> Recebedores
          </button>
          <button className="btn btn-ghost" onClick={() => setPagManagerOpen(true)}>
            <Users size={14} /> Pagadores
          </button>
        </div>
      </div>

      {erro && <ErrorState message={erro} onRetry={carregar} />}

      <div className="recibos-layout" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
        {/* ===== Formulário de geração ===== */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ReceiptText size={18} /> Gerar novo recibo
          </h3>
          <form onSubmit={handleGerar}>
            <div className="form-grid">
              {/* Recebedor */}
              <div className="form-group">
                <label className="form-label">Quem está recebendo <span className="required">*</span></label>
                <select
                  className="form-control"
                  value={form.recebedorSel}
                  onChange={(e) => setF('recebedorSel', e.target.value)}
                >
                  <option value="manual">✏️ Digitar manualmente</option>
                  {recebedores.length > 0 && <optgroup label="Recebedores salvos">
                    {recebedores.map((r) => (
                      <option key={r.id} value={r.id}>{r.nome}{r.padrao ? ' (padrão)' : ''}</option>
                    ))}
                  </optgroup>}
                </select>
                {form.recebedorSel === 'manual' ? (
                  <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                    <input
                      className="form-control"
                      placeholder="Nome / empresa que recebe"
                      value={form.recebedor_nome}
                      onChange={(e) => setF('recebedor_nome', e.target.value)}
                    />
                    <CpfCnpjInput value={form.recebedor_documento} onChange={(v) => setF('recebedor_documento', v)} />
                    <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--gray-600)' }}>
                      <input type="checkbox" checked={form.salvar_recebedor} onChange={(e) => setF('salvar_recebedor', e.target.checked)} />
                      Salvar este recebedor para reutilizar
                    </label>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRecManagerOpen(true)} style={{ justifySelf: 'start' }}>
                      <Plus size={13} /> Cadastrar recebedor completo (com logo)
                    </button>
                  </div>
                ) : (
                  recebedorSelObj && (
                    <div className="form-hint" style={{ marginTop: 6 }}>
                      {recebedorSelObj.documento ? `CNPJ/CPF: ${recebedorSelObj.documento}` : 'Sem documento'} ·{' '}
                      {recebedorSelObj.logo_url ? 'logo cadastrada' : 'sem logo'}
                    </div>
                  )
                )}
              </div>

              {/* Pagador */}
              <div className="form-group">
                <label className="form-label">Quem está pagando <span className="required">*</span></label>
                <select
                  className="form-control"
                  value={form.pagadorSel}
                  onChange={(e) => setF('pagadorSel', e.target.value)}
                >
                  <option value="manual">✏️ Digitar manualmente</option>
                  {pagadores.length > 0 && <optgroup label="Pagadores salvos">
                    {pagadores.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </optgroup>}
                </select>
                {form.pagadorSel === 'manual' && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                    <input
                      className="form-control"
                      placeholder="Nome do pagador"
                      value={form.pagador_nome}
                      onChange={(e) => setF('pagador_nome', e.target.value)}
                    />
                    <CpfCnpjInput value={form.pagador_documento} onChange={(v) => setF('pagador_documento', v)} />
                    <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--gray-600)' }}>
                      <input type="checkbox" checked={form.salvar_pagador} onChange={(e) => setF('salvar_pagador', e.target.checked)} />
                      Salvar este pagador para reutilizar
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Valor <span className="required">*</span></label>
                <MoneyInput value={form.valor} onChange={(v) => setF('valor', v)} />
                {extensoPreview && (
                  <div className="form-hint" style={{ marginTop: 4, fontStyle: 'italic', textTransform: 'capitalize' }}>
                    {extensoPreview}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Forma de pagamento</label>
                <select className="form-control" value={form.forma_pagamento} onChange={(e) => setF('forma_pagamento', e.target.value)}>
                  {FORMAS_PAGAMENTO_RECIBO.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Data do pagamento</label>
                <input className="form-control" type="date" value={form.data_pagamento} onChange={(e) => setF('data_pagamento', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Local (cidade)</label>
                <input className="form-control" value={form.local} onChange={(e) => setF('local', e.target.value)} placeholder="Brasília" />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Referente a <span className="required">*</span></label>
              <input className="form-control" value={form.referente} onChange={(e) => setF('referente', e.target.value)} placeholder="Ex.: aluguel de junho/2026, serviço prestado, etc." />
            </div>

            <div className="form-group">
              <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={form.com_canhoto} onChange={(e) => setF('com_canhoto', e.target.checked)} />
                Incluir canhoto destacável
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" type="submit" disabled={gerando}>
                <FileText size={15} /> {gerando ? 'Gerando...' : 'Gerar recibo (PDF)'}
              </button>
            </div>
          </form>
        </div>

        {/* ===== Lista de recibos emitidos ===== */}
        <div className="card">
          <div className="table-wrapper">
            {loading ? (
              <div className="loading-spinner"><div className="spinner" /></div>
            ) : recibos.length === 0 ? (
              <EmptyState
                icon={<ReceiptText size={48} />}
                title="Nenhum recibo emitido"
                message="Preencha o formulário acima para gerar seu primeiro recibo."
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Pagador</th>
                    <th>Recebedor</th>
                    <th>Valor</th>
                    <th>Forma</th>
                    <th>Data</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {paginados.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{String(r.numero).padStart(4, '0')}</strong></td>
                      <td>
                        {r.pagador_nome}
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{r.referente}</div>
                      </td>
                      <td>{r.recebedor_nome}</td>
                      <td>{formatMoeda(r.valor)}</td>
                      <td><span className="chip">{formaReciboLabel(r.forma_pagamento)}</span></td>
                      <td>{formatData(r.data_pagamento)}</td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" title="Baixar PDF" onClick={() => baixarPdf(r)}><Download size={14} /></button>
                          {isAdmin && <button className="btn btn-outline-danger btn-sm btn-icon" title="Excluir" onClick={() => setConfirmExcluir(r)}><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pagination total={recibos.length} page={page} perPage={PER_PAGE} onChange={setPage} />
        </div>
      </div>

      <RecebedorManager
        isOpen={recManagerOpen}
        onClose={() => setRecManagerOpen(false)}
        recebedores={recebedores}
        onChange={recarregarRecebedores}
        toast={toast}
        isAdmin={isAdmin}
      />
      <PagadorManager
        isOpen={pagManagerOpen}
        onClose={() => setPagManagerOpen(false)}
        pagadores={pagadores}
        onChange={recarregarPagadores}
        toast={toast}
        isAdmin={isAdmin}
      />

      <ConfirmDialog
        isOpen={!!confirmExcluir}
        onClose={() => setConfirmExcluir(null)}
        onConfirm={handleExcluir}
        title="Excluir Recibo"
        message={`Excluir o recibo Nº ${confirmExcluir ? String(confirmExcluir.numero).padStart(4, '0') : ''}? Esta ação não pode ser desfeita.`}
      />
    </div>
  );
}

// ============================================================
// Gerenciador de Recebedores (lista + formulário no mesmo modal)
// ============================================================
function RecebedorManager({ isOpen, onClose, recebedores, onChange, toast, isAdmin }) {
  const [view, setView] = useState('list'); // 'list' | 'form'
  const [form, setForm] = useState(REC_FORM_INICIAL);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => { if (isOpen) { setView('list'); setEditando(null); setForm(REC_FORM_INICIAL); } }, [isOpen]);

  const setF = (c, v) => setForm((p) => ({ ...p, [c]: v }));

  const novo = () => { setEditando(null); setForm(REC_FORM_INICIAL); setView('form'); };
  const editar = (r) => {
    setEditando(r.id);
    setForm({
      nome: r.nome || '', documento: r.documento || '', endereco: r.endereco || '',
      telefone: r.telefone || '', whatsapp: r.whatsapp || '', email: r.email || '',
      site: r.site || '', logo_url: r.logo_url || '', padrao: !!r.padrao
    });
    setView('form');
  };

  const handleLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEnviandoLogo(true);
    try {
      const res = await recibosService.uploadLogo(file);
      setF('logo_url', res.data.logo_url);
      toast.success('Logo enviada!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao enviar logo');
    } finally {
      setEnviandoLogo(false);
    }
  };

  const salvar = async (e) => {
    e.preventDefault();
    if (!form.nome.trim()) { toast.error('Informe o nome'); return; }
    setSalvando(true);
    try {
      if (editando) {
        await recibosService.atualizarRecebedor(editando, form);
        toast.success('Recebedor atualizado!');
      } else {
        await recibosService.criarRecebedor(form);
        toast.success('Recebedor cadastrado!');
      }
      await onChange();
      setView('list');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar recebedor');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    try {
      await recibosService.excluirRecebedor(confirm.id);
      toast.success('Recebedor excluído!');
      setConfirm(null);
      await onChange();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={view === 'form' ? (editando ? 'Editar recebedor' : 'Novo recebedor') : 'Recebedores salvos'}
        footer={
          view === 'list' ? (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
              <button className="btn btn-primary" onClick={novo}><Plus size={14} /> Novo recebedor</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setView('list')}>Voltar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
            </>
          )
        }
      >
        {view === 'list' ? (
          recebedores.length === 0 ? (
            <p style={{ color: 'var(--gray-500)' }}>Nenhum recebedor cadastrado. Clique em “Novo recebedor”.</p>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Nome</th><th>Documento</th><th>Padrão</th><th>Ações</th></tr></thead>
                <tbody>
                  {recebedores.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.nome}</strong></td>
                      <td>{r.documento || '—'}</td>
                      <td>{r.padrao ? <span className="badge badge-success">Padrão</span> : '—'}</td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => editar(r)}><Pencil size={14} /></button>
                          {isAdmin && <button className="btn btn-outline-danger btn-sm btn-icon" onClick={() => setConfirm(r)}><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <form onSubmit={salvar}>
            <div className="form-group">
              <label className="form-label">Nome / Empresa <span className="required">*</span></label>
              <input className="form-control" value={form.nome} onChange={(e) => setF('nome', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">CNPJ / CPF</label>
              <CpfCnpjInput value={form.documento} onChange={(v) => setF('documento', v)} />
            </div>
            <div className="form-group">
              <label className="form-label">Endereço</label>
              <input className="form-control" value={form.endereco} onChange={(e) => setF('endereco', e.target.value)} />
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Telefone</label>
                <PhoneInput value={form.telefone} onChange={(v) => setF('telefone', v)} />
              </div>
              <div className="form-group">
                <label className="form-label">WhatsApp</label>
                <PhoneInput value={form.whatsapp} onChange={(v) => setF('whatsapp', v)} />
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">E-mail</label>
                <input className="form-control" type="email" value={form.email} onChange={(e) => setF('email', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Site</label>
                <input className="form-control" value={form.site} onChange={(e) => setF('site', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Logo (PNG ou JPG)</label>
              <input className="form-control" type="file" accept="image/png,image/jpeg" onChange={handleLogo} disabled={enviandoLogo} />
              {enviandoLogo && <div className="form-hint">Enviando...</div>}
              {form.logo_url && !enviandoLogo && <div className="form-hint" style={{ color: 'var(--success)' }}>✓ Logo enviada</div>}
            </div>
            <div className="form-group">
              <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={form.padrao} onChange={(e) => setF('padrao', e.target.checked)} />
                Usar como recebedor padrão
              </label>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={excluir}
        title="Excluir recebedor"
        message={`Excluir o recebedor “${confirm?.nome}”? Recibos já emitidos não serão alterados.`}
      />
    </>
  );
}

// ============================================================
// Gerenciador de Pagadores
// ============================================================
function PagadorManager({ isOpen, onClose, pagadores, onChange, toast, isAdmin }) {
  const [view, setView] = useState('list');
  const [form, setForm] = useState({ nome: '', documento: '' });
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => { if (isOpen) { setView('list'); setEditando(null); setForm({ nome: '', documento: '' }); } }, [isOpen]);

  const setF = (c, v) => setForm((p) => ({ ...p, [c]: v }));
  const novo = () => { setEditando(null); setForm({ nome: '', documento: '' }); setView('form'); };
  const editar = (p) => { setEditando(p.id); setForm({ nome: p.nome || '', documento: p.documento || '' }); setView('form'); };

  const salvar = async (e) => {
    e.preventDefault();
    if (!form.nome.trim()) { toast.error('Informe o nome'); return; }
    setSalvando(true);
    try {
      if (editando) {
        await recibosService.atualizarPagador(editando, form);
        toast.success('Pagador atualizado!');
      } else {
        await recibosService.criarPagador(form);
        toast.success('Pagador cadastrado!');
      }
      await onChange();
      setView('list');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar pagador');
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    try {
      await recibosService.excluirPagador(confirm.id);
      toast.success('Pagador excluído!');
      setConfirm(null);
      await onChange();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao excluir');
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={view === 'form' ? (editando ? 'Editar pagador' : 'Novo pagador') : 'Pagadores salvos'}
        footer={
          view === 'list' ? (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
              <button className="btn btn-primary" onClick={novo}><Plus size={14} /> Novo pagador</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setView('list')}>Voltar</button>
              <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
            </>
          )
        }
      >
        {view === 'list' ? (
          pagadores.length === 0 ? (
            <p style={{ color: 'var(--gray-500)' }}>Nenhum pagador cadastrado. Clique em “Novo pagador”.</p>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Nome</th><th>Documento</th><th>Ações</th></tr></thead>
                <tbody>
                  {pagadores.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.nome}</strong></td>
                      <td>{p.documento || '—'}</td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => editar(p)}><Pencil size={14} /></button>
                          {isAdmin && <button className="btn btn-outline-danger btn-sm btn-icon" onClick={() => setConfirm(p)}><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <form onSubmit={salvar}>
            <div className="form-group">
              <label className="form-label">Nome <span className="required">*</span></label>
              <input className="form-control" value={form.nome} onChange={(e) => setF('nome', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">CPF / CNPJ</label>
              <CpfCnpjInput value={form.documento} onChange={(v) => setF('documento', v)} />
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={excluir}
        title="Excluir pagador"
        message={`Excluir o pagador “${confirm?.nome}”?`}
      />
    </>
  );
}
