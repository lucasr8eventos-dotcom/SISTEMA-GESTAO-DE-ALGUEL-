-- ============================================================
-- RESET + DADOS DE DEMONSTRAÇÃO
-- ------------------------------------------------------------
-- Apaga TODOS os dados de negócio (imóveis, inquilinos, contratos, pagamentos,
-- despesas, reajustes, recibos, agenda) e insere um conjunto enxuto e realista
-- para demonstração. MANTÉM os usuários (login) e as categorias de contas.
--
-- Como usar no Railway: abra o serviço Postgres -> aba "Query" -> cole TODO
-- este arquivo -> Run. As datas são relativas a HOJE, então a demo sempre
-- aparece "atual" (mês corrente, atrasados, etc.).
--
-- ⚠️ Destrutivo: apaga os dados de teste que você cadastrou. É o que queremos.
-- ============================================================
BEGIN;

-- 1) LIMPEZA dos dados de teste (mantém usuarios e despesa_tipos)
TRUNCATE recibos, reajustes, pagamentos, despesas, agenda_eventos,
         contratos, inquilinos, imoveis, recibo_recebedores, recibo_pagadores
  RESTART IDENTITY CASCADE;

-- 2) IMÓVEIS (situações variadas + cadastro COMPLETO para a demonstração)
INSERT INTO imoveis (codigo, tipo, endereco, valor_sem_desconto, valor_com_desconto, dia_vencimento, status, numero_iptu, matricula, conta_agua, conta_energia, observacoes) VALUES
('IM001', 'apartamento', 'Av. Paulista, 1000 - Apto 72, Bela Vista',      2800.00, 2700.00, 10, 'alugado',    'IPTU-1001', 'MAT-45.123', 'SABESP 0011223344', 'ENEL 99001122', 'Apartamento mobiliado, 2 vagas de garagem e varanda.'),
('IM002', 'casa',        'Rua das Acácias, 245, Jardim Europa',           4200.00, NULL,    5,  'alugado',    'IPTU-1002', 'MAT-78.456', 'SABESP 0022334455', 'ENEL 99002233', 'Casa térrea com quintal e churrasqueira.'),
('IM003', 'apartamento', 'Rua Augusta, 1500 - Apto 31, Consolação',       2300.00, 2200.00, 15, 'alugado',    'IPTU-1003', 'MAT-12.789', 'SABESP 0033445566', 'ENEL 99003344', 'Próximo ao metrô, 1 dormitório.'),
('IM004', 'comercial',   'Av. Brigadeiro Faria Lima, 800 - Sala 12',      6500.00, NULL,    10, 'vago',       'IPTU-1004', 'MAT-33.901', 'SABESP 0044556677', 'ENEL 99004455', 'Sala comercial, ar-condicionado central.'),
('IM005', 'apartamento', 'Rua Oscar Freire, 200 - Apto 5, Jardins',       3100.00, 3000.00, 20, 'manutencao', 'IPTU-1005', 'MAT-66.234', 'SABESP 0055667788', 'ENEL 99005566', 'Em reforma (pintura e hidráulica) até o próximo mês.'),
('IM006', 'casa',        'Rua dos Pinheiros, 90, Pinheiros',              3800.00, NULL,    8,  'negociacao', 'IPTU-1006', 'MAT-90.567', 'SABESP 0066778899', 'ENEL 99006677', 'Em negociação com possível inquilino.');

-- 3) INQUILINOS
INSERT INTO inquilinos (nome, cpf_cnpj, telefone, email) VALUES
('Ana Carolina Souza',  '312.456.789-01', '(11) 98877-1122', 'ana.souza@email.com'),
('Bruno Oliveira Lima', '405.987.321-09', '(11) 99654-3321', 'bruno.lima@email.com'),
('Carla Mendes Rocha',  '528.741.963-00', '(11) 97412-8855', 'carla.rocha@email.com');

-- 4) CONTRATOS ATIVOS (IM001/Ana, IM002/Bruno, IM003/Carla)
INSERT INTO contratos (imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status, renovacao_automatica) VALUES
(1, 1, (CURRENT_DATE - INTERVAL '8 months')::date,  (CURRENT_DATE + INTERVAL '4 months')::date,  2700.00, 'fiador', 'ativo', true),
(2, 2, (CURRENT_DATE - INTERVAL '14 months')::date, (CURRENT_DATE + INTERVAL '10 months')::date, 4200.00, 'caucao', 'ativo', true),
(3, 3, (CURRENT_DATE - INTERVAL '5 months')::date,  (CURRENT_DATE + INTERVAL '7 months')::date,  2200.00, 'seguro', 'ativo', true);

