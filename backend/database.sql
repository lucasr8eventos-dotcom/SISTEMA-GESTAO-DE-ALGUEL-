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
    valor_sem_desconto DECIMAL(10,2),
    dia_vencimento INTEGER CHECK (dia_vencimento BETWEEN 1 AND 31),
    status VARCHAR(50) NOT NULL DEFAULT 'vago' CHECK (status IN ('alugado', 'vago', 'encerrado', 'negociacao', 'manutencao')),
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
    renovacao_automatica BOOLEAN NOT NULL DEFAULT false, -- opt-in: se ligado, renova +1 ano ao vencer; padrão é vencer normalmente
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
    juros DECIMAL(10,2) DEFAULT 0,
    multa DECIMAL(10,2) DEFAULT 0,
    desconto DECIMAL(10,2) DEFAULT 0,
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tipos/categorias de conta a pagar (cadastráveis pelo usuário)
CREATE TABLE IF NOT EXISTS despesa_tipos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(60) UNIQUE NOT NULL,
    nome VARCHAR(120) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Contas a pagar (despesas fixas e variáveis)
CREATE TABLE IF NOT EXISTS despesas (
    id SERIAL PRIMARY KEY,
    imovel_id INTEGER REFERENCES imoveis(id) ON DELETE RESTRICT, -- opcional: conta pode ser "geral"
    tipo VARCHAR(60) NOT NULL, -- código da categoria (livre, ver despesa_tipos)
    valor DECIMAL(12,2) NOT NULL,
    vencimento DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pago', 'pendente', 'atrasado', 'parcial')),
    descricao VARCHAR(255),
    observacoes TEXT,
    -- Baixa / informar pagamento
    data_pagamento DATE,
    valor_pago DECIMAL(12,2),
    forma_pagamento VARCHAR(30),
    juros DECIMAL(12,2) DEFAULT 0,
    multa DECIMAL(12,2) DEFAULT 0,
    desconto DECIMAL(12,2) DEFAULT 0,
    -- Parcelamento / recorrência
    parcela_num INTEGER DEFAULT 1,
    parcela_total INTEGER DEFAULT 1,
    recorrencia_id INTEGER, -- agrupa despesas criadas em série
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

-- Recebedores salvos (quem recebe — empresa/pessoa que emite o recibo)
CREATE TABLE IF NOT EXISTS recibo_recebedores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    documento VARCHAR(20),
    endereco TEXT,
    telefone VARCHAR(20),
    whatsapp VARCHAR(20),
    email VARCHAR(255),
    site VARCHAR(255),
    logo_url VARCHAR(500),
    padrao BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pagadores salvos (quem paga)
CREATE TABLE IF NOT EXISTS recibo_pagadores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    documento VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Recibos gerados (guarda um "snapshot" dos dados na hora da emissão,
-- para que editar/excluir um recebedor não altere recibos já emitidos)
CREATE TABLE IF NOT EXISTS recibos (
    id SERIAL PRIMARY KEY,
    numero INTEGER NOT NULL,
    recebedor_id INTEGER REFERENCES recibo_recebedores(id) ON DELETE SET NULL,
    pagador_id INTEGER REFERENCES recibo_pagadores(id) ON DELETE SET NULL,
    recebedor_nome VARCHAR(255) NOT NULL,
    recebedor_documento VARCHAR(20),
    recebedor_endereco TEXT,
    recebedor_telefone VARCHAR(20),
    recebedor_whatsapp VARCHAR(20),
    recebedor_email VARCHAR(255),
    recebedor_site VARCHAR(255),
    recebedor_logo_url VARCHAR(500),
    pagador_nome VARCHAR(255) NOT NULL,
    pagador_documento VARCHAR(20),
    valor DECIMAL(12,2) NOT NULL,
    valor_extenso TEXT,
    forma_pagamento VARCHAR(30),
    data_pagamento DATE NOT NULL,
    referente TEXT NOT NULL,
    local VARCHAR(255),
    com_canhoto BOOLEAN NOT NULL DEFAULT true,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Eventos manuais da Agenda (vistorias, visitas, reuniões, etc.) — salvos no banco
CREATE TABLE IF NOT EXISTS agenda_eventos (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(255) NOT NULL,
    data DATE NOT NULL,
    hora TIME,
    imovel_id INTEGER REFERENCES imoveis(id) ON DELETE SET NULL,
    tipo VARCHAR(40) NOT NULL DEFAULT 'outro',
    descricao TEXT,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_recibos_numero ON recibos(numero);
CREATE INDEX IF NOT EXISTS idx_agenda_data ON agenda_eventos(data);
CREATE INDEX IF NOT EXISTS idx_recibos_created ON recibos(created_at);
CREATE INDEX IF NOT EXISTS idx_log_usuario ON log_atividades(usuario_id);
CREATE INDEX IF NOT EXISTS idx_log_created ON log_atividades(created_at);
CREATE INDEX IF NOT EXISTS idx_despesas_recorrencia ON despesas(recorrencia_id);
-- Garante que não haja dois pagamentos para o mesmo imóvel no mesmo mês/ano
CREATE UNIQUE INDEX IF NOT EXISTS ux_pagamentos_mes_ano_imovel ON pagamentos(mes, ano, imovel_id);

-- ============================================================
-- MIGRATIONS idempotentes (alterações em bancos já existentes)
-- ============================================================

-- Adiciona 'manutencao' ao CHECK de imoveis.status se ainda não estiver
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'imoveis' AND constraint_name = 'imoveis_status_check'
    ) THEN
        ALTER TABLE imoveis DROP CONSTRAINT imoveis_status_check;
    END IF;
    ALTER TABLE imoveis ADD CONSTRAINT imoveis_status_check
        CHECK (status IN ('alugado', 'vago', 'encerrado', 'negociacao', 'manutencao'));
END $$;

-- Adiciona coluna recorrencia_id em despesas (para agrupar despesas geradas em série)
ALTER TABLE despesas ADD COLUMN IF NOT EXISTS recorrencia_id INTEGER;

-- Adiciona FK de integridade referencial para recorrencia_id (auto-referência com SET NULL ao excluir raiz)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'despesas' AND constraint_name = 'fk_despesas_recorrencia'
  ) THEN
    ALTER TABLE despesas ADD CONSTRAINT fk_despesas_recorrencia
      FOREIGN KEY (recorrencia_id) REFERENCES despesas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Sequência PERENE de numeração de recibos: atômica e nunca regride, mesmo que
-- o recibo de maior número seja excluído depois (não reutiliza número emitido).
DO $$
DECLARE mx INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind='S' AND relname='recibos_numero_seq') THEN
    SELECT COALESCE(MAX(numero), 0) INTO mx FROM recibos;
    EXECUTE format('CREATE SEQUENCE recibos_numero_seq START WITH %s', GREATEST(mx + 1, 1));
  END IF;
