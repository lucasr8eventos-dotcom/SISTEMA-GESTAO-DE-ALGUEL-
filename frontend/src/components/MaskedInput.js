import React from 'react';
import { maskCpfCnpj, maskPhone, parseMoney, displayMoney } from '../utils/masks';

export function CpfCnpjInput({ value, onChange, className = 'form-control', ...props }) {
  const handleChange = (e) => onChange(maskCpfCnpj(e.target.value));
  return (
    <input
      {...props}
      className={className}
      value={value}
      onChange={handleChange}
      placeholder="000.000.000-00"
      inputMode="numeric"
      maxLength={18}
    />
  );
}

export function PhoneInput({ value, onChange, className = 'form-control', ...props }) {
  const handleChange = (e) => onChange(maskPhone(e.target.value));
  return (
    <input
      {...props}
      className={className}
      value={value}
      onChange={handleChange}
      placeholder="(00) 00000-0000"
      inputMode="numeric"
      maxLength={15}
    />
  );
}

export function MoneyInput({ value, onChange, className = 'form-control', ...props }) {
  const handleChange = (e) => onChange(parseMoney(e.target.value));
  return (
    <input
      {...props}
      className={className}
      value={displayMoney(value)}
      onChange={handleChange}
      placeholder="0,00"
      inputMode="numeric"
    />
  );
}
