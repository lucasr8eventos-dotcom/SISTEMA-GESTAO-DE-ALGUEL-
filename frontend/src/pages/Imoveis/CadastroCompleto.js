import React, { useState, useEffect } from 'react';
import Modal from '../../components/Modal';
import { MoneyInput, CpfCnpjInput, PhoneInput } from '../../components/MaskedInput';
import { imoveisService } from '../../services/api';
import { formatMoeda, formatData } from '../../utils/format';

const IMOVEL_INI = {
  codigo: '', tipo: 'apartamento', endereco: '', valor_sem_desconto: '', valor_com_desconto: '',
  dia_vencimento: '', status: 'vago', numero_iptu: '', matricula: '', conta_agua: '',
  conta_energia: '', observacoes: ''
};
const INQUILINO_INI = { nome: '', cpf_cnpj: '', telefone: '', email: '', endereco: '', observacoes: '' };
const CONTRATO_INI = {
  data_inicio: '', data_fim: '', valor: '', garantia: 'fiador', renovacao_automatica: false, observacoes: ''
};

const ETAPAS = ['Imóvel', 'Inquilino', 'Contrato', 'Revisão'];

// Wizard de cadastro completo: Imóvel → Inquilino → Contrato → Revisão.
// Usa os endpoints já existentes (imóveis, inquilinos, contratos), vinculando-os.
export default function CadastroCompleto({ isOpen, onClose, onDone, toast, codigoSugerido }) {
  const [step, setStep] = useState(1);
  const [vincular, setVincular] = useState(true); // cadastrar inquilino+contrato junto?
  const [imovel, setImovel] = useState(IMOVEL_INI);
  const [inquilino, setInquilino] = useState(INQUILINO_INI);
  const [contrato, setContrato] = useState(CONTRATO_INI);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState(''); // banner de erro fixo no modal

  useEffect(() => {
    if (isOpen) {
      setStep(1); setVincular(true); setErroSalvar('');
      // Já sugere o próximo código (IM###), mas continua editável
      setImovel({ ...IMOVEL_INI, codigo: codigoSugerido || '' });
      setInquilino(INQUILINO_INI); setContrato(CONTRATO_INI);
    }
  }, [isOpen, codigoSugerido]);

  const setI = (c, v) => setImovel((p) => ({ ...p, [c]: v }));
  const setQ = (c, v) => setInquilino((p) => ({ ...p, [c]: v }));
  const setC = (c, v) => setContrato((p) => ({ ...p, [c]: v }));

  // Etapas: pula Contrato (3) quando não for vincular
  const proximoStep = (s) => (s === 2 && !vincular ? 4 : s + 1);
  const anteriorStep = (s) => (s === 4 && !vincular ? 2 : s - 1);

  const validarStep = () => {
    if (step === 1) {
      if (!imovel.codigo.trim()) return 'Informe o código do imóvel';
      if ((imovel.endereco || '').trim().length < 5) return 'Endereço muito curto';
      if (!imovel.valor_sem_desconto) return 'Informe o valor do aluguel';
      if (!imovel.dia_vencimento) return 'Informe o dia de vencimento';
    }
    if (step === 2 && vincular) {
      if (!inquilino.nome.trim()) return 'Informe o nome do inquilino';
      if ((inquilino.cpf_cnpj || '').replace(/\D/g, '').length < 11) return 'CPF/CNPJ inválido';
      if (!inquilino.telefone.trim()) return 'Informe o telefone';
    }
    if (step === 3 && vincular) {
      if (!contrato.data_inicio || !contrato.data_fim) return 'Informe início e fim do contrato';
      if (contrato.data_fim <= contrato.data_inicio) return 'A data de fim deve ser posterior ao início';
      if (!contrato.valor) return 'Informe o valor mensal';
    }
    return null;
  };

  const avancar = () => {
    setErroSalvar('');
    const erro = validarStep();
    if (erro) { toast.error(erro); return; }
    // ao entrar no contrato, pré-preenche o valor com o do imóvel
    if (step === 2 && vincular && !contrato.valor) {
      setC('valor', imovel.valor_com_desconto || imovel.valor_sem_desconto || '');
    }
    setStep(proximoStep(step));
  };

  const salvar = async () => {
    setErroSalvar('');
    setSalvando(true);
    try {
      // Uma única chamada ATÔMICA no backend: imóvel + inquilino + contrato são
      // gravados na mesma transação. Se qualquer etapa falhar, NADA é gravado
      // (sem imóvel órfão). Antes eram 3 chamadas sequenciais.
      const payload = { imovel, vincular };
      if (vincular) {
        payload.inquilino = inquilino;
        payload.contrato = { ...contrato, status: 'ativo' };
      }
      const res = await imoveisService.cadastroCompleto(payload);
      if (vincular) {
        toast.success(res.data?.inquilino_reaproveitado
          ? 'Imóvel e contrato cadastrados! Já existia um inquilino com este CPF/CNPJ — ele foi reaproveitado.'
          : 'Imóvel, inquilino e contrato cadastrados!');
      } else {
        toast.success('Imóvel cadastrado!');
      }
      onDone();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || 'Erro ao salvar. Verifique os dados e tente novamente.';
      setErroSalvar(msg);   // banner fixo no modal (não depende do toast)
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  };

  const footer = (
    <>
      {step > 1 && <button className="btn btn-ghost" onClick={() => setStep(anteriorStep(step))} disabled={salvando}>Voltar</button>}
      {step < 4
        ? <button className="btn btn-primary" onClick={avancar}>Próximo</button>
        : <button className="btn btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : (vincular ? 'Salvar imóvel, inquilino e contrato' : 'Salvar imóvel')}
          </button>}
    </>
  );

  const Row = ({ label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, borderBottom: '1px solid var(--gray-100)' }}>
      <span style={{ color: 'var(--gray-500)' }}>{label}</span>
      <strong style={{ textAlign: 'right' }}>{value || '—'}</strong>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cadastro completo" size="lg" footer={footer}>
      {/* Banner de erro fixo — mostra o motivo da falha sem depender do toast */}
      {erroSalvar && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px',
          background: 'var(--danger-light, #fde8e8)', border: '1px solid var(--danger)',
          borderRadius: 'var(--radius)', color: 'var(--danger-dark, #9b1c1c)', fontSize: 13, fontWeight: 500
        }}>
          <span style={{ fontSize: 16 }}>✕</span>
          <span>{erroSalvar} <span style={{ fontWeight: 400 }}>— nenhum dado foi gravado.</span></span>
        </div>
      )}

      {/* Stepper */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        {ETAPAS.map((nome, i) => {
          const n = i + 1;
          const ativo = n === step;
          const feito = n < step;
          const pulado = n === 3 && !vincular;
          return (
            <div key={nome} style={{ flex: 1, textAlign: 'center', opacity: pulado ? 0.4 : 1 }}>
              <div style={{
                height: 4, borderRadius: 2, marginBottom: 6,
                background: feito || ativo ? 'var(--primary)' : 'var(--gray-200)'
              }} />
              <span style={{ fontSize: 12, fontWeight: ativo ? 700 : 500, color: ativo ? 'var(--primary)' : 'var(--gray-500)' }}>
                {n}. {nome}
              </span>
            </div>
          );
        })}
      </div>

      {/* Etapa 1 — Imóvel */}
      {step === 1 && (
        <div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Código <span className="required">*</span></label>
              <input className="form-control" value={imovel.codigo} onChange={(e) => setI('codigo', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo <span className="required">*</span></label>
              <select className="form-control" value={imovel.tipo} onChange={(e) => setI('tipo', e.target.value)}>
                <option value="apartamento">Apartamento</option>
                <option value="casa">Casa</option>
                <option value="comercial">Comercial</option>
                <option value="terreno">Terreno</option>
                <option value="galpao">Galpão</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Endereço completo <span className="required">*</span></label>
            <input className="form-control" value={imovel.endereco} onChange={(e) => setI('endereco', e.target.value)} />
          </div>
          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Valor do aluguel <span className="required">*</span></label>
              <MoneyInput value={imovel.valor_sem_desconto} onChange={(v) => setI('valor_sem_desconto', v)} />
            </div>
            <div className="form-group">
              <label className="form-label">Valor com desconto</label>
              <MoneyInput value={imovel.valor_com_desconto} onChange={(v) => setI('valor_com_desconto', v)} />
            </div>
            <div className="form-group">
              <label className="form-label">Dia de vencimento <span className="required">*</span></label>
              <input className="form-control" type="number" min={1} max={31} value={imovel.dia_vencimento} onChange={(e) => setI('dia_vencimento', e.target.value)} />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">IPTU</label>
              <input className="form-control" value={imovel.numero_iptu} onChange={(e) => setI('numero_iptu', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Matrícula</label>
              <input className="form-control" value={imovel.matricula} onChange={(e) => setI('matricula', e.target.value)} />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Conta de água</label>
              <input className="form-control" value={imovel.conta_agua} onChange={(e) => setI('conta_agua', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Conta de energia</label>
              <input className="form-control" value={imovel.conta_energia} onChange={(e) => setI('conta_energia', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Observações</label>
            <textarea className="form-control" rows={2} value={imovel.observacoes} onChange={(e) => setI('observacoes', e.target.value)} />
          </div>
        </div>
      )}

      {/* Etapa 2 — Inquilino */}
      {step === 2 && (
        <div>
          <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, padding: 10, background: 'var(--gray-50)', borderRadius: 'var(--radius)' }}>
            <input type="checkbox" checked={vincular} onChange={(e) => setVincular(e.target.checked)} />
            Cadastrar inquilino e contrato agora (desmarque para cadastrar só o imóvel vago)
          </label>
          {vincular ? (
            <>
              <div className="form-group">
                <label className="form-label">Nome completo <span className="required">*</span></label>
                <input className="form-control" value={inquilino.nome} onChange={(e) => setQ('nome', e.target.value)} />
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">CPF / CNPJ <span className="required">*</span></label>
                  <CpfCnpjInput value={inquilino.cpf_cnpj} onChange={(v) => setQ('cpf_cnpj', v)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Telefone <span className="required">*</span></label>
                  <PhoneInput value={inquilino.telefone} onChange={(v) => setQ('telefone', v)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">E-mail</label>
                <input className="form-control" type="email" value={inquilino.email} onChange={(e) => setQ('email', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Endereço</label>
                <input className="form-control" value={inquilino.endereco} onChange={(e) => setQ('endereco', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Observações</label>
                <textarea className="form-control" rows={2} value={inquilino.observacoes} onChange={(e) => setQ('observacoes', e.target.value)} />
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--gray-500)' }}>O imóvel será cadastrado como <strong>vago</strong>, sem inquilino nem contrato. Você pode vincular depois.</p>
          )}
        </div>
      )}

      {/* Etapa 3 — Contrato */}
      {step === 3 && vincular && (
        <div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Data de início <span className="required">*</span></label>
              <input className="form-control" type="date" value={contrato.data_inicio} onChange={(e) => setC('data_inicio', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Data de término <span className="required">*</span></label>
              <input className="form-control" type="date" value={contrato.data_fim} onChange={(e) => setC('data_fim', e.target.value)} />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Valor mensal <span className="required">*</span></label>
              <MoneyInput value={contrato.valor} onChange={(v) => setC('valor', v)} />
            </div>
            <div className="form-group">
              <label className="form-label">Garantia <span className="required">*</span></label>
              <select className="form-control" value={contrato.garantia} onChange={(e) => setC('garantia', e.target.value)}>
                <option value="fiador">Fiador</option>
                <option value="caucao">Caução</option>
                <option value="seguro">Seguro Fiança</option>
                <option value="sem">Sem Garantia</option>
                <option value="outro">Outro</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={contrato.renovacao_automatica} onChange={(e) => setC('renovacao_automatica', e.target.checked)} />
              Renovação automática anual
            </label>
          </div>
          <div className="form-group">
            <label className="form-label">Observações do contrato</label>
            <textarea className="form-control" rows={2} value={contrato.observacoes} onChange={(e) => setC('observacoes', e.target.value)} />
          </div>
        </div>
      )}

      {/* Etapa 4 — Revisão */}
      {step === 4 && (
        <div>
          <h4 style={{ margin: '0 0 6px' }}>Imóvel</h4>
          <Row label="Código / Tipo" value={`${imovel.codigo} · ${imovel.tipo}`} />
          <Row label="Endereço" value={imovel.endereco} />
          <Row label="Aluguel" value={formatMoeda(imovel.valor_com_desconto || imovel.valor_sem_desconto)} />
          <Row label="Dia de vencimento" value={imovel.dia_vencimento} />

          {vincular ? (
            <>
              <h4 style={{ margin: '14px 0 6px' }}>Inquilino</h4>
              <Row label="Nome" value={inquilino.nome} />
              <Row label="CPF/CNPJ" value={inquilino.cpf_cnpj} />
              <Row label="Telefone" value={inquilino.telefone} />

              <h4 style={{ margin: '14px 0 6px' }}>Contrato</h4>
              <Row label="Período" value={`${formatData(contrato.data_inicio)} a ${formatData(contrato.data_fim)}`} />
              <Row label="Valor mensal" value={formatMoeda(contrato.valor)} />
              <Row label="Renovação automática" value={contrato.renovacao_automatica ? 'Sim' : 'Não'} />
              <Row label="Status inicial" value="Imóvel alugado · Contrato ativo" />
            </>
          ) : (
            <p style={{ color: 'var(--gray-500)', marginTop: 12 }}>Será cadastrado apenas o imóvel, como <strong>vago</strong>.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
