import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MESES } from '../../utils/format';

export default function PeriodPicker({ mes, ano, onChange, allowAll = true, label = 'Período' }) {
  const mesNum = mes ? parseInt(mes) : null;
  const anoNum = ano ? parseInt(ano) : null;

  const navegar = (delta) => {
    if (!mesNum || !anoNum) {
      // se está vazio, parte do mês atual
      const d = new Date();
      onChange({ mes: d.getMonth() + 1, ano: d.getFullYear() });
      return;
    }
    let novoMes = mesNum + delta;
    let novoAno = anoNum;
    if (novoMes > 12) { novoMes = 1; novoAno += 1; }
    if (novoMes < 1) { novoMes = 12; novoAno -= 1; }
    onChange({ mes: novoMes, ano: novoAno });
  };

  const label_periodo = mesNum && anoNum
    ? `${MESES[mesNum - 1]} ${anoNum}`
    : allowAll
      ? 'Todos os períodos'
      : '—';

  return (
    <div className="filter-field">
      <label className="filter-label">{label}</label>
      <div className="period-picker">
        <button type="button" className="period-btn" onClick={() => navegar(-1)} aria-label="Mês anterior">
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className={`period-display${mesNum && anoNum ? ' active' : ''}`}
          onClick={() => {
            if (mesNum && anoNum && allowAll) {
              onChange({ mes: '', ano: '' });
            } else {
              const d = new Date();
              onChange({ mes: d.getMonth() + 1, ano: d.getFullYear() });
            }
          }}
          title={mesNum && anoNum ? 'Limpar período' : 'Selecionar mês atual'}
        >
          {label_periodo}
        </button>
        <button type="button" className="period-btn" onClick={() => navegar(1)} aria-label="Próximo mês">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