-- 5) PAGAMENTOS (datas relativas a hoje; venc = dia do imóvel)
DO $$
DECLARE
  d0 date := date_trunc('month', CURRENT_DATE)::date;                       -- 1º dia do mês atual
  d1 date := date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date;  -- mês passado
  d2 date := date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date; -- 2 meses atrás
  -- Vencimento das parcelas do MÊS ATUAL: nunca no passado (a vencer na demo)
  venc_atual date := GREATEST(d0 + 9, (CURRENT_DATE + INTERVAL '3 days')::date);
BEGIN
  -- IM001 (contrato 1): mês passado PAGO + mês atual PENDENTE (a vencer)
  INSERT INTO pagamentos (mes,ano,imovel_id,contrato_id,valor_aluguel,data_vencimento,data_pagamento,valor_recebido,forma_pagamento,status) VALUES
  (EXTRACT(MONTH FROM d1)::int, EXTRACT(YEAR FROM d1)::int, 1,1,2700.00, d1+9, d1+8, 2700.00,'pix','pago'),
  (EXTRACT(MONTH FROM d0)::int, EXTRACT(YEAR FROM d0)::int, 1,1,2700.00, venc_atual, NULL, NULL, NULL, 'pendente');

  -- IM002 (contrato 2): INADIMPLÊNCIA — 2 meses atrás e mês passado ATRASADOS + mês atual a vencer
  INSERT INTO pagamentos (mes,ano,imovel_id,contrato_id,valor_aluguel,data_vencimento,status) VALUES
  (EXTRACT(MONTH FROM d2)::int, EXTRACT(YEAR FROM d2)::int, 2,2,4200.00, d2+4,'atrasado'),
  (EXTRACT(MONTH FROM d1)::int, EXTRACT(YEAR FROM d1)::int, 2,2,4200.00, d1+4,'atrasado'),
  (EXTRACT(MONTH FROM d0)::int, EXTRACT(YEAR FROM d0)::int, 2,2,4200.00, venc_atual,'pendente');

  -- IM003 (contrato 3): mês passado PAGO + mês atual PARCIAL (recebeu metade)
  INSERT INTO pagamentos (mes,ano,imovel_id,contrato_id,valor_aluguel,data_vencimento,data_pagamento,valor_recebido,forma_pagamento,status) VALUES
  (EXTRACT(MONTH FROM d1)::int, EXTRACT(YEAR FROM d1)::int, 3,3,2200.00, d1+14, d1+13, 2200.00,'transferencia','pago'),
  (EXTRACT(MONTH FROM d0)::int, EXTRACT(YEAR FROM d0)::int, 3,3,2200.00, venc_atual, (CURRENT_DATE)::date, 1100.00,'pix','parcial');
END $$;

-- 6) CONTAS A PAGAR (despesas): uma paga, uma a vencer no mês, uma atrasada
DO $$
DECLARE
  d0 date := date_trunc('month', CURRENT_DATE)::date;
  d1 date := date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date;
  venc_atual date := GREATEST(d0 + 9, (CURRENT_DATE + INTERVAL '4 days')::date);
BEGIN
  INSERT INTO despesas (imovel_id, tipo, valor, vencimento, status, descricao, data_pagamento, valor_pago, forma_pagamento) VALUES
  (1, 'iptu',       320.00, d1+19, 'pago',     'IPTU 2026 - parcela', d1+18, 320.00, 'boleto'),
  (1, 'condominio', 650.00, venc_atual,  'pendente', 'Condomínio do mês', NULL, NULL, NULL),
  (2, 'manutencao', 480.00, d1+9,  'atrasado', 'Reparo no telhado', NULL, NULL, NULL),
  (NULL,'outros',   150.00, venc_atual, 'pendente', 'Taxa administrativa', NULL, NULL, NULL);
END $$;

-- 7) REAJUSTE programado (pendente) para o contrato 1
INSERT INTO reajustes (imovel_id, contrato_id, valor_atual, data_ultimo, data_proximo, percentual, novo_valor, status)
VALUES (1, 1, 2700.00, (CURRENT_DATE - INTERVAL '8 months')::date, (CURRENT_DATE + INTERVAL '20 days')::date, 8.00, 2916.00, 'pendente');

-- 8) RECEBEDOR padrão para emissão de recibos
INSERT INTO recibo_recebedores (nome, documento, padrao)
VALUES ('Imobiliária Demonstração LTDA', '12.345.678/0001-90', true);

COMMIT;
