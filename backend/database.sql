-- Sistema de Gestão de Aluguéis de Imóveis
-- Script completo de criação do banco de dados PostgreSQL
--
-- Uso manual (fora do Docker):
--   psql -U postgres -c "CREATE DATABASE gestao_alugueis;"
--   psql -U postgres -d gestao_alugueis -f database.sql
--
-- No Docker: este arquivo é montado em /docker-entrypoint-initdb.d/
-- e executado automaticamente no DB criado via POSTGRES_DB.

-- ============================================================
-- TABELAS
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    senha VARCHAR(255) NOT NULL,
    perfil VARCHAR(50) NOT NULL CHECK (perfil IN ('admin', 'operador')),
    status VARCHAR(50) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inquilinos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    cpf_cnpj VARCHAR(20) UNIQUE NOT NULL,
    telefone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    endereco TEXT,
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS imoveis (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(100) UNIQUE NOT NULL,
    tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('casa', 'apartamento', 'comercial', 'terreno', 'galpao')),
    endereco TEXT NOT NULL,
    valor_com_desconto DECIMAL(10,2),
    valor_sem_desconto DECIMAL(10,2) NOT NULL,
    dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
    status VARCHAR(50) NOT NULL DEFAULT 'vago' CHECK (status IN ('alugado', 'vago', 'encerrado', 'negociacao')),
    numero_iptu VARCHAR(100),
    matricula VARCHAR(100),
    conta_agua VARCHAR(100),
    conta_energia VARCHAR(100),
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contratos (
    id SERIAL PRIMARY KEY,
    imovel_id INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE RESTRICT,
    inquilino_id INTEGER NOT NULL REFERENCES inquilinos(id) ON DELETE RESTRICT,
    data_inicio DATE NOT NULL,
    data_fim DATE NOT NULL,
    valor DECIMAL(10,2) NOT NULL,
    garantia VARCHAR(50) NOT NULL CHECK (garantia IN ('caucao', 'fiador', 'seguro', 'sem', 'outro')),
    status VARCHAR(50) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'vencido', 'encerrado')),
    arquivo_pdf VARCHAR(500),
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pagamentos (
    id SERIAL PRIMARY KEY,
    mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    ano INTEGER NOT NULL,
    imovel_id INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE RESTRICT,
    contrato_id INTEGER REFERENCES contratos(id) ON DELETE SET NULL,
    valor_aluguel DECIMAL(10,2) NOT NULL,
    data_vencimento DATE NOT NULL,
    data_pagamento DATE,
    valor_recebido DECIMAL(10,2),
    forma_pagamento VARCHAR(50) CHECK (forma_pagamento IN ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao')),
    status VARCHAR(50) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pago', 'pendente', 'atrasado', 'parcial')),
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS despesas (
    id SERIAL PRIMARY KEY,
    imovel_id INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE RESTRICT,
    tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('iptu', 'condominio', 'agua', 'energia', 'manutencao', 'seguro', 'outros')),
    valor DECIMAL(10,2) NOT NULL,
    vencimento DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pago', 'pendente', 'atrasado')),
    descricao VARCHAR(255),
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reajustes (
    id SERIAL PRIMARY KEY,
    imovel_id INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE RESTRICT,
    contrato_id INTEGER REFERENCES contratos(id) ON DELETE SET NULL,
    valor_atual DECIMAL(10,2) NOT NULL,
    data_ultimo DATE,
    data_proximo DATE NOT NULL,
    percentual DECIMAL(5,2) NOT NULL,
    novo_valor DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'avisado', 'aplicado')),
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documentos (
    id SERIAL PRIMARY KEY,
    entidade VARCHAR(50) NOT NULL CHECK (entidade IN ('contrato', 'imovel', 'inquilino', 'despesa')),
    entidade_id INTEGER NOT NULL,
    nome_arquivo VARCHAR(255) NOT NULL,
    nome_original VARCHAR(255) NOT NULL,
    tipo_mime VARCHAR(100),
    tamanho INTEGER,
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS log_atividades (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    acao VARCHAR(100) NOT NULL,
    entidade VARCHAR(50),
    entidade_id INTEGER,
    detalhes TEXT,
    ip VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_imoveis_status ON imoveis(status);
CREATE INDEX IF NOT EXISTS idx_imoveis_codigo ON imoveis(codigo);
CREATE INDEX IF NOT EXISTS idx_inquilinos_cpf_cnpj ON inquilinos(cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_contratos_status ON contratos(status);
CREATE INDEX IF NOT EXISTS idx_contratos_data_fim ON contratos(data_fim);
CREATE INDEX IF NOT EXISTS idx_contratos_imovel ON contratos(imovel_id);
CREATE INDEX IF NOT EXISTS idx_contratos_inquilino ON contratos(inquilino_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_mes_ano ON pagamentos(mes, ano);
CREATE INDEX IF NOT EXISTS idx_pagamentos_status ON pagamentos(status);
CREATE INDEX IF NOT EXISTS idx_pagamentos_imovel ON pagamentos(imovel_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_contrato ON pagamentos(contrato_id);
CREATE INDEX IF NOT EXISTS idx_despesas_vencimento ON despesas(vencimento);
CREATE INDEX IF NOT EXISTS idx_despesas_status ON despesas(status);
CREATE INDEX IF NOT EXISTS idx_despesas_imovel ON despesas(imovel_id);
CREATE INDEX IF NOT EXISTS idx_reajustes_data_proximo ON reajustes(data_proximo);
CREATE INDEX IF NOT EXISTS idx_reajustes_status ON reajustes(status);
CREATE INDEX IF NOT EXISTS idx_documentos_entidade ON documentos(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_log_usuario ON log_atividades(usuario_id);
CREATE INDEX IF NOT EXISTS idx_log_created ON log_atividades(created_at);
-- Garante que não haja dois pagamentos para o mesmo imóvel no mesmo mês/ano
CREATE UNIQUE INDEX IF NOT EXISTS ux_pagamentos_mes_ano_imovel ON pagamentos(mes, ano, imovel_id);

-- ============================================================
-- TRIGGERS updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON usuarios;
CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_imoveis_updated_at ON imoveis;
CREATE TRIGGER trg_imoveis_updated_at BEFORE UPDATE ON imoveis FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_inquilinos_updated_at ON inquilinos;
CREATE TRIGGER trg_inquilinos_updated_at BEFORE UPDATE ON inquilinos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_contratos_updated_at ON contratos;
CREATE TRIGGER trg_contratos_updated_at BEFORE UPDATE ON contratos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_pagamentos_updated_at ON pagamentos;
CREATE TRIGGER trg_pagamentos_updated_at BEFORE UPDATE ON pagamentos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_despesas_updated_at ON despesas;
CREATE TRIGGER trg_despesas_updated_at BEFORE UPDATE ON despesas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_reajustes_updated_at ON reajustes;
CREATE TRIGGER trg_reajustes_updated_at BEFORE UPDATE ON reajustes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- VIEWS
-- ============================================================

CREATE OR REPLACE VIEW vw_pagamentos_completos AS
SELECT
    p.*,
    i.codigo AS imovel_codigo,
    i.endereco AS imovel_endereco,
    i.tipo AS imovel_tipo,
    inq.nome AS inquilino_nome,
    inq.cpf_cnpj AS inquilino_documento,
    inq.telefone AS inquilino_telefone
FROM pagamentos p
LEFT JOIN imoveis i ON p.imovel_id = i.id
LEFT JOIN contratos c ON c.id = p.contrato_id
LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id;

CREATE OR REPLACE VIEW vw_contratos_ativos AS
SELECT
    c.*,
    i.codigo AS imovel_codigo,
    i.endereco AS imovel_endereco,
    i.tipo AS imovel_tipo,
    i.valor_sem_desconto AS imovel_valor,
    inq.nome AS inquilino_nome,
    inq.cpf_cnpj AS inquilino_documento,
    inq.telefone AS inquilino_telefone,
    inq.email AS inquilino_email,
    (c.data_fim - CURRENT_DATE) AS dias_para_vencer
FROM contratos c
JOIN imoveis i ON c.imovel_id = i.id
JOIN inquilinos inq ON c.inquilino_id = inq.id
WHERE c.status = 'ativo';

CREATE OR REPLACE VIEW vw_inadimplencia AS
SELECT
    p.id,
    p.mes,
    p.ano,
    p.valor_aluguel,
    p.data_vencimento,
    p.status,
    (CURRENT_DATE - p.data_vencimento) AS dias_atraso,
    i.codigo AS imovel_codigo,
    i.endereco AS imovel_endereco,
    inq.nome AS inquilino_nome,
    inq.telefone AS inquilino_telefone
FROM pagamentos p
JOIN imoveis i ON p.imovel_id = i.id
LEFT JOIN contratos c ON c.id = p.contrato_id
LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
WHERE p.status IN ('atrasado', 'pendente')
  AND p.data_vencimento < CURRENT_DATE
ORDER BY dias_atraso DESC;

-- ============================================================
-- DADOS INICIAIS
-- ============================================================

-- Senha: admin123 (bcryptjs hash, rounds=10) — TROQUE EM PRODUÇÃO
INSERT INTO usuarios (nome, email, senha, perfil, status) VALUES
('Administrador', 'admin@sistema.com', '$2a$10$Mr3zId.1uxChJYHuP7zXk.rnsHpbZWl7p0WMuSSvwmZIuy6mhrGf2', 'admin', 'ativo'),
('Operador', 'operador@sistema.com', '$2a$10$Mr3zId.1uxChJYHuP7zXk.rnsHpbZWl7p0WMuSSvwmZIuy6mhrGf2', 'operador', 'ativo')
ON CONFLICT (email) DO NOTHING;

-- Imóveis de exemplo
INSERT INTO imoveis (codigo, tipo, endereco, valor_sem_desconto, valor_com_desconto, dia_vencimento, status, numero_iptu) VALUES
('IM001', 'apartamento', 'Rua das Flores, 123 - Apto 501, Centro', 2500.00, 2400.00, 10, 'alugado', 'IPTU-001'),
('IM002', 'casa', 'Av. Principal, 456, Bairro Jardim', 3500.00, 3300.00, 5, 'alugado', 'IPTU-002'),
('IM003', 'comercial', 'Rua do Comércio, 789, Centro', 4000.00, NULL, 15, 'vago', 'IPTU-003'),
('IM004', 'apartamento', 'Rua Central, 321 - Apto 201, Setor Norte', 2000.00, 1900.00, 10, 'alugado', 'IPTU-004')
ON CONFLICT (codigo) DO NOTHING;

-- Inquilinos de exemplo
INSERT INTO inquilinos (nome, cpf_cnpj, telefone, email) VALUES
('João Silva', '123.456.789-00', '(61) 98765-4321', 'joao@email.com'),
('Maria Santos', '987.654.321-00', '(61) 99876-5432', 'maria@email.com'),
('Pedro Oliveira', '456.789.123-00', '(61) 97654-3210', 'pedro@email.com')
ON CONFLICT (cpf_cnpj) DO NOTHING;

-- Contratos / Pagamentos / Despesas / Reajustes:
-- Insere os exemplos apenas se a tabela estiver vazia (evita duplicação na re-execução).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contratos LIMIT 1) THEN
    INSERT INTO contratos (imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status) VALUES
    (1, 1, '2024-01-01', '2026-06-01', 2500.00, 'fiador', 'ativo'),
    (2, 2, '2024-03-01', '2026-07-01', 3500.00, 'seguro', 'ativo'),
    (4, 3, '2024-06-01', '2026-08-01', 2000.00, 'caucao', 'ativo');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pagamentos LIMIT 1) THEN
    INSERT INTO pagamentos (mes, ano, imovel_id, contrato_id, valor_aluguel, data_vencimento, data_pagamento, valor_recebido, forma_pagamento, status) VALUES
    (1, 2026, 1, 1, 2500.00, '2026-01-10', '2026-01-09', 2500.00, 'pix', 'pago'),
    (2, 2026, 1, 1, 2500.00, '2026-02-10', '2026-02-10', 2500.00, 'pix', 'pago'),
    (3, 2026, 1, 1, 2500.00, '2026-03-10', '2026-03-12', 2500.00, 'transferencia', 'pago'),
    (4, 2026, 1, 1, 2500.00, '2026-04-10', '2026-04-10', 2500.00, 'pix', 'pago'),
    (5, 2026, 1, 1, 2500.00, '2026-05-10', NULL, NULL, NULL, 'pendente'),
    (1, 2026, 2, 2, 3500.00, '2026-01-05', '2026-01-05', 3500.00, 'transferencia', 'pago'),
    (2, 2026, 2, 2, 3500.00, '2026-02-05', '2026-02-06', 3500.00, 'transferencia', 'pago'),
    (3, 2026, 2, 2, 3500.00, '2026-03-05', NULL, NULL, NULL, 'atrasado'),
    (4, 2026, 2, 2, 3500.00, '2026-04-05', NULL, NULL, NULL, 'atrasado'),
    (5, 2026, 2, 2, 3500.00, '2026-05-05', NULL, NULL, NULL, 'pendente'),
    (4, 2026, 4, 3, 2000.00, '2026-04-10', '2026-04-11', 2000.00, 'dinheiro', 'pago'),
    (5, 2026, 4, 3, 2000.00, '2026-05-10', NULL, NULL, NULL, 'pendente');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM despesas LIMIT 1) THEN
    INSERT INTO despesas (imovel_id, tipo, valor, vencimento, status, descricao) VALUES
    (1, 'iptu', 450.00, '2026-03-15', 'pago', 'IPTU 2026 parcela 1'),
    (1, 'condominio', 350.00, '2026-05-10', 'pendente', 'Condomínio Maio/2026'),
    (2, 'iptu', 680.00, '2026-03-15', 'pago', 'IPTU 2026'),
    (2, 'manutencao', 1200.00, '2026-04-20', 'pago', 'Troca de encanamento'),
    (3, 'iptu', 520.00, '2026-05-15', 'pendente', 'IPTU 2026 parcela 2'),
    (4, 'condominio', 280.00, '2026-05-10', 'pendente', 'Condomínio Maio/2026');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM reajustes LIMIT 1) THEN
    INSERT INTO reajustes (imovel_id, contrato_id, valor_atual, data_ultimo, data_proximo, percentual, novo_valor, status) VALUES
    (1, 1, 2500.00, '2025-01-01', '2026-06-01', 10.00, 2750.00, 'avisado'),
    (2, 2, 3500.00, '2025-03-01', '2026-07-01', 8.50, 3797.50, 'pendente'),
    (4, 3, 2000.00, '2025-06-01', '2026-08-01', 9.00, 2180.00, 'pendente');
  END IF;
END $$;