END $$;

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
DROP TRIGGER IF EXISTS trg_recibo_recebedores_updated_at ON recibo_recebedores;
CREATE TRIGGER trg_recibo_recebedores_updated_at BEFORE UPDATE ON recibo_recebedores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_recibo_pagadores_updated_at ON recibo_pagadores;
CREATE TRIGGER trg_recibo_pagadores_updated_at BEFORE UPDATE ON recibo_pagadores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_agenda_eventos_updated_at ON agenda_eventos;
CREATE TRIGGER trg_agenda_eventos_updated_at BEFORE UPDATE ON agenda_eventos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- VIEWS
-- ============================================================

DROP VIEW IF EXISTS vw_inadimplencia;
CREATE VIEW vw_inadimplencia AS
SELECT
    p.id,
    p.mes,
    p.ano,
    p.valor_aluguel,
    p.valor_recebido,
    (p.valor_aluguel - COALESCE(p.valor_recebido, 0)) AS falta,
    p.data_vencimento,
    p.status,
    GREATEST(CURRENT_DATE - p.data_vencimento, 0) AS dias_atraso,
    i.codigo AS imovel_codigo,
    i.endereco AS imovel_endereco,
    inq.nome AS inquilino_nome,
    inq.telefone AS inquilino_telefone
FROM pagamentos p
JOIN imoveis i ON p.imovel_id = i.id
LEFT JOIN contratos c ON c.id = p.contrato_id
LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
-- Mesma regra da inadimplência consolidada: saldo em aberto > 0 e
-- (atrasado OU parcial OU pendente já vencido). Inclui "parcial".
WHERE (p.valor_aluguel - COALESCE(p.valor_recebido, 0)) > 0
  AND (p.status = 'atrasado' OR p.status = 'parcial'
       OR (p.status = 'pendente' AND p.data_vencimento < CURRENT_DATE))
ORDER BY dias_atraso DESC;

-- ============================================================
-- DADOS INICIAIS
-- ============================================================

-- Usuário administrador inicial.
-- ⚠️  NENHUMA senha é semeada aqui de propósito (este arquivo é público).
--     O admin é criado no boot pelo servidor (bootstrapAdmin) usando a senha
--     definida em ADMIN_PASSWORD ou, na ausência dela, uma senha ALEATÓRIA
--     exibida UMA vez no log do servidor. Veja backend/server.js.

-- Categorias padrão de contas a pagar
INSERT INTO despesa_tipos (codigo, nome) VALUES
('iptu', 'IPTU'),
('condominio', 'Condomínio'),
('agua', 'Água'),
('energia', 'Energia'),
('manutencao', 'Manutenção'),
('seguro', 'Seguro'),
('outros', 'Outros')
ON CONFLICT (codigo) DO NOTHING;

-- ⚠️  DADOS DE EXEMPLO (imóveis, inquilinos, contratos, pagamentos, despesas,
--     reajustes fictícios) NÃO ficam mais aqui. Em produção o sistema sobe LIMPO,
--     só com o admin e as categorias acima. Para popular um ambiente de
--     demonstração/desenvolvimento com dados fictícios, rode o arquivo
--     `seed-exemplo.sql` (ou suba o backend com a variável SEED_EXAMPLE_DATA=true).
