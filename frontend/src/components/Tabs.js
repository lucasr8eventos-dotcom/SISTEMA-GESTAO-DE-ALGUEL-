import React from 'react';

export default function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs-nav">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tabs-tab${active === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
          disabled={t.disabled}
        >
          {t.icon && <span className="tabs-tab-icon">{t.icon}</span>}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
