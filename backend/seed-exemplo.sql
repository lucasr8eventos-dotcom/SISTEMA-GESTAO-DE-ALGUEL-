-- ============================================================
-- DADOS DE EXEMPLO (somente DEMONSTRAÇÃO / DESENVOLVIMENTO)
-- ============================================================
-- NÃO rode isto em produção. O sistema de produção sobe limpo (só admin +
-- categorias, definidos em database.sql). Use este arquivo apenas para popular
-- um ambiente de teste/demo com dados fictícios.
--
-- Como usar:
--   psql "$DATABASE_URL" -f seed-exemplo.sql
--   (ou suba o backend com SEED_EXAMPLE_DATA=true uma única vez)
--
-- Todos os inserts são idempotentes (ON CONFLICT / NOT EXISTS).

-- Imóveis de exemplo
INSERT INTO imoveis (codigo, tipo, endereco, valor_sem_desconto, valor_com_desconto, dia_vencimento, status, numero_iptu) VALUES
('IM001', 'apartamento', 'Rua das Flores, 123 - Apto 501, Centro', 2500.00, 2400.00, 10, 'alugado', 'IPTU-001'),
('IM002', 'casa', 'Av. Principal, 456, Bairro Jardim', 3500.00, 3300.00, 5, 'alugado', 'IPTU-002'),
('IM003', 'comercial', 'Rua do Comércio, 789, Centro', 4000.00, NULL, 15, 'vago', 'IPTU-003'),
('IM004', 'apartamento', 'Rua Central, 321 - Apto 201, Setor Norte', 2000.00, 1900.00, 10, 'alugado', 'IPTU-004')
ON CONFLICT (codigo) DO NOTHING;

-- Inquilinos de exemplo
INSERT INTO inquilinos (nome, cpf_cnpj, telefone, email) VALUES
('João Silva', '123.456.789-09', '(61) 98765-4321', 'joao@email.com'),
('Maria Santos', '987.654.321-00', '(61) 99876-5432', 'maria@email.com'),
('Pedro Oliveira', '456.789.123-64', '(61) 97654-3210', 'pedro@email.com')
ON CONFLICT (cpf_cnpj) DO NOTHING;

-- Contratos / Pagamentos / Despesas / Reajustes (apenas se vazio)
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
