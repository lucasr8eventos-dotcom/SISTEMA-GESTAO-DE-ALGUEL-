const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Confia em 1 proxy à frente (Railway / Render / Nginx) para que req.ip e
// express-rate-limit usem o IP real do cliente em vez do IP do proxy.
app.set('trust proxy', 1);

// ============================================================
// MIDDLEWARES DE SEGURANÇA
// ============================================================

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limit geral
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' }
}));

// Rate limit mais restrito no login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' }
});

// ============================================================
// BANCO DE DADOS
// ============================================================

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : new Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'gestao_alugueis',
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT) || 5432,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar ao banco:', err.stack);
  } else {
    console.log('✅ Conectado ao PostgreSQL');
    release();
  }
});

// Sem este handler, um erro num client OCIOSO (ex.: o Postgres derruba a conexão)
// emite um 'error' não tratado no pool e DERRUBA o processo Node. Aqui apenas
// logamos — o pool recria a conexão sozinho. Evita "colapso" por queda de rede.
pool.on('error', (err) => {
  console.error('⚠️  Erro inesperado em client ocioso do pool:', err.message);
});

// ============================================================
// UPLOAD DE ARQUIVOS
// ============================================================

// Diretório de anexos. Idealmente um VOLUME persistente (ver .env.example),
// senão os PDFs somem a cada redeploy no Railway. Se o caminho configurado não
// puder ser criado (volume não montado), cai num fallback local e avisa, em vez
// de derrubar o boot do servidor.
let uploadDir = process.env.UPLOAD_DIR || 'uploads';
try {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
} catch (e) {
  console.error(`⚠️  Não consegui usar UPLOAD_DIR="${uploadDir}" (${e.message}). Usando "uploads" local — ATENÇÃO: anexos podem não persistir.`);
  uploadDir = 'uploads';
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext) && allowedMimes.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Tipo de arquivo não permitido. Use PDF, JPG ou PNG.'));
  }
});

// ============================================================
// AUTENTICAÇÃO E AUTORIZAÇÃO
// ============================================================

const crypto = require('crypto');
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  console.error('❌ FATAL: JWT_SECRET não definido ou muito curto em produção. Defina JWT_SECRET no ambiente.');
  process.exit(1);
}
const JWT_SECRET = (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32)
  ? process.env.JWT_SECRET
  : (() => {
      const generated = crypto.randomBytes(32).toString('hex');
      console.warn('⚠️  JWT_SECRET não definido. Usando secret temporário — usuários serão deslogados a cada reinício do servidor. Defina JWT_SECRET no .env para desenvolvimento estável.');
      return generated;
    })();

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido ou expirado' });
    req.user = user;
    next();
  });
};

const authorizeAdmin = (req, res, next) => {
  if (!req.user || req.user.perfil !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }
  next();
};

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Dados inválidos', detalhes: errors.array() });
  }
  next();
};

// Rota autenticada para servir arquivos de upload (PDFs de contratos)
app.get('/api/uploads/:filename', authenticateToken, (req, res) => {
  const filename = path.basename(req.params.filename); // evita path traversal
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  }
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(path.resolve(filePath));
});

// ============================================================
// LOG DE ATIVIDADES
// ============================================================

const logAtividade = async (usuarioId, acao, entidade = null, entidadeId = null, detalhes = null, ip = null) => {
  try {
    await pool.query(
      'INSERT INTO log_atividades (usuario_id, acao, entidade, entidade_id, detalhes, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [usuarioId, acao, entidade, entidadeId, detalhes, ip]
    );
  } catch (_) {}
};

// ============================================================
// HELPERS DE NEGÓCIO
// ============================================================

// Verifica se contrato_id pertence ao imovel_id informado.
// Retorna { ok: true } se coerente (ou se contrato_id é nulo).
// Aceita só inteiros em filtros numéricos vindos da query string — evita 500
// por cast inválido no Postgres (ex.: ?mes=abc). Retorna o valor ou undefined.
const intQ = (v) => (/^\d+$/.test(String(v ?? '')) ? v : undefined);

const validarContratoDoImovel = async (contratoId, imovelId) => {
  if (!contratoId) return { ok: true };
  const r = await pool.query('SELECT imovel_id FROM contratos WHERE id=$1', [contratoId]);
  if (r.rows.length === 0) return { ok: false, error: 'Contrato informado não existe' };
  if (String(r.rows[0].imovel_id) !== String(imovelId)) {
    return { ok: false, error: 'O contrato informado não pertence ao imóvel selecionado' };
  }
  return { ok: true };
};

// Propaga um reajuste já decidido: atualiza o valor do CONTRATO, escala os
// valores do IMÓVEL (com/sem desconto) pelo mesmo percentual e atualiza as
// PARCELAS ainda não pagas do mês corrente em diante. NÃO toca em parcelas
// pagas nem em meses anteriores (preserva a lógica de aluguel mês a mês).
// `db` pode ser o pool ou um client de transação. Retorna nº de parcelas mexidas.
async function propagarReajusteContrato(db, { contratoId, imovelId, novoValor, percentual, dataReaj }) {
  await db.query('UPDATE contratos SET valor=$1, updated_at=NOW() WHERE id=$2', [novoValor, contratoId]);
  const pct = parseFloat(percentual);
  if (imovelId && !isNaN(pct) && pct !== 0) {
    await db.query(
      `UPDATE imoveis SET
         valor_sem_desconto = ROUND(valor_sem_desconto * (1 + $1::numeric / 100), 2),
         valor_com_desconto = CASE WHEN valor_com_desconto IS NOT NULL
                                   THEN ROUND(valor_com_desconto * (1 + $1::numeric / 100), 2) ELSE NULL END,
         updated_at = NOW()
       WHERE id = $2`,
      [pct, imovelId]
    );
  }
  const r = await db.query(
    `UPDATE pagamentos SET valor_aluguel = $1, updated_at = NOW()
     WHERE contrato_id = $2 AND status IN ('pendente','atrasado')
       AND data_vencimento >= date_trunc('month', $3::date)
     RETURNING id`,
    [novoValor, contratoId, dataReaj]
  );
  return r.rowCount;
}

// Verifica se já existe contrato ativo com datas sobrepostas no mesmo imóvel.
// Considera sobreposição: novo.data_inicio <= existente.data_fim AND novo.data_fim >= existente.data_inicio
const existeContratoSobreposto = async (imovelId, dataInicio, dataFim, excluirId = null) => {
  const params = [imovelId, dataInicio, dataFim];
  let sql = `SELECT id, data_inicio, data_fim FROM contratos
             WHERE imovel_id=$1 AND status='ativo'
               AND data_inicio <= $3 AND data_fim >= $2`;
  if (excluirId) {
    params.push(excluirId);
    sql += ` AND id <> $${params.length}`;
  }
  const r = await pool.query(sql, params);
  return r.rows[0] || null;
};

// Sincroniza status de contratos vencidos e pagamentos atrasados.
// Executada no startup e periodicamente.
// Gera as parcelas mensais de aluguel (pendentes) de todos os contratos ativos
// vigentes no mês/ano informado. Idempotente: o índice único (mes, ano, imovel_id)
// garante que parcelas já existentes (criadas manualmente ou já pagas) não são tocadas.
const gerarParcelasMensais = async (mes, ano) => {
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const inicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const fimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  const contratos = await pool.query(`
    SELECT c.id, c.imovel_id, c.valor, i.dia_vencimento
    FROM contratos c JOIN imoveis i ON i.id = c.imovel_id
    WHERE c.status = 'ativo' AND c.data_inicio <= $2 AND c.data_fim >= $1
  `, [inicioMes, fimMes]);

  let criadas = 0;
  for (const c of contratos.rows) {
    // Trava o vencimento no último dia do mês (dia 31 em mês de 30 vira 30)
    const dia = Math.min(c.dia_vencimento || 10, ultimoDia);
    const venc = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const r = await pool.query(`
      INSERT INTO pagamentos (mes, ano, imovel_id, contrato_id, valor_aluguel, data_vencimento, status)
      VALUES ($1,$2,$3,$4,$5,$6,'pendente')
      ON CONFLICT (mes, ano, imovel_id) DO NOTHING
      RETURNING id
    `, [mes, ano, c.imovel_id, c.id, c.valor, venc]);
    if (r.rowCount > 0) criadas++;
  }
  return { criadas, contratos: contratos.rows.length };
};

const sincronizarStatusVencidos = async () => {
  try {
    // 1) RENOVAÇÃO AUTOMÁTICA ANUAL: contratos ativos com renovação ligada
    //    ganham +1 ano ao vencer (loop cobre contratos vencidos há mais de 1 ano).
    let renovados = 0;
    for (let i = 0; i < 12; i++) {
      const r = await pool.query(`
        UPDATE contratos SET data_fim = data_fim + INTERVAL '1 year', updated_at = NOW()
        WHERE status = 'ativo' AND renovacao_automatica = true AND data_fim < CURRENT_DATE
        RETURNING id
      `);
      renovados += r.rowCount;
      if (r.rowCount === 0) break;
    }
    if (renovados > 0) console.log(`🔄 ${renovados} contrato(s) renovado(s) automaticamente por +1 ano`);

    // 2) Marca como vencidos apenas os contratos SEM renovação automática
    //    e libera imóveis que não têm outro contrato ativo
    const c = await pool.query(
      "UPDATE contratos SET status='vencido' WHERE status='ativo' AND data_fim < CURRENT_DATE RETURNING id, imovel_id"
    );
    if (c.rowCount > 0) {
      // Para cada imóvel afetado, verifica se ainda existe contrato ativo antes de marcar como vago
      const imovelIds = [...new Set(c.rows.map(r => r.imovel_id))];
      for (const imovelId of imovelIds) {
        const ainda = await pool.query(
          "SELECT id FROM contratos WHERE imovel_id=$1 AND status='ativo' LIMIT 1",
          [imovelId]
        );
        if (ainda.rows.length === 0) {
          await pool.query("UPDATE imoveis SET status='vago' WHERE id=$1 AND status='alugado'", [imovelId]);
        }
      }
    }
    const p = await pool.query(
      "UPDATE pagamentos SET status='atrasado' WHERE status='pendente' AND data_vencimento < CURRENT_DATE RETURNING id"
    );
    const d = await pool.query(
      "UPDATE despesas SET status='atrasado' WHERE status='pendente' AND vencimento < CURRENT_DATE RETURNING id"
    );
    if (c.rowCount || p.rowCount || d.rowCount) {
      console.log(`🔁 Sync de vencidos: ${c.rowCount} contrato(s), ${p.rowCount} pagamento(s), ${d.rowCount} despesa(s)`);
    }

    // 3) GERAÇÃO AUTOMÁTICA: cria as parcelas pendentes do mês corrente
    //    para todos os contratos ativos (não toca em parcelas já existentes)
    const agora = new Date();
    const g = await gerarParcelasMensais(agora.getMonth() + 1, agora.getFullYear());
    if (g.criadas > 0) console.log(`🧾 ${g.criadas} parcela(s) de aluguel gerada(s) para ${agora.getMonth() + 1}/${agora.getFullYear()}`);

    // 4) RETENÇÃO DO LOG: o log de atividades só cresce; mantém ~1 ano de histórico
    //    para não inflar o banco indefinidamente.
    const logDel = await pool.query(
      "DELETE FROM log_atividades WHERE created_at < NOW() - INTERVAL '12 months' RETURNING id"
    );
    if (logDel.rowCount > 0) console.log(`🧹 ${logDel.rowCount} registro(s) antigo(s) de log removido(s)`);
  } catch (err) {
    console.error('Erro ao sincronizar vencidos:', err.message);
  }
};

// ============================================================
// AUTENTICAÇÃO
// ============================================================

app.post('/api/auth/login', loginLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('senha').isLength({ min: 6 })
], validate, async (req, res) => {
  try {
    const { email, senha } = req.body;

    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 AND status = $2',
      [email, 'ativo']
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const usuario = result.rows[0];
    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, perfil: usuario.perfil, nome: usuario.nome },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    await logAtividade(usuario.id, 'login', 'usuarios', usuario.id, null, req.ip);

    res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ============================================================
// USUÁRIOS
// ============================================================

app.get('/api/usuarios', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nome, email, perfil, status, created_at FROM usuarios ORDER BY nome'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/usuarios', authenticateToken, authorizeAdmin, [
  body('nome').trim().isLength({ min: 2, max: 255 }),
  body('email').isEmail().normalizeEmail(),
  body('senha').isLength({ min: 6 }),
  body('perfil').isIn(['admin', 'operador']),
  body('status').optional().isIn(['ativo', 'inativo'])
], validate, async (req, res) => {
  try {
    const { nome, email, senha, perfil, status = 'ativo' } = req.body;

    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    const senhaHash = await bcrypt.hash(senha, 12);
    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, perfil, status) VALUES ($1,$2,$3,$4,$5) RETURNING id, nome, email, perfil, status',
      [nome, email, senhaHash, perfil, status]
    );

    await logAtividade(req.user.id, 'criar_usuario', 'usuarios', result.rows[0].id, `${nome}`, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.put('/api/usuarios/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 }),
  body('nome').trim().isLength({ min: 2, max: 255 }),
  body('email').isEmail().normalizeEmail(),
  body('perfil').isIn(['admin', 'operador']),
  body('status').isIn(['ativo', 'inativo']),
  body('senha').optional().isLength({ min: 6 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, email, senha, perfil, status } = req.body;

    const emailExiste = await pool.query('SELECT id FROM usuarios WHERE email=$1 AND id<>$2', [email, id]);
    if (emailExiste.rows.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado em outro usuário' });
    }

    let query, params;
    if (senha) {
      const senhaHash = await bcrypt.hash(senha, 12);
      query = 'UPDATE usuarios SET nome=$1, email=$2, senha=$3, perfil=$4, status=$5 WHERE id=$6 RETURNING id, nome, email, perfil, status';
      params = [nome, email, senhaHash, perfil, status, id];
    } else {
      query = 'UPDATE usuarios SET nome=$1, email=$2, perfil=$3, status=$4 WHERE id=$5 RETURNING id, nome, email, perfil, status';
      params = [nome, email, perfil, status, id];
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

    await logAtividade(req.user.id, 'editar_usuario', 'usuarios', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro editar usuário:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.delete('/api/usuarios/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Não é possível excluir seu próprio usuário' });
    }

    const result = await pool.query('DELETE FROM usuarios WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

    await logAtividade(req.user.id, 'excluir_usuario', 'usuarios', parseInt(id), null, req.ip);
    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ============================================================
// INQUILINOS
// ============================================================

app.get('/api/inquilinos', authenticateToken, async (req, res) => {
  try {
    const { busca } = req.query;
    let queryStr = 'SELECT * FROM inquilinos';
    const params = [];

    if (busca) {
      queryStr += ' WHERE nome ILIKE $1 OR cpf_cnpj ILIKE $1 OR email ILIKE $1';
      params.push(`%${busca}%`);
    }

    queryStr += ' ORDER BY nome';
    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.get('/api/inquilinos/:id', authenticateToken, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inquilinos WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Inquilino não encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/inquilinos', authenticateToken, [
  body('nome').trim().isLength({ min: 2, max: 255 }),
  body('cpf_cnpj').trim().isLength({ min: 11, max: 20 }),
  body('telefone').trim().isLength({ min: 8, max: 20 }),
  body('email').optional({ nullable: true }).isEmail().normalizeEmail()
], validate, async (req, res) => {
  try {
    const { nome, cpf_cnpj, telefone, email, endereco, observacoes } = req.body;

    const cpfDigits = cpf_cnpj.replace(/\D/g, '');
    const existe = await pool.query(
      "SELECT id FROM inquilinos WHERE REGEXP_REPLACE(cpf_cnpj, '[^0-9]', '', 'g') = $1",
      [cpfDigits]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'CPF/CNPJ já cadastrado' });
    }

    const result = await pool.query(
      'INSERT INTO inquilinos (nome, cpf_cnpj, telefone, email, endereco, observacoes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [nome, cpf_cnpj, telefone, email || null, endereco, observacoes]
    );

    await logAtividade(req.user.id, 'criar_inquilino', 'inquilinos', result.rows[0].id, nome, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.put('/api/inquilinos/:id', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('nome').trim().isLength({ min: 2, max: 255 }),
  body('cpf_cnpj').trim().isLength({ min: 11, max: 20 }),
  body('telefone').trim().isLength({ min: 8, max: 20 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, cpf_cnpj, telefone, email, endereco, observacoes } = req.body;

    const cpfDigits = cpf_cnpj.replace(/\D/g, '');
    const existe = await pool.query(
      "SELECT id FROM inquilinos WHERE REGEXP_REPLACE(cpf_cnpj, '[^0-9]', '', 'g') = $1 AND id<>$2",
      [cpfDigits, id]
    );
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'CPF/CNPJ já cadastrado em outro inquilino' });
    }

    const result = await pool.query(
      'UPDATE inquilinos SET nome=$1, cpf_cnpj=$2, telefone=$3, email=$4, endereco=$5, observacoes=$6, updated_at=NOW() WHERE id=$7 RETURNING *',
      [nome, cpf_cnpj, telefone, email || null, endereco, observacoes, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Inquilino não encontrado' });

    await logAtividade(req.user.id, 'editar_inquilino', 'inquilinos', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro editar inquilino:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.delete('/api/inquilinos/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;

    const contratosAtivos = await pool.query(
      "SELECT id FROM contratos WHERE inquilino_id=$1 AND status='ativo'", [id]
    );
    if (contratosAtivos.rows.length > 0) {
      return res.status(400).json({ error: 'Inquilino possui contratos ativos. Encerre os contratos antes de excluir.' });
    }

    const todosContratos = await pool.query('SELECT id FROM contratos WHERE inquilino_id=$1', [id]);
    if (todosContratos.rows.length > 0) {
      return res.status(400).json({ error: 'Inquilino possui contratos vinculados. Exclua os contratos antes de excluir o inquilino.' });
    }

    const result = await pool.query('DELETE FROM inquilinos WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Inquilino não encontrado' });

    await logAtividade(req.user.id, 'excluir_inquilino', 'inquilinos', parseInt(id), null, req.ip);
    res.json({ message: 'Inquilino excluído com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ============================================================
// IMÓVEIS
// ============================================================

app.get('/api/imoveis', authenticateToken, async (req, res) => {
  try {
    const { busca, status } = req.query;
    let queryStr = 'SELECT * FROM imoveis';
    const params = [];
    const conditions = [];

    if (busca) {
      params.push(`%${busca}%`);
      conditions.push(`(codigo ILIKE $${params.length} OR endereco ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (conditions.length > 0) queryStr += ' WHERE ' + conditions.join(' AND ');
    queryStr += ' ORDER BY codigo';

    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.get('/api/imoveis/:id', authenticateToken, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM imoveis WHERE id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Imóvel não encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/imoveis', authenticateToken, [
  body('codigo').trim().isLength({ min: 1, max: 100 }),
  body('tipo').isIn(['casa', 'apartamento', 'comercial', 'terreno', 'galpao']),
  body('endereco').trim().isLength({ min: 5 }),
  body('valor_sem_desconto').isFloat({ min: 0 }),
  body('dia_vencimento').isInt({ min: 1, max: 31 }),
  body('status').isIn(['alugado', 'vago', 'encerrado', 'negociacao', 'manutencao'])
], validate, async (req, res) => {
  try {
    const {
      codigo, tipo, endereco, valor_com_desconto, valor_sem_desconto,
      dia_vencimento, status, numero_iptu, matricula, conta_agua, conta_energia, observacoes
    } = req.body;

    if (valor_com_desconto && parseFloat(valor_com_desconto) > parseFloat(valor_sem_desconto)) {
      return res.status(400).json({ error: 'Valor com desconto não pode ser maior que valor sem desconto' });
    }

    const existe = await pool.query('SELECT id FROM imoveis WHERE codigo=$1', [codigo]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Código de imóvel já cadastrado' });
    }

    const result = await pool.query(
      `INSERT INTO imoveis (codigo, tipo, endereco, valor_com_desconto, valor_sem_desconto,
        dia_vencimento, status, numero_iptu, matricula, conta_agua, conta_energia, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [codigo, tipo, endereco, valor_com_desconto || null, valor_sem_desconto,
       dia_vencimento, status, numero_iptu, matricula, conta_agua, conta_energia, observacoes]
    );

    await logAtividade(req.user.id, 'criar_imovel', 'imoveis', result.rows[0].id, codigo, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.put('/api/imoveis/:id', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('codigo').trim().isLength({ min: 1, max: 100 }),
  body('tipo').isIn(['casa', 'apartamento', 'comercial', 'terreno', 'galpao']),
  body('endereco').trim().isLength({ min: 5 }),
  body('valor_sem_desconto').isFloat({ min: 0 }),
  body('dia_vencimento').isInt({ min: 1, max: 31 }),
  body('status').isIn(['alugado', 'vago', 'encerrado', 'negociacao', 'manutencao'])
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      codigo, tipo, endereco, valor_com_desconto, valor_sem_desconto,
      dia_vencimento, status, numero_iptu, matricula, conta_agua, conta_energia, observacoes
    } = req.body;

    if (valor_com_desconto && parseFloat(valor_com_desconto) > parseFloat(valor_sem_desconto)) {
      return res.status(400).json({ error: 'Valor com desconto não pode ser maior que valor sem desconto' });
    }

    const existe = await pool.query('SELECT id FROM imoveis WHERE codigo=$1 AND id<>$2', [codigo, id]);
    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'Código de imóvel já cadastrado em outro imóvel' });
    }

    const result = await pool.query(
      `UPDATE imoveis SET codigo=$1, tipo=$2, endereco=$3, valor_com_desconto=$4,
        valor_sem_desconto=$5, dia_vencimento=$6, status=$7, numero_iptu=$8,
        matricula=$9, conta_agua=$10, conta_energia=$11, observacoes=$12, updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [codigo, tipo, endereco, valor_com_desconto || null, valor_sem_desconto,
       dia_vencimento, status, numero_iptu, matricula, conta_agua, conta_energia, observacoes, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Imóvel não encontrado' });

    await logAtividade(req.user.id, 'editar_imovel', 'imoveis', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro editar imóvel:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.delete('/api/imoveis/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;

    const contratos = await pool.query('SELECT id, status FROM contratos WHERE imovel_id=$1', [id]);
    if (contratos.rows.length > 0) {
      const temAtivo = contratos.rows.some(c => c.status === 'ativo');
      const msg = temAtivo
        ? 'Imóvel possui contratos ativos. Encerre os contratos antes de excluir.'
        : 'Imóvel possui contratos vinculados. Exclua os contratos antes de excluir o imóvel.';
      return res.status(400).json({ error: msg });
    }

    const pagamentos = await pool.query('SELECT id FROM pagamentos WHERE imovel_id=$1 LIMIT 1', [id]);
    if (pagamentos.rows.length > 0) {
      return res.status(400).json({ error: 'Imóvel possui pagamentos registrados e não pode ser excluído.' });
    }

    const despesas = await pool.query('SELECT id FROM despesas WHERE imovel_id=$1 LIMIT 1', [id]);
    if (despesas.rows.length > 0) {
      return res.status(400).json({ error: 'Imóvel possui despesas vinculadas. Exclua as despesas antes de excluir o imóvel.' });
    }

    const result = await pool.query('DELETE FROM imoveis WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Imóvel não encontrado' });

    await logAtividade(req.user.id, 'excluir_imovel', 'imoveis', parseInt(id), null, req.ip);
    res.json({ message: 'Imóvel excluído com sucesso' });
  } catch (error) {
    console.error('Erro excluir imóvel:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Histórico de pagamentos do imóvel
app.get('/api/imoveis/:id/historico', authenticateToken, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, inq.nome as inquilino_nome
      FROM pagamentos p
      LEFT JOIN contratos c ON c.id = p.contrato_id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
      WHERE p.imovel_id = $1
      ORDER BY p.ano DESC, p.mes DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Ficha completa do imóvel (PDF): dados cadastrais, contrato/inquilino atual,
// resumo financeiro, histórico de contratos e últimos pagamentos.
app.get('/api/imoveis/:id/ficha/pdf', authenticateToken, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const imovelRes = await pool.query('SELECT * FROM imoveis WHERE id=$1', [id]);
    if (imovelRes.rows.length === 0) return res.status(404).json({ error: 'Imóvel não encontrado' });
    const im = imovelRes.rows[0];

    const [contratoAtivoRes, contratosRes, pagAggRes, ultimosPagRes, despAggRes] = await Promise.all([
      pool.query(`
        SELECT c.*, inq.nome AS inquilino_nome, inq.cpf_cnpj AS inquilino_documento,
               inq.telefone AS inquilino_telefone, inq.email AS inquilino_email
        FROM contratos c LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
        WHERE c.imovel_id = $1 AND c.status = 'ativo'
        ORDER BY c.id DESC LIMIT 1`, [id]),
      pool.query(`
        SELECT c.data_inicio, c.data_fim, c.valor, c.status, inq.nome AS inquilino_nome
        FROM contratos c LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
        WHERE c.imovel_id = $1 ORDER BY c.data_inicio DESC`, [id]),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status='pago') AS pagos,
          COUNT(*) FILTER (WHERE status='atrasado') AS atrasados,
          COALESCE(SUM(valor_recebido) FILTER (WHERE status IN ('pago','parcial')),0) AS total_recebido,
          COALESCE(SUM(valor_aluguel) FILTER (WHERE status IN ('pendente','atrasado')),0)
            + COALESCE(SUM(GREATEST(valor_aluguel - COALESCE(valor_recebido,0),0)) FILTER (WHERE status='parcial'),0) AS total_aberto
        FROM pagamentos WHERE imovel_id = $1`, [id]),
      pool.query(`
        SELECT p.mes, p.ano, p.valor_aluguel, p.valor_recebido, p.status, p.data_vencimento, p.data_pagamento
        FROM pagamentos p WHERE p.imovel_id = $1
        ORDER BY p.ano DESC, p.mes DESC LIMIT 12`, [id]),
      pool.query(`
        SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total,
               COALESCE(SUM(valor) FILTER (WHERE status IN ('pendente','atrasado','parcial')),0) AS em_aberto
        FROM despesas WHERE imovel_id = $1`, [id])
    ]);

    const contrato = contratoAtivoRes.rows[0] || null;
    const contratos = contratosRes.rows;
    const pagAgg = pagAggRes.rows[0];
    const ultimosPag = ultimosPagRes.rows;
    const despAgg = despAggRes.rows[0];

    const fmtMoeda = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtData = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
    const tipoLabel = { casa: 'Casa', apartamento: 'Apartamento', comercial: 'Comercial', terreno: 'Terreno', galpao: 'Galpão' };
    const statusLabel = { alugado: 'Alugado', vago: 'Vago', encerrado: 'Encerrado', negociacao: 'Negociação', manutencao: 'Em Manutenção' };
    const statusPagLabel = { pago: 'Pago', pendente: 'Pendente', atrasado: 'Atrasado', parcial: 'Parcial' };

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=ficha-imovel-${im.codigo}.pdf`);
    doc.pipe(res);

    desenharCabecalhoRelatorio(doc, {
      titulo: 'Ficha Completa do Imóvel',
      periodo: `Imóvel ${im.codigo} — ${im.endereco}`,
      resumo: [
        { label: 'Situação', valor: statusLabel[im.status] || im.status },
        { label: 'Aluguel', valor: fmtMoeda(im.valor_com_desconto || im.valor_sem_desconto) }
      ]
    });

    const M = doc.page.margins.left;
    const W = doc.page.width - M * 2;
    const maxY = () => doc.page.height - doc.page.margins.bottom;
    const garantir = (h) => { if (doc.y + h > maxY()) { doc.addPage(); doc.y = doc.page.margins.top; } };

    const tituloSecao = (txt) => {
      garantir(40);
      const y0 = doc.y;
      doc.rect(M, y0, W, 20).fill('#eef2f8');
      doc.fillColor('#1e3a5f').font('Helvetica-Bold').fontSize(11).text(txt, M + 8, y0 + 5, { width: W - 16, lineBreak: false });
      doc.fillColor('#000000');
      doc.y = y0 + 28;
    };

    const campos = (pares) => {
      const colW = W / 2;
      for (let i = 0; i < pares.length; i += 2) {
        garantir(26);
        const y0 = doc.y;
        [pares[i], pares[i + 1]].forEach((p, j) => {
          if (!p) return;
          const x = M + j * colW;
          doc.font('Helvetica').fontSize(8).fillColor('#888888').text(String(p.label).toUpperCase(), x, y0, { width: colW - 10, lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#222222').text(p.valor || '—', x, y0 + 10, { width: colW - 10, lineBreak: false });
        });
        doc.y = y0 + 26;
      }
    };

    const paragrafo = (txt) => {
      garantir(24);
      doc.font('Helvetica').fontSize(9).fillColor('#333333').text(txt, M, doc.y, { width: W });
      doc.y += 6;
    };

    const tabela = (colDefs, linhas) => {
      const startX = M;
      const larg = colDefs.reduce((s, c) => s + c.w, 0);
      const drawHead = () => {
        const hy = doc.y; let x = startX;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e3a5f');
        colDefs.forEach((c) => { doc.text(c.label, x, hy, { width: c.w, lineBreak: false }); x += c.w; });
        const ly = hy + 12;
        doc.moveTo(startX, ly).lineTo(startX + larg, ly).strokeColor('#1e3a5f').lineWidth(0.5).stroke();
        doc.strokeColor('#000000').fillColor('#000000');
        doc.y = ly + 3;
      };
      garantir(30);
      drawHead();
      linhas.forEach((row) => {
        if (doc.y + 14 > maxY()) { doc.addPage(); doc.y = doc.page.margins.top; drawHead(); }
        const ry = doc.y; let x = startX;
        doc.font('Helvetica').fontSize(8).fillColor('#333333');
        colDefs.forEach((c, idx) => { doc.text(String(row[idx] ?? '—'), x, ry, { width: c.w, lineBreak: false }); x += c.w; });
        doc.y = ry + 13;
      });
      doc.y += 6;
    };

    // --- Dados cadastrais ---
    tituloSecao('Dados do Imóvel');
    campos([
      { label: 'Código', valor: im.codigo },
      { label: 'Tipo', valor: tipoLabel[im.tipo] || im.tipo },
      { label: 'Endereço', valor: im.endereco },
      { label: 'Situação', valor: statusLabel[im.status] || im.status },
      { label: 'Valor (com desconto)', valor: im.valor_com_desconto ? fmtMoeda(im.valor_com_desconto) : '—' },
      { label: 'Valor (sem desconto)', valor: fmtMoeda(im.valor_sem_desconto) },
      { label: 'Dia de vencimento', valor: `Dia ${im.dia_vencimento}` },
      { label: 'Matrícula', valor: im.matricula || '—' },
      { label: 'Nº IPTU', valor: im.numero_iptu || '—' },
      { label: 'Conta de água', valor: im.conta_agua || '—' },
      { label: 'Conta de energia', valor: im.conta_energia || '—' }
    ]);
    if (im.observacoes) { tituloSecao('Observações'); paragrafo(im.observacoes); }

    // --- Inquilino atual / contrato vigente ---
    tituloSecao('Inquilino Atual / Contrato Vigente');
    if (contrato) {
      campos([
        { label: 'Inquilino', valor: contrato.inquilino_nome },
        { label: 'Documento', valor: contrato.inquilino_documento || '—' },
        { label: 'Telefone', valor: contrato.inquilino_telefone || '—' },
        { label: 'E-mail', valor: contrato.inquilino_email || '—' },
        { label: 'Início do contrato', valor: fmtData(contrato.data_inicio) },
        { label: 'Fim do contrato', valor: fmtData(contrato.data_fim) },
        { label: 'Valor do aluguel', valor: fmtMoeda(contrato.valor) },
        { label: 'Renovação automática', valor: contrato.renovacao_automatica !== false ? 'Sim' : 'Não' }
      ]);
    } else {
      paragrafo('Imóvel sem contrato ativo no momento.');
    }

    // --- Resumo financeiro ---
    tituloSecao('Resumo Financeiro');
    campos([
      { label: 'Total recebido (histórico)', valor: fmtMoeda(pagAgg.total_recebido) },
      { label: 'Em aberto', valor: fmtMoeda(pagAgg.total_aberto) },
      { label: 'Parcelas pagas', valor: String(pagAgg.pagos) },
      { label: 'Parcelas atrasadas', valor: String(pagAgg.atrasados) },
      { label: 'Despesas lançadas', valor: `${despAgg.qtd} (${fmtMoeda(despAgg.total)})` },
      { label: 'Despesas em aberto', valor: fmtMoeda(despAgg.em_aberto) }
    ]);

    // --- Histórico de contratos ---
    if (contratos.length > 0) {
      tituloSecao('Histórico de Contratos');
      tabela(
        [
          { label: 'Inquilino', w: 200 },
          { label: 'Início', w: 90 },
          { label: 'Fim', w: 90 },
          { label: 'Valor', w: 75 },
          { label: 'Situação', w: 60 }
        ],
        contratos.map((c) => [
          c.inquilino_nome || '—', fmtData(c.data_inicio), fmtData(c.data_fim),
          fmtMoeda(c.valor), (c.status || '').charAt(0).toUpperCase() + (c.status || '').slice(1)
        ])
      );
    }

    // --- Últimos pagamentos ---
    if (ultimosPag.length > 0) {
      tituloSecao('Últimos Pagamentos');
      tabela(
        [
          { label: 'Referência', w: 90 },
          { label: 'Vencimento', w: 90 },
          { label: 'Valor', w: 80 },
          { label: 'Recebido', w: 80 },
          { label: 'Pagamento', w: 90 },
          { label: 'Status', w: 75 }
        ],
        ultimosPag.map((p) => [
          `${MESES_REL[p.mes - 1]}/${p.ano}`, fmtData(p.data_vencimento), fmtMoeda(p.valor_aluguel),
          p.valor_recebido ? fmtMoeda(p.valor_recebido) : '—', fmtData(p.data_pagamento),
          statusPagLabel[p.status] || p.status
        ])
      );
    }

    desenharRodapesRelatorio(doc);
    doc.end();
  } catch (error) {
    console.error('Erro ao gerar ficha do imóvel:', error);
    res.status(500).json({ error: 'Erro ao gerar ficha do imóvel' });
  }
});

// ============================================================
// CONTRATOS
// ============================================================

app.get('/api/contratos', authenticateToken, async (req, res) => {
  try {
    const { status, imovel_id } = req.query;
    let queryStr = `
      SELECT c.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco, i.tipo as imovel_tipo,
             inq.nome as inquilino_nome, inq.cpf_cnpj as inquilino_documento, inq.telefone as inquilino_telefone,
             (c.data_fim - CURRENT_DATE) as dias_para_vencer
      FROM contratos c
      LEFT JOIN imoveis i ON c.imovel_id = i.id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
    `;
    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }
    if (intQ(imovel_id)) {
      params.push(imovel_id);
      conditions.push(`c.imovel_id = $${params.length}`);
    }

    if (conditions.length > 0) queryStr += ' WHERE ' + conditions.join(' AND ');
    queryStr += ' ORDER BY c.id DESC';

    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.get('/api/contratos/:id', authenticateToken, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco,
             inq.nome as inquilino_nome, inq.telefone as inquilino_telefone
      FROM contratos c
      LEFT JOIN imoveis i ON c.imovel_id = i.id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
      WHERE c.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Contrato não encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/contratos', authenticateToken, upload.single('arquivo_pdf'), [
  body('imovel_id').isInt({ min: 1 }),
  body('inquilino_id').isInt({ min: 1 }),
  body('data_inicio').isDate(),
  body('data_fim').isDate(),
  body('valor').isFloat({ min: 0 }),
  body('garantia').isIn(['caucao', 'fiador', 'seguro', 'sem', 'outro']),
  body('status').isIn(['ativo', 'vencido', 'encerrado'])
], validate, async (req, res) => {
  try {
    const { imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status, observacoes } = req.body;
    const arquivo_pdf = req.file ? req.file.filename : null;
    // multipart/form-data envia booleanos como string
    const renovacaoAuto = !(req.body.renovacao_automatica === 'false' || req.body.renovacao_automatica === false);

    if (new Date(data_fim) <= new Date(data_inicio)) {
      return res.status(400).json({ error: 'A data de fim deve ser posterior à data de início' });
    }

    if (status === 'ativo') {
      const sobreposto = await existeContratoSobreposto(imovel_id, data_inicio, data_fim);
      if (sobreposto) {
        return res.status(400).json({
          error: `Já existe contrato ativo neste imóvel (${sobreposto.data_inicio} a ${sobreposto.data_fim}) com sobreposição de datas.`
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO contratos (imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status, renovacao_automatica, arquivo_pdf, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status, renovacaoAuto, arquivo_pdf, observacoes]
    );

    if (status === 'ativo') {
      await pool.query("UPDATE imoveis SET status='alugado' WHERE id=$1", [imovel_id]);
      // Já cria a parcela do mês corrente para o contrato novo (idempotente)
      const agora = new Date();
      await gerarParcelasMensais(agora.getMonth() + 1, agora.getFullYear()).catch(() => {});
    }

    await logAtividade(req.user.id, 'criar_contrato', 'contratos', result.rows[0].id, null, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.put('/api/contratos/:id', authenticateToken, upload.single('arquivo_pdf'), [
  param('id').isInt({ min: 1 }),
  body('imovel_id').isInt({ min: 1 }),
  body('inquilino_id').isInt({ min: 1 }),
  body('data_inicio').isDate(),
  body('data_fim').isDate(),
  body('valor').isFloat({ min: 0 }),
  body('garantia').isIn(['caucao', 'fiador', 'seguro', 'sem', 'outro']),
  body('status').isIn(['ativo', 'vencido', 'encerrado'])
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status, observacoes } = req.body;

    const contrato = await pool.query('SELECT * FROM contratos WHERE id=$1', [id]);
    if (contrato.rows.length === 0) return res.status(404).json({ error: 'Contrato não encontrado' });

    // Se novo PDF foi enviado, apaga o arquivo antigo do disco
    const pdfAntigo = contrato.rows[0].arquivo_pdf;
    const arquivo_pdf = req.file ? req.file.filename : pdfAntigo;
    if (req.file && pdfAntigo) {
      const caminhoAntigo = path.join(uploadDir, pdfAntigo);
      if (fs.existsSync(caminhoAntigo)) {
        fs.unlink(caminhoAntigo, (err) => {
          if (err) console.warn(`Aviso: não foi possível deletar PDF antigo ${pdfAntigo}:`, err.message);
        });
      }
    }

    if (new Date(data_fim) <= new Date(data_inicio)) {
      return res.status(400).json({ error: 'A data de fim deve ser posterior à data de início' });
    }

    const contratoAntes = contrato.rows[0];

    if (status === 'ativo') {
      const sobreposto = await existeContratoSobreposto(imovel_id, data_inicio, data_fim, id);
      if (sobreposto) {
        return res.status(400).json({
          error: `Já existe contrato ativo neste imóvel (${sobreposto.data_inicio} a ${sobreposto.data_fim}) com sobreposição de datas.`
        });
      }
    }

    // multipart/form-data envia booleanos como string; ausente mantém o valor atual
    const renovacaoAuto = req.body.renovacao_automatica === undefined
      ? contratoAntes.renovacao_automatica
      : !(req.body.renovacao_automatica === 'false' || req.body.renovacao_automatica === false);

    const result = await pool.query(
      `UPDATE contratos SET imovel_id=$1, inquilino_id=$2, data_inicio=$3, data_fim=$4,
        valor=$5, garantia=$6, status=$7, renovacao_automatica=$8, arquivo_pdf=$9, observacoes=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status, renovacaoAuto, arquivo_pdf, observacoes, id]
    );

    // Contrato saiu de ativo (encerrado/vencido): remove as parcelas FUTURAS
    // ainda pendentes — o que já venceu (pago ou devido) fica para histórico/cobrança.
    if (contratoAntes.status === 'ativo' && (status === 'encerrado' || status === 'vencido')) {
      const limpas = await pool.query(
        `DELETE FROM pagamentos
         WHERE contrato_id=$1 AND status='pendente' AND data_pagamento IS NULL
           AND data_vencimento > CURRENT_DATE
         RETURNING id`,
        [id]
      );
      if (limpas.rowCount > 0) {
        await logAtividade(req.user.id, 'limpar_parcelas_futuras', 'contratos', parseInt(id), `${limpas.rowCount} parcela(s)`, req.ip);
      }
    }

    // Se o imóvel mudou, libera o imóvel anterior
    const imovelChanged = String(contratoAntes.imovel_id) !== String(imovel_id);
    if (imovelChanged && contratoAntes.status === 'ativo') {
      const outrosAtivosAntigo = await pool.query(
        "SELECT id FROM contratos WHERE imovel_id=$1 AND status='ativo' AND id<>$2",
        [contratoAntes.imovel_id, id]
      );
      if (outrosAtivosAntigo.rows.length === 0) {
        await pool.query("UPDATE imoveis SET status='vago' WHERE id=$1", [contratoAntes.imovel_id]);
      }
    }

    // Sincroniza status do imóvel quando o status do contrato muda
    if (contratoAntes.status !== status || imovelChanged) {
      if (status === 'ativo') {
        await pool.query("UPDATE imoveis SET status='alugado' WHERE id=$1", [imovel_id]);
      } else if (status === 'encerrado' || status === 'vencido') {
        const outrosAtivos = await pool.query(
          "SELECT id FROM contratos WHERE imovel_id=$1 AND status='ativo' AND id<>$2",
          [imovel_id, id]
        );
        if (outrosAtivos.rows.length === 0) {
          await pool.query("UPDATE imoveis SET status='vago' WHERE id=$1", [imovel_id]);
        }
      }
    }

    // Se o valor do contrato mudou e ele continua ativo, propaga para as parcelas
    // futuras ainda não pagas (mês corrente em diante) — mesma lógica do reajuste,
    // evitando o contrato dizer um valor e as parcelas pendentes outro.
    if (status === 'ativo' && parseFloat(valor) !== parseFloat(contratoAntes.valor)) {
      await pool.query(
        `UPDATE pagamentos SET valor_aluguel=$1, updated_at=NOW()
         WHERE contrato_id=$2 AND status IN ('pendente','atrasado')
           AND data_vencimento >= date_trunc('month', CURRENT_DATE)`,
        [valor, id]
      );
    }

    await logAtividade(req.user.id, 'editar_contrato', 'contratos', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.delete('/api/contratos/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;

    const contratoRes = await pool.query('SELECT id, imovel_id, status, arquivo_pdf FROM contratos WHERE id=$1', [id]);
    if (contratoRes.rows.length === 0) return res.status(404).json({ error: 'Contrato não encontrado' });
    const contrato = contratoRes.rows[0];

    // Bloqueia exclusão se existem pagamentos vinculados (integridade contábil)
    const pagamentosVinculados = await pool.query(
      'SELECT id FROM pagamentos WHERE contrato_id=$1 LIMIT 1', [id]
    );
    if (pagamentosVinculados.rows.length > 0) {
      return res.status(400).json({
        error: 'Este contrato possui pagamentos registrados e não pode ser excluído. Encerre o contrato em vez de excluir.'
      });
    }

    await pool.query('DELETE FROM contratos WHERE id=$1', [id]);

    // Remove PDF do contrato do disco se existir
    if (contrato.arquivo_pdf) {
      const caminhoPdf = path.join(uploadDir, contrato.arquivo_pdf);
      if (fs.existsSync(caminhoPdf)) {
        fs.unlink(caminhoPdf, (err) => {
          if (err) console.warn(`Aviso: não foi possível deletar PDF do contrato ${id}:`, err.message);
        });
      }
    }

    if (contrato.status === 'ativo') {
      const outrosAtivos = await pool.query(
        "SELECT id FROM contratos WHERE imovel_id=$1 AND status='ativo'",
        [contrato.imovel_id]
      );
      if (outrosAtivos.rows.length === 0) {
        await pool.query("UPDATE imoveis SET status='vago' WHERE id=$1", [contrato.imovel_id]);
      }
    }

    await logAtividade(req.user.id, 'excluir_contrato', 'contratos', parseInt(id), null, req.ip);
    res.json({ message: 'Contrato excluído com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ===== Informar renovação do contrato (estende a vigência em N anos) =====
app.post('/api/contratos/:id/renovar', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('anos').optional({ values: 'falsy' }).isInt({ min: 1, max: 10 }),
  body('data_fim').optional({ values: 'falsy' }).isDate()
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const atual = await pool.query('SELECT id, data_fim, status FROM contratos WHERE id=$1', [id]);
    if (atual.rows.length === 0) return res.status(404).json({ error: 'Contrato não encontrado' });

    // Nova data fim: informada manualmente OU vigência atual + N anos (padrão 1)
    let novaDataFim;
    if (req.body.data_fim) {
      novaDataFim = req.body.data_fim;
    } else {
      const anos = parseInt(req.body.anos || 1, 10);
      const base = new Date(atual.rows[0].data_fim);
      base.setFullYear(base.getFullYear() + anos);
      novaDataFim = base.toISOString().split('T')[0];
    }

    const result = await pool.query(
      `UPDATE contratos SET data_fim=$1, status='ativo', updated_at=NOW() WHERE id=$2 RETURNING *`,
      [novaDataFim, id]
    );
    await logAtividade(req.user.id, 'renovar_contrato', 'contratos', parseInt(id), `nova vigência até ${novaDataFim}`, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao renovar contrato:', error.message);
    res.status(500).json({ error: 'Erro ao renovar contrato' });
  }
});

// ===== Informar reajuste do contrato (atualiza o valor + registra histórico) =====
app.post('/api/contratos/:id/reajustar', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('novo_valor').optional({ values: 'falsy' }).isFloat({ gt: 0 }),
  body('percentual').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }),
  body('data').optional({ values: 'falsy' }).isDate()
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const atual = await client.query('SELECT id, imovel_id, valor FROM contratos WHERE id=$1', [id]);
    if (atual.rows.length === 0) { client.release(); return res.status(404).json({ error: 'Contrato não encontrado' }); }
    const c = atual.rows[0];
    const valorAtual = parseFloat(c.valor || 0);

    const percentual = req.body.percentual != null && req.body.percentual !== '' ? parseFloat(req.body.percentual) : null;
    let novoValor;
    if (req.body.novo_valor) novoValor = parseFloat(req.body.novo_valor);
    else if (percentual != null) novoValor = Number((valorAtual * (1 + percentual / 100)).toFixed(2));
    else { client.release(); return res.status(400).json({ error: 'Informe o novo valor ou o percentual do reajuste.' }); }

    const pctCalc = percentual != null ? percentual : (valorAtual > 0 ? Number((((novoValor - valorAtual) / valorAtual) * 100).toFixed(2)) : 0);
    const dataReaj = req.body.data || new Date().toISOString().split('T')[0];
    const proximo = new Date(dataReaj); proximo.setFullYear(proximo.getFullYear() + 1);
    const dataProximo = proximo.toISOString().split('T')[0];

    await client.query('BEGIN');

    // Propaga contrato + imóvel + parcelas futuras (lógica única, ver helper).
    const parcelasMexidas = await propagarReajusteContrato(client, {
      contratoId: id, imovelId: c.imovel_id, novoValor, percentual: pctCalc, dataReaj
    });

    // Resolve reajustes ANTERIORES ainda em aberto (pendente/avisado) deste
    // contrato — marca como 'aplicado' para não continuarem contando como
    // "reajuste pendente / próximo" depois que o reajuste já foi feito.
    await client.query(
      `UPDATE reajustes SET status='aplicado', data_ultimo=$2, updated_at=NOW()
       WHERE contrato_id=$1 AND status IN ('pendente','avisado')`,
      [id, dataReaj]
    );

    await client.query(
      `INSERT INTO reajustes (imovel_id, contrato_id, valor_atual, data_ultimo, data_proximo, percentual, novo_valor, status, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'aplicado',$8)`,
      [c.imovel_id, id, valorAtual, dataReaj, dataProximo, pctCalc, novoValor, req.body.observacoes || 'Reajuste informado pela tela de contratos']
    );
    const upd = await client.query('SELECT * FROM contratos WHERE id=$1', [id]);
    await client.query('COMMIT');
    await logAtividade(req.user.id, 'reajustar_contrato', 'contratos', parseInt(id), `${valorAtual} -> ${novoValor}`, req.ip);
    res.json({ ...upd.rows[0], parcelas_atualizadas: parcelasMexidas });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erro ao reajustar contrato:', error.message);
    res.status(500).json({ error: 'Erro ao reajustar contrato' });
  } finally {
    client.release();
  }
});

// ============================================================
// PAGAMENTOS
// ============================================================

app.get('/api/pagamentos', authenticateToken, async (req, res) => {
  try {
    const { mes, ano, imovel_id, status, busca, data_inicio, data_fim } = req.query;
    const dataRe = /^\d{4}-\d{2}-\d{2}$/;
    let queryStr = `
      SELECT p.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco,
             c.inquilino_id as inquilino_id,
             inq.nome as inquilino_nome, inq.telefone as inquilino_telefone
      FROM pagamentos p
      LEFT JOIN imoveis i ON p.imovel_id = i.id
      LEFT JOIN contratos c ON c.id = p.contrato_id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
    `;
    const params = [];
    const conditions = [];

    if (intQ(mes)) { params.push(mes); conditions.push(`p.mes = $${params.length}`); }
    if (intQ(ano)) { params.push(ano); conditions.push(`p.ano = $${params.length}`); }
    // Intervalo por data de vencimento (tem prioridade sobre mes/ano quando informado)
    if (data_inicio && dataRe.test(data_inicio)) { params.push(data_inicio); conditions.push(`p.data_vencimento >= $${params.length}`); }
    if (data_fim && dataRe.test(data_fim)) { params.push(data_fim); conditions.push(`p.data_vencimento <= $${params.length}`); }
    if (intQ(imovel_id)) { params.push(imovel_id); conditions.push(`p.imovel_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`p.status = $${params.length}`); }
    if (busca) {
      params.push(`%${busca}%`);
      conditions.push(`(i.codigo ILIKE $${params.length} OR i.endereco ILIKE $${params.length} OR inq.nome ILIKE $${params.length})`);
    }

    if (conditions.length > 0) queryStr += ' WHERE ' + conditions.join(' AND ');
    queryStr += ' ORDER BY p.ano DESC, p.mes DESC, i.codigo';

    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Gera manualmente as parcelas de aluguel de um mês/ano (idempotente)
app.post('/api/pagamentos/gerar-parcelas', authenticateToken, [
  body('mes').isInt({ min: 1, max: 12 }),
  body('ano').isInt({ min: 2000, max: 2099 })
], validate, async (req, res) => {
  try {
    const mes = parseInt(req.body.mes, 10);
    const ano = parseInt(req.body.ano, 10);
    const r = await gerarParcelasMensais(mes, ano);
    await logAtividade(req.user.id, 'gerar_parcelas', 'pagamentos', null, `${mes}/${ano}: ${r.criadas} criadas`, req.ip);
    res.json({
      criadas: r.criadas,
      ja_existiam: r.contratos - r.criadas,
      contratos_ativos: r.contratos
    });
  } catch (error) {
    console.error('Erro ao gerar parcelas:', error.message);
    res.status(500).json({ error: 'Erro ao gerar parcelas' });
  }
});

// ===== Informar pagamento (dar baixa, igual Contas a Pagar) =====
// Aceita pagamento total ou parcial, com juros/multa/desconto. O valor recebido
// ACUMULA com baixas anteriores (ex.: quitar o restante de uma parcela parcial).
app.post('/api/pagamentos/:id/pagar', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('data_pagamento').isDate(),
  body('valor_recebido').isFloat({ gt: 0 }),
  body('forma_pagamento').optional({ values: 'falsy' }).isIn(['dinheiro', 'pix', 'transferencia', 'boleto', 'cartao']),
  body('juros').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  body('multa').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  body('desconto').optional({ values: 'falsy' }).isFloat({ min: 0 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data_pagamento, forma_pagamento, observacoes } = req.body;
    const valorRecebido = parseFloat(req.body.valor_recebido);
    const juros = parseFloat(req.body.juros || 0);
    const multa = parseFloat(req.body.multa || 0);
    const desconto = parseFloat(req.body.desconto || 0);

    const atual = await pool.query('SELECT valor_aluguel, valor_recebido, juros, multa, desconto FROM pagamentos WHERE id=$1', [id]);
    if (atual.rows.length === 0) return res.status(404).json({ error: 'Pagamento não encontrado' });

    const a = atual.rows[0];
    const novoRecebido = parseFloat(a.valor_recebido || 0) + valorRecebido;
    const novoJuros = parseFloat(a.juros || 0) + juros;
    const novoMulta = parseFloat(a.multa || 0) + multa;
    const novoDesconto = parseFloat(a.desconto || 0) + desconto;

    // Saldo devido: aluguel + juros + multa - desconto
    const totalDevido = parseFloat(a.valor_aluguel) + novoJuros + novoMulta - novoDesconto;
    const status = novoRecebido >= (totalDevido - 0.005) ? 'pago' : 'parcial';

    const result = await pool.query(
      `UPDATE pagamentos SET status=$1, data_pagamento=$2, valor_recebido=$3, forma_pagamento=$4,
        juros=$5, multa=$6, desconto=$7, observacoes=COALESCE($8, observacoes), updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [status, data_pagamento, novoRecebido, forma_pagamento || null, novoJuros, novoMulta, novoDesconto, observacoes || null, id]
    );

    await logAtividade(req.user.id, 'informar_pagamento', 'pagamentos', parseInt(id), status, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao informar pagamento:', error.message);
    res.status(500).json({ error: 'Erro ao informar pagamento' });
  }
});

// ===== Reabrir (estornar a baixa) — volta para pendente =====
app.post('/api/pagamentos/:id/reabrir', authenticateToken, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    // Recalcula o status conforme o vencimento: se já passou, volta 'atrasado'
    // (não 'pendente'), para não sumir dos filtros de atraso/inadimplência.
    const result = await pool.query(
      `UPDATE pagamentos SET
        status = CASE WHEN data_vencimento < CURRENT_DATE THEN 'atrasado' ELSE 'pendente' END,
        data_pagamento=NULL, valor_recebido=NULL,
        forma_pagamento=NULL, juros=0, multa=0, desconto=0, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pagamento não encontrado' });
    await logAtividade(req.user.id, 'reabrir_pagamento', 'pagamentos', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao reabrir' });
  }
});

app.post('/api/pagamentos', authenticateToken, [
  body('mes').isInt({ min: 1, max: 12 }),
  body('ano').isInt({ min: 2000, max: 2099 }),
  body('imovel_id').isInt({ min: 1 }),
  body('valor_aluguel').isFloat({ min: 0 }),
  body('data_vencimento').isDate(),
  body('status').isIn(['pago', 'pendente', 'atrasado', 'parcial'])
], validate, async (req, res) => {
  try {
    const {
      mes, ano, imovel_id, contrato_id, valor_aluguel, data_vencimento,
      data_pagamento, valor_recebido, forma_pagamento, status, observacoes
    } = req.body;

    const duplicado = await pool.query(
      'SELECT id FROM pagamentos WHERE mes=$1 AND ano=$2 AND imovel_id=$3',
      [mes, ano, imovel_id]
    );
    if (duplicado.rows.length > 0) {
      return res.status(400).json({ error: `Já existe um pagamento registrado para este imóvel em ${mes}/${ano}. Edite o registro existente.` });
    }

    const coerencia = await validarContratoDoImovel(contrato_id, imovel_id);
    if (!coerencia.ok) return res.status(400).json({ error: coerencia.error });

    const result = await pool.query(
      `INSERT INTO pagamentos (mes, ano, imovel_id, contrato_id, valor_aluguel, data_vencimento,
        data_pagamento, valor_recebido, forma_pagamento, status, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [mes, ano, imovel_id, contrato_id || null, valor_aluguel, data_vencimento,
       data_pagamento || null, valor_recebido || null, forma_pagamento || null, status, observacoes]
    );

    await logAtividade(req.user.id, 'registrar_pagamento', 'pagamentos', result.rows[0].id, `${mes}/${ano}`, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Já existe um pagamento registrado para este imóvel neste mês/ano.' });
    }
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.put('/api/pagamentos/:id', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('mes').isInt({ min: 1, max: 12 }),
  body('ano').isInt({ min: 2000, max: 2099 }),
  body('imovel_id').isInt({ min: 1 }),
  body('valor_aluguel').isFloat({ min: 0 }),
  body('data_vencimento').isDate(),
  body('status').isIn(['pago', 'pendente', 'atrasado', 'parcial'])
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      mes, ano, imovel_id, contrato_id, valor_aluguel, data_vencimento,
      data_pagamento, valor_recebido, forma_pagamento, status, observacoes
    } = req.body;

    const duplicado = await pool.query(
      'SELECT id FROM pagamentos WHERE mes=$1 AND ano=$2 AND imovel_id=$3 AND id<>$4',
      [mes, ano, imovel_id, id]
    );
    if (duplicado.rows.length > 0) {
      return res.status(400).json({ error: `Já existe outro pagamento para este imóvel em ${mes}/${ano}.` });
    }

    const coerencia = await validarContratoDoImovel(contrato_id, imovel_id);
    if (!coerencia.ok) return res.status(400).json({ error: coerencia.error });

    const result = await pool.query(
      `UPDATE pagamentos SET mes=$1, ano=$2, imovel_id=$3, contrato_id=$4, valor_aluguel=$5,
        data_vencimento=$6, data_pagamento=$7, valor_recebido=$8, forma_pagamento=$9,
        status=$10, observacoes=$11, updated_at=NOW()
       WHERE id=$12 RETURNING *`,
      [mes, ano, imovel_id, contrato_id || null, valor_aluguel, data_vencimento,
       data_pagamento || null, valor_recebido || null, forma_pagamento || null, status, observacoes, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Pagamento não encontrado' });

    await logAtividade(req.user.id, 'editar_pagamento', 'pagamentos', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Já existe um pagamento registrado para este imóvel neste mês/ano.' });
    }
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.delete('/api/pagamentos/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM pagamentos WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pagamento não encontrado' });

    await logAtividade(req.user.id, 'excluir_pagamento', 'pagamentos', parseInt(id), null, req.ip);
    res.json({ message: 'Pagamento excluído com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Gerar recibos de todos os pagamentos do mês (lote)
app.get('/api/pagamentos/recibos-lote', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }),
  query('ano').isInt({ min: 2000, max: 2099 }),
  query('inquilino_id').optional().isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { mes, ano, inquilino_id } = req.query;
    if (!mes || !ano) return res.status(400).json({ error: 'Informe mês e ano' });

    let queryStr = `
      SELECT p.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco,
             inq.nome as inquilino_nome, inq.cpf_cnpj as inquilino_documento
      FROM pagamentos p
      LEFT JOIN imoveis i ON p.imovel_id = i.id
      LEFT JOIN contratos c ON c.id = p.contrato_id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
      WHERE p.mes=$1 AND p.ano=$2 AND p.status IN ('pago','parcial')
    `;
    const params = [mes, ano];
    if (inquilino_id) {
      params.push(inquilino_id);
      queryStr += ` AND c.inquilino_id = $${params.length}`;
    }
    queryStr += ' ORDER BY i.codigo';

    const result = await pool.query(queryStr, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: inquilino_id
          ? 'Nenhum recibo encontrado para este inquilino neste mês/ano'
          : 'Nenhum pagamento pago encontrado para este mês/ano'
      });
    }

    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=recibos-${mes}-${ano}.pdf`);
    doc.pipe(res);

    result.rows.forEach((p, idx) => {
      if (idx > 0) doc.addPage();

      doc.fontSize(20).fillColor('#1e3a5f').text('RECIBO DE ALUGUEL', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor('#333').text(`Referência: ${meses[p.mes - 1]}/${p.ano}`, { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#1e3a5f');
      doc.moveDown();

      doc.fontSize(11);
      doc.text(`Imóvel: ${p.imovel_codigo} — ${p.imovel_endereco}`);
      doc.text(`Inquilino: ${p.inquilino_nome || 'N/A'}`);
      doc.text(`CPF/CNPJ: ${p.inquilino_documento || 'N/A'}`);
      doc.moveDown();
      doc.text(`Valor do Aluguel: R$ ${parseFloat(p.valor_aluguel).toFixed(2)}`);
      doc.text(`Valor Recebido: R$ ${parseFloat(p.valor_recebido || p.valor_aluguel || 0).toFixed(2)}`);
      doc.text(`Data do Pagamento: ${p.data_pagamento ? new Date(p.data_pagamento).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'N/A'}`);
      doc.text(`Forma de Pagamento: ${p.forma_pagamento || 'N/A'}`);
      doc.text(`Status: ${p.status.toUpperCase()}`);
      doc.moveDown(3);
      doc.moveTo(50, doc.y).lineTo(250, doc.y).stroke('#666');
      doc.text('Assinatura do Locador', 50, doc.y + 5);
    });

    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar recibos' });
  }
});

// Gerar recibo PDF
app.get('/api/pagamentos/:id/recibo', authenticateToken, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco,
             inq.nome as inquilino_nome, inq.cpf_cnpj as inquilino_documento
      FROM pagamentos p
      LEFT JOIN imoveis i ON p.imovel_id = i.id
      LEFT JOIN contratos c ON c.id = p.contrato_id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
      WHERE p.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Pagamento não encontrado' });

    const p = result.rows[0];
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=recibo-${p.id}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).fillColor('#1e3a5f').text('RECIBO DE ALUGUEL', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).fillColor('#333');
    doc.text(`Referência: ${meses[p.mes - 1]}/${p.ano}`, { align: 'center' });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#1e3a5f');
    doc.moveDown();

    doc.fontSize(11);
    doc.text(`Imóvel: ${p.imovel_codigo} — ${p.imovel_endereco}`);
    doc.text(`Inquilino: ${p.inquilino_nome || 'N/A'}`);
    doc.text(`CPF/CNPJ: ${p.inquilino_documento || 'N/A'}`);
    doc.moveDown();
    doc.text(`Valor do Aluguel: R$ ${parseFloat(p.valor_aluguel).toFixed(2)}`);
    doc.text(`Valor Recebido: R$ ${parseFloat(p.valor_recebido || p.valor_aluguel || 0).toFixed(2)}`);
    doc.text(`Data do Pagamento: ${p.data_pagamento ? new Date(p.data_pagamento).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'N/A'}`);
    doc.text(`Forma de Pagamento: ${p.forma_pagamento || 'N/A'}`);
    doc.text(`Status: ${p.status.toUpperCase()}`);
    doc.moveDown(3);
    doc.moveTo(50, doc.y).lineTo(250, doc.y).stroke('#666');
    doc.text('Assinatura do Locador', 50, doc.y + 5);

    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar recibo' });
  }
});

// Recibo de aluguel no padrão visual do gerador de recibos (navy + canhoto).
// Pagador = inquilino do contrato; Recebedor = recebedor cadastrado (recibo_recebedores).
// O PDF é apenas gerado na hora — NADA é gravado no banco.
app.get('/api/pagamentos/:id/recibo-premium', authenticateToken, [
  param('id').isInt({ min: 1 }),
  query('recebedor_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  query('data').optional({ values: 'falsy' }).isDate(),
  query('com_canhoto').optional().isIn(['true', 'false'])
], validate, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco,
             inq.nome as inquilino_nome, inq.cpf_cnpj as inquilino_documento
      FROM pagamentos p
      LEFT JOIN imoveis i ON p.imovel_id = i.id
      LEFT JOIN contratos c ON c.id = p.contrato_id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
      WHERE p.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pagamento não encontrado' });
    const p = result.rows[0];
    if (!p.inquilino_nome) {
      return res.status(422).json({ error: 'Este pagamento não tem inquilino vinculado (contrato). Use o recibo simples.' });
    }

    // Recebedor: o informado ou o marcado como padrão
    let rec;
    if (req.query.recebedor_id) {
      const q = await pool.query('SELECT * FROM recibo_recebedores WHERE id=$1', [req.query.recebedor_id]);
      if (q.rows.length === 0) return res.status(422).json({ error: 'Recebedor não encontrado' });
      rec = q.rows[0];
    } else {
      const q = await pool.query('SELECT * FROM recibo_recebedores ORDER BY padrao DESC, id ASC LIMIT 1');
      if (q.rows.length === 0) {
        return res.status(422).json({ error: 'Nenhum recebedor cadastrado. Cadastre um na tela Recibos.' });
      }
      rec = q.rows[0];
    }

    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const valor = parseFloat(p.valor_recebido || p.valor_aluguel || 0);
    // Data do recibo: a informada (override do usuário) tem prioridade; senão a
    // data do pagamento; senão hoje. Sempre como string 'YYYY-MM-DD' (sem fuso).
    const dataPag = req.query.data
      || (p.data_pagamento ? new Date(p.data_pagamento).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);

    const r = {
      // Sem numeração persistida: usa o id do pagamento como referência estável
      numero: p.id,
      recebedor_nome: rec.nome,
      recebedor_documento: rec.documento,
      recebedor_endereco: rec.endereco,
      recebedor_telefone: rec.telefone,
      recebedor_whatsapp: rec.whatsapp,
      recebedor_email: rec.email,
      recebedor_site: rec.site,
      recebedor_logo_url: rec.logo_url,
      pagador_nome: p.inquilino_nome,
      pagador_documento: p.inquilino_documento,
      valor,
      valor_extenso: valorPorExtenso(valor),
      forma_pagamento: p.forma_pagamento,
      data_pagamento: dataPag,
      referente: `Aluguel de ${meses[p.mes - 1]}/${p.ano} — Imóvel ${p.imovel_codigo} (${p.imovel_endereco})`,
      local: req.query.local || 'Brasília',
      com_canhoto: req.query.com_canhoto !== 'false'
    };

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=recibo-aluguel-${p.mes}-${p.ano}-${p.imovel_codigo}.pdf`);
    doc.pipe(res);
    desenharReciboPDF(doc, r);
    doc.end();
  } catch (error) {
    console.error('Erro no recibo premium:', error.message);
    res.status(500).json({ error: 'Erro ao gerar recibo' });
  }
});

// ============================================================
// DESPESAS
// ============================================================

app.get('/api/despesas', authenticateToken, async (req, res) => {
  try {
    const { imovel_id, status, tipo, mes, ano } = req.query;
    let queryStr = `
      SELECT d.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco
      FROM despesas d
      LEFT JOIN imoveis i ON d.imovel_id = i.id
    `;
    const params = [];
    const conditions = [];

    if (intQ(imovel_id)) { params.push(imovel_id); conditions.push(`d.imovel_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`d.status = $${params.length}`); }
    if (tipo) { params.push(tipo); conditions.push(`d.tipo = $${params.length}`); }
    if (intQ(mes)) { params.push(mes); conditions.push(`EXTRACT(MONTH FROM d.vencimento) = $${params.length}`); }
    if (intQ(ano)) { params.push(ano); conditions.push(`EXTRACT(YEAR FROM d.vencimento) = $${params.length}`); }

    if (conditions.length > 0) queryStr += ' WHERE ' + conditions.join(' AND ');
    queryStr += ' ORDER BY d.vencimento DESC';

    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/despesas', authenticateToken, [
  body('imovel_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('tipo').trim().notEmpty().withMessage('Categoria é obrigatória'),
  body('valor').isFloat({ min: 0 }),
  body('vencimento').isDate(),
  body('status').isIn(['pago', 'pendente', 'atrasado', 'parcial']),
  body('recorrencia_meses').optional({ values: 'falsy' }).isInt({ min: 1, max: 120 })
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { imovel_id, tipo, valor, vencimento, status, descricao, observacoes } = req.body;
    // Quantas parcelas/meses repetir (1 = sem recorrência). Limite de segurança 120.
    const total = Math.min(Math.max(parseInt(req.body.recorrencia_meses, 10) || 1, 1), 120);
    const imovel = imovel_id || null;

    await client.query('BEGIN');

    // Primeira parcela
    const result = await client.query(
      `INSERT INTO despesas (imovel_id, tipo, valor, vencimento, status, descricao, observacoes, parcela_num, parcela_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8) RETURNING *`,
      [imovel, tipo, valor, vencimento, status, descricao, observacoes, total]
    );
    const primeira = result.rows[0];
    const ocorrencias = [primeira];

    if (total > 1) {
      // Agrupa a série pelo id da primeira parcela
      await client.query('UPDATE despesas SET recorrencia_id = $1 WHERE id = $1', [primeira.id]);
      // Cálculo puro (sem fuso horário) e com "trava" no último dia do mês:
      // vencimento dia 31 em mês de 30 dias vira dia 30, não pula para o mês seguinte.
      const [by, bm, bd] = vencimento.split('-').map(Number); // ano, mês(1-12), dia
      for (let i = 1; i < total; i++) {
        const idxMes = (bm - 1) + i;            // índice de mês a partir do mês base (0-based)
        const ty = by + Math.floor(idxMes / 12);
        const tm = idxMes % 12;                 // 0-based
        const ultimoDia = new Date(ty, tm + 1, 0).getDate();
        const td = Math.min(bd, ultimoDia);
        const futuraISO = `${ty}-${String(tm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
        const r = await client.query(
          `INSERT INTO despesas (imovel_id, tipo, valor, vencimento, status, descricao, observacoes, parcela_num, parcela_total, recorrencia_id)
           VALUES ($1,$2,$3,$4,'pendente',$5,$6,$7,$8,$9) RETURNING *`,
          [imovel, tipo, valor, futuraISO, descricao, observacoes, i + 1, total, primeira.id]
        );
        ocorrencias.push(r.rows[0]);
      }
    }

    await client.query('COMMIT');
    await logAtividade(req.user.id, 'criar_despesa', 'despesas', primeira.id,
      total > 1 ? `${tipo} (${total}x)` : tipo, req.ip);

    res.status(201).json({ ...primeira, ocorrencias_criadas: ocorrencias.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar despesa:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  } finally {
    client.release();
  }
});

app.put('/api/despesas/:id', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('imovel_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('tipo').trim().notEmpty(),
  body('valor').isFloat({ min: 0 }),
  body('vencimento').isDate(),
  body('status').isIn(['pago', 'pendente', 'atrasado', 'parcial'])
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { imovel_id, tipo, valor, vencimento, status, descricao, observacoes } = req.body;

    // Se a edição reverte a conta para um estado NÃO pago, zera os dados da baixa
    // (valor_pago/forma/encargos), evitando "pendente com valor_pago > 0".
    const naoPago = status === 'pendente' || status === 'atrasado';
    const result = await pool.query(
      `UPDATE despesas SET imovel_id=$1, tipo=$2, valor=$3, vencimento=$4, status=$5,
        descricao=$6, observacoes=$7,
        data_pagamento = CASE WHEN $9 THEN NULL ELSE data_pagamento END,
        valor_pago     = CASE WHEN $9 THEN NULL ELSE valor_pago END,
        forma_pagamento= CASE WHEN $9 THEN NULL ELSE forma_pagamento END,
        juros          = CASE WHEN $9 THEN 0 ELSE juros END,
        multa          = CASE WHEN $9 THEN 0 ELSE multa END,
        desconto       = CASE WHEN $9 THEN 0 ELSE desconto END,
        updated_at=NOW() WHERE id=$8 RETURNING *`,
      [imovel_id || null, tipo, valor, vencimento, status, descricao, observacoes, id, naoPago]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Despesa não encontrada' });

    await logAtividade(req.user.id, 'editar_despesa', 'despesas', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ===== Informar pagamento (dar baixa) — total ou parcial =====
app.post('/api/despesas/:id/pagar', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('data_pagamento').isDate(),
  body('valor_pago').isFloat({ gt: 0 }),
  body('forma_pagamento').optional({ values: 'falsy' }).isString(),
  body('juros').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  body('multa').optional({ values: 'falsy' }).isFloat({ min: 0 }),
  body('desconto').optional({ values: 'falsy' }).isFloat({ min: 0 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data_pagamento, forma_pagamento, observacoes } = req.body;
    const valorPago = parseFloat(req.body.valor_pago);
    const juros = parseFloat(req.body.juros || 0);
    const multa = parseFloat(req.body.multa || 0);
    const desconto = parseFloat(req.body.desconto || 0);

    const atual = await pool.query('SELECT valor, valor_pago, juros, multa, desconto FROM despesas WHERE id=$1', [id]);
    if (atual.rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada' });

    // ACUMULA com pagamentos anteriores (ex.: ao quitar o restante de uma conta
    // que já estava 'parcial'), em vez de sobrescrever.
    const a = atual.rows[0];
    const novoPago = parseFloat(a.valor_pago || 0) + valorPago;
    const novoJuros = parseFloat(a.juros || 0) + juros;
    const novoMulta = parseFloat(a.multa || 0) + multa;
    const novoDesconto = parseFloat(a.desconto || 0) + desconto;

    // Saldo devido considerando encargos: valor + juros + multa - desconto
    const totalDevido = parseFloat(a.valor) + novoJuros + novoMulta - novoDesconto;
    // Tolerância de centavo para considerar quitado
    const status = novoPago >= (totalDevido - 0.005) ? 'pago' : 'parcial';

    const result = await pool.query(
      `UPDATE despesas SET status=$1, data_pagamento=$2, valor_pago=$3, forma_pagamento=$4,
        juros=$5, multa=$6, desconto=$7,
        observacoes=COALESCE($8, observacoes), updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [status, data_pagamento, novoPago, forma_pagamento || null, novoJuros, novoMulta, novoDesconto, observacoes || null, id]
    );

    await logAtividade(req.user.id, 'informar_pagamento_despesa', 'despesas', parseInt(id), status, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao informar pagamento:', error.message);
    res.status(500).json({ error: 'Erro ao informar pagamento' });
  }
});

// ===== Reabrir (estornar a baixa) — volta para pendente =====
app.post('/api/despesas/:id/reabrir', authenticateToken, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE despesas SET
        status = CASE WHEN vencimento < CURRENT_DATE THEN 'atrasado' ELSE 'pendente' END,
        data_pagamento=NULL, valor_pago=NULL,
        forma_pagamento=NULL, juros=0, multa=0, desconto=0, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    await logAtividade(req.user.id, 'reabrir_despesa', 'despesas', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao reabrir' });
  }
});

// ===== Categorias de contas a pagar (despesa_tipos) =====
app.get('/api/despesa-tipos', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM despesa_tipos ORDER BY nome ASC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Erro ao listar categorias' }); }
});

app.post('/api/despesa-tipos', authenticateToken, [
  body('nome').trim().notEmpty().withMessage('Informe o nome da categoria')
], validate, async (req, res) => {
  try {
    const nome = req.body.nome.trim();
    // Gera um código (slug) a partir do nome
    const codigo = nome.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || `cat_${Date.now()}`;
    const r = await pool.query(
      `INSERT INTO despesa_tipos (codigo, nome) VALUES ($1,$2)
       ON CONFLICT (codigo) DO UPDATE SET nome=EXCLUDED.nome RETURNING *`,
      [codigo, nome]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erro ao salvar categoria' }); }
});

app.delete('/api/despesa-tipos/:id', authenticateToken, [param('id').isInt({ min: 1 })], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM despesa_tipos WHERE id=$1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json({ message: 'Categoria excluída' });
  } catch (e) { res.status(500).json({ error: 'Erro ao excluir categoria' }); }
});

app.delete('/api/despesas/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 }),
  query('excluir_serie').optional().isBoolean()
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const excluirSerie = req.query.excluir_serie === 'true';

    const despesa = await pool.query('SELECT id, recorrencia_id FROM despesas WHERE id=$1', [id]);
    if (despesa.rows.length === 0) return res.status(404).json({ error: 'Despesa não encontrada' });

    const recorrenciaId = despesa.rows[0].recorrencia_id;

    if (excluirSerie && recorrenciaId) {
      // Exclui todas as despesas da mesma série (incluindo a raiz)
      await pool.query(
        'DELETE FROM despesas WHERE recorrencia_id=$1 OR id=$1',
        [recorrenciaId]
      );
      await logAtividade(req.user.id, 'excluir_despesa_serie', 'despesas', parseInt(id), `serie:${recorrenciaId}`, req.ip);
      return res.json({ message: 'Série de despesas excluída com sucesso' });
    }

    await pool.query('DELETE FROM despesas WHERE id=$1', [id]);
    await logAtividade(req.user.id, 'excluir_despesa', 'despesas', parseInt(id), null, req.ip);

    // Informa ao frontend se a despesa fazia parte de uma série
    res.json({
      message: 'Despesa excluída com sucesso',
      tinha_serie: !!recorrenciaId,
      recorrencia_id: recorrenciaId || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Exportar despesas (Excel ou PDF) com filtros opcionais
const buscarDespesasParaExport = async (req) => {
  const { status, tipo, imovel_id, mes, ano } = req.query;
  let queryStr = `
    SELECT d.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco,
           COALESCE(dt.nome, d.tipo) AS tipo_nome
    FROM despesas d
    LEFT JOIN imoveis i ON d.imovel_id = i.id
    LEFT JOIN despesa_tipos dt ON dt.codigo = d.tipo
  `;
  const params = [];
  const conditions = [];
  if (status) { params.push(status); conditions.push(`d.status = $${params.length}`); }
  if (tipo) { params.push(tipo); conditions.push(`d.tipo = $${params.length}`); }
  if (intQ(imovel_id)) { params.push(imovel_id); conditions.push(`d.imovel_id = $${params.length}`); }
  if (intQ(mes)) { params.push(mes); conditions.push(`EXTRACT(MONTH FROM d.vencimento) = $${params.length}`); }
  if (intQ(ano)) { params.push(ano); conditions.push(`EXTRACT(YEAR FROM d.vencimento) = $${params.length}`); }
  if (conditions.length > 0) queryStr += ' WHERE ' + conditions.join(' AND ');
  queryStr += ' ORDER BY d.vencimento DESC';
  const result = await pool.query(queryStr, params);
  return result.rows;
};

app.get('/api/despesas/exportar/excel', authenticateToken, async (req, res) => {
  try {
    const rows = await buscarDespesasParaExport(req);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sistema Gestão Aluguéis';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Despesas');

    ws.columns = [
      { header: 'Imóvel', key: 'imovel_codigo', width: 12 },
      { header: 'Endereço', key: 'imovel_endereco', width: 36 },
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Descrição', key: 'descricao', width: 30 },
      { header: 'Valor', key: 'valor', width: 12 },
      { header: 'Vencimento', key: 'vencimento', width: 14 },
      { header: 'Status', key: 'status', width: 12 }
    ];
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    rows.forEach((row) => {
      const newRow = ws.addRow({
        ...row,
        imovel_codigo: row.imovel_codigo || 'Geral',
        tipo: row.tipo_nome || row.tipo,
        vencimento: row.vencimento ? new Date(row.vencimento).toLocaleDateString('pt-BR') : ''
      });
      let color = 'FFFFFFFF';
      if (row.status === 'pago') color = 'FFD4EDDA';
      else if (row.status === 'atrasado') color = 'FFF8D7DA';
      else if (row.status === 'pendente') color = 'FFFFF3CD';
      newRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    });

    // Totais
    const total = rows.reduce((s, r) => s + parseFloat(r.valor || 0), 0);
    ws.addRow([]);
    const totalRow = ws.addRow({ tipo: 'TOTAL', valor: total });
    totalRow.font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="despesas-${new Date().toISOString().split('T')[0]}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Erro ao exportar despesas Excel:', error);
    res.status(500).json({ error: 'Erro ao gerar Excel' });
  }
});

// ============================================================
// PDF de relatórios — cabeçalho e rodapé padronizados
// ============================================================

// Nome da empresa exibido no topo dos relatórios (configurável por env).
const EMPRESA_NOME = process.env.EMPRESA_NOME || 'Sistema de Gestão de Aluguéis';

const MESES_REL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// Desenha o cabeçalho padrão (faixa azul com nome da empresa + data de emissão,
// título, período e linha de resumo). Retorna o Y onde o conteúdo deve começar.
function desenharCabecalhoRelatorio(doc, { titulo, periodo, resumo } = {}) {
  const M = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const largura = right - M;
  let y = M;

  // Faixa azul com nome da empresa + data de emissão
  doc.rect(M, y, largura, 34).fill('#1e3a5f');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14)
    .text(EMPRESA_NOME, M + 12, y + 10, { width: largura - 220, lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#c7d2e5')
    .text(`Emitido em ${new Date().toLocaleString('pt-BR')}`, M, y + 12, { width: largura - 12, align: 'right' });
  y += 34 + 12;

  // Título do relatório
  doc.fillColor('#1e3a5f').font('Helvetica-Bold').fontSize(14).text(titulo || 'Relatório', M, y);
  y = doc.y + 1;

  // Período
  if (periodo) {
    doc.fillColor('#666666').font('Helvetica').fontSize(10).text(periodo, M, y);
    y = doc.y + 1;
  }

  // Linha de resumo (ex.: Total: R$ X · N registros)
  if (resumo && resumo.length) {
    const texto = resumo.map((r) => `${r.label}: ${r.valor}`).join('     ·     ');
    doc.fillColor('#333333').font('Helvetica-Bold').fontSize(10).text(texto, M, y);
    y = doc.y + 1;
  }

  y += 8;
  doc.moveTo(M, y).lineTo(right, y).strokeColor('#1e3a5f').lineWidth(1).stroke();
  doc.strokeColor('#000000').lineWidth(1).fillColor('#000000');
  doc.y = y + 10;
  return doc.y;
}

// Adiciona rodapé (linha + nome da empresa + "Página X de Y") em todas as
// páginas. Requer que o PDFDocument seja criado com { bufferPages: true }.
function desenharRodapesRelatorio(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const M = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const yLinha = doc.page.height - doc.page.margins.bottom + 10;
    // Escrever na área da margem inferior dispararia auto-paginação do PDFKit;
    // zera a margem de baixo durante a escrita e restaura em seguida.
    const margemBaixo = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(M, yLinha).lineTo(right, yLinha).strokeColor('#d0d7e2').lineWidth(0.5).stroke();
    doc.strokeColor('#000000');
    doc.fillColor('#999999').font('Helvetica').fontSize(8)
      .text(EMPRESA_NOME, M, yLinha + 4, { width: (right - M) / 2, align: 'left', lineBreak: false });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, M, yLinha + 4, { width: right - M, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margemBaixo;
  }
}

app.get('/api/despesas/exportar/pdf', authenticateToken, async (req, res) => {
  try {
    const rows = await buscarDespesasParaExport(req);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contas-a-pagar-${new Date().toISOString().split('T')[0]}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape', bufferPages: true });
    doc.pipe(res);

    const totalGeral = rows.reduce((s, r) => s + parseFloat(r.valor || 0), 0);
    const { mes: mesF, ano: anoF, status: statusF } = req.query;
    let periodo = 'Período: todos os lançamentos';
    if (mesF && anoF) periodo = `Período: ${MESES_REL[parseInt(mesF) - 1]}/${anoF}`;
    else if (anoF) periodo = `Período: ano de ${anoF}`;
    desenharCabecalhoRelatorio(doc, {
      titulo: 'Relatório de Contas a Pagar',
      periodo: statusF ? `${periodo} · Status: ${statusF}` : periodo,
      resumo: [
        { label: 'Total', valor: `R$ ${totalGeral.toFixed(2)}` },
        { label: 'Lançamentos', valor: String(rows.length) }
      ]
    });

    // Cabeçalho da tabela
    const startX = 40;
    let y = doc.y;
    const cols = [
      { label: 'Imóvel', x: 0, w: 60 },
      { label: 'Tipo', x: 60, w: 80 },
      { label: 'Descrição', x: 140, w: 200 },
      { label: 'Valor', x: 340, w: 80 },
      { label: 'Vencimento', x: 420, w: 80 },
      { label: 'Status', x: 500, w: 70 }
    ];
    const drawColsHeader = () => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e3a5f');
      cols.forEach((c) => doc.text(c.label, startX + c.x, y, { width: c.w, lineBreak: false }));
      y += 18;
      doc.moveTo(startX, y - 4).lineTo(startX + 570, y - 4).strokeColor('#1e3a5f').stroke();
      doc.strokeColor('#000000').fillColor('#000000').fontSize(9).font('Helvetica');
    };
    drawColsHeader();

    let total = 0;
    rows.forEach((r) => {
      if (y > 520) {
        doc.addPage();
        y = 40;
        drawColsHeader();
      }
      const venc = r.vencimento ? new Date(r.vencimento).toLocaleDateString('pt-BR') : '—';
      doc.fillColor('#333333');
      doc.text(r.imovel_codigo || 'Geral', startX + cols[0].x, y, { width: cols[0].w });
      doc.text(r.tipo_nome || r.tipo, startX + cols[1].x, y, { width: cols[1].w });
      doc.text((r.descricao || '—').substring(0, 50), startX + cols[2].x, y, { width: cols[2].w });
      doc.text(`R$ ${parseFloat(r.valor).toFixed(2)}`, startX + cols[3].x, y, { width: cols[3].w });
      doc.text(venc, startX + cols[4].x, y, { width: cols[4].w });
      doc.text(r.status, startX + cols[5].x, y, { width: cols[5].w });
      total += parseFloat(r.valor || 0);
      y += 16;
    });

    y += 10;
    doc.moveTo(startX, y).lineTo(startX + 570, y).strokeColor('#1e3a5f').stroke();
    y += 6;
    doc.fillColor('#1e3a5f').fontSize(11).font('Helvetica-Bold').text(`TOTAL: R$ ${total.toFixed(2)}`, startX + 340, y);

    desenharRodapesRelatorio(doc);
    doc.end();
  } catch (error) {
    console.error('Erro ao exportar despesas PDF:', error);
    res.status(500).json({ error: 'Erro ao gerar PDF' });
  }
});

// ============================================================
// REAJUSTES
// ============================================================

app.get('/api/reajustes', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    let queryStr = `
      SELECT r.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco,
             inq.nome as inquilino_nome
      FROM reajustes r
      LEFT JOIN imoveis i ON r.imovel_id = i.id
      LEFT JOIN contratos c ON c.id = r.contrato_id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
    `;
    const params = [];

    if (status) {
      params.push(status);
      queryStr += ` WHERE r.status = $1`;
    }

    queryStr += ' ORDER BY r.data_proximo';
    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/reajustes', authenticateToken, [
  body('imovel_id').isInt({ min: 1 }),
  body('valor_atual').isFloat({ min: 0 }),
  body('data_proximo').isDate(),
  body('percentual').isFloat({ min: 0, max: 100 }),
  body('novo_valor').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
  body('status').isIn(['pendente', 'avisado', 'aplicado'])
], validate, async (req, res) => {
  try {
    const { imovel_id, contrato_id, valor_atual, data_ultimo, data_proximo, percentual, status, observacoes } = req.body;
    const novoValorCalc = req.body.novo_valor
      ? parseFloat(req.body.novo_valor)
      : Number((parseFloat(valor_atual) * (1 + parseFloat(percentual) / 100)).toFixed(2));

    const coerencia = await validarContratoDoImovel(contrato_id, imovel_id);
    if (!coerencia.ok) return res.status(400).json({ error: coerencia.error });

    const result = await pool.query(
      `INSERT INTO reajustes (imovel_id, contrato_id, valor_atual, data_ultimo, data_proximo, percentual, novo_valor, status, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [imovel_id, contrato_id || null, valor_atual, data_ultimo || null, data_proximo, percentual, novoValorCalc, status, observacoes]
    );

    // Se já foi criado como 'aplicado', propaga igual ao botão "Informar reajuste".
    if (status === 'aplicado' && result.rows[0].contrato_id) {
      const dataReaj = data_ultimo || new Date().toISOString().split('T')[0];
      await propagarReajusteContrato(pool, {
        contratoId: result.rows[0].contrato_id, imovelId: result.rows[0].imovel_id,
        novoValor: novoValorCalc, percentual, dataReaj
      });
    }

    await logAtividade(req.user.id, 'criar_reajuste', 'reajustes', result.rows[0].id, null, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.put('/api/reajustes/:id', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('imovel_id').isInt({ min: 1 }),
  body('valor_atual').isFloat({ min: 0 }),
  body('data_proximo').isDate(),
  body('percentual').isFloat({ min: 0, max: 100 }),
  body('novo_valor').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }),
  body('status').isIn(['pendente', 'avisado', 'aplicado'])
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { imovel_id, contrato_id, valor_atual, data_ultimo, data_proximo, percentual, status, observacoes } = req.body;
    const novoValorCalc = req.body.novo_valor
      ? parseFloat(req.body.novo_valor)
      : Number((parseFloat(valor_atual) * (1 + parseFloat(percentual) / 100)).toFixed(2));

    const coerencia = await validarContratoDoImovel(contrato_id, imovel_id);
    if (!coerencia.ok) return res.status(400).json({ error: coerencia.error });

    // Status anterior, para só APLICAR quando houver transição para 'aplicado'
    // (evita re-aplicar o reajuste — escalar o imóvel 2× — ao re-salvar).
    const antes = await pool.query('SELECT status FROM reajustes WHERE id=$1', [id]);
    if (antes.rows.length === 0) return res.status(404).json({ error: 'Reajuste não encontrado' });
    const eraAplicado = antes.rows[0].status === 'aplicado';

    const result = await pool.query(
      `UPDATE reajustes SET imovel_id=$1, contrato_id=$2, valor_atual=$3, data_ultimo=$4,
        data_proximo=$5, percentual=$6, novo_valor=$7, status=$8, observacoes=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [imovel_id, contrato_id || null, valor_atual, data_ultimo || null, data_proximo, percentual, novoValorCalc, status, observacoes, id]
    );

    // Ao APLICAR (transição para 'aplicado'), propaga igual ao botão "Informar
    // reajuste": contrato + imóvel (escalado) + parcelas futuras não pagas.
    if (status === 'aplicado' && !eraAplicado && result.rows[0].contrato_id) {
      const dataReaj = data_ultimo || new Date().toISOString().split('T')[0];
      await propagarReajusteContrato(pool, {
        contratoId: result.rows[0].contrato_id, imovelId: result.rows[0].imovel_id,
        novoValor: novoValorCalc, percentual, dataReaj
      });
    }

    await logAtividade(req.user.id, 'editar_reajuste', 'reajustes', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.delete('/api/reajustes/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM reajustes WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Reajuste não encontrado' });

    await logAtividade(req.user.id, 'excluir_reajuste', 'reajustes', parseInt(id), null, req.ip);
    res.json({ message: 'Reajuste excluído com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ============================================================
// DASHBOARD
// ============================================================

app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    const dataLimite30 = new Date();
    dataLimite30.setDate(dataLimite30.getDate() + 30);

    const [
      totalImoveis, imoveisPorStatus, pagamentosMes, emAbertoGeral,
      despesasMes, contratosVencendo, reajustesPendentes, alertas
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM imoveis'),
      pool.query('SELECT status, COUNT(*) as total FROM imoveis GROUP BY status'),
      pool.query(`
        SELECT
          SUM(valor_aluguel) as total_receber,
          SUM(CASE WHEN status='pago' OR status='parcial' THEN COALESCE(valor_recebido, 0) ELSE 0 END) as total_recebido,
          COUNT(CASE WHEN status='atrasado' THEN 1 END) as total_atrasados
        FROM pagamentos WHERE mes=$1 AND ano=$2
      `, [mesAtual, anoAtual]),
      // Dívida REAL em aberto somando TODOS os meses (igual à tela Inadimplência):
      // atrasados + parciais + pendentes já vencidos, com saldo > 0.
      pool.query(`
        SELECT
          COALESCE(SUM(valor_aluguel - COALESCE(valor_recebido, 0)), 0) AS total_em_aberto,
          COUNT(*) AS qtd_em_aberto
        FROM pagamentos
        WHERE (valor_aluguel - COALESCE(valor_recebido, 0)) > 0
          AND (status='atrasado' OR status='parcial' OR (status='pendente' AND data_vencimento < CURRENT_DATE))
      `),
      pool.query(`
        SELECT SUM(valor) as total FROM despesas
        WHERE EXTRACT(MONTH FROM vencimento)=$1 AND EXTRACT(YEAR FROM vencimento)=$2
      `, [mesAtual, anoAtual]),
      pool.query(`
        SELECT COUNT(*) as total FROM contratos
        WHERE status='ativo' AND data_fim BETWEEN $1 AND $2
      `, [hoje.toISOString().split('T')[0], dataLimite30.toISOString().split('T')[0]]),
      pool.query("SELECT COUNT(*) as total FROM reajustes WHERE status='pendente'"),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM contratos WHERE status='ativo' AND data_fim BETWEEN $1 AND $2) as contratos_vencendo_7dias,
          (SELECT COUNT(*) FROM reajustes WHERE status IN ('pendente','avisado') AND data_proximo <= $3) as reajustes_urgentes,
          (SELECT COUNT(*) FROM despesas WHERE status='atrasado') as despesas_atrasadas
      `, [
        hoje.toISOString().split('T')[0],
        new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
      ])
    ]);

    const totalReceber = parseFloat(pagamentosMes.rows[0]?.total_receber || 0);
    const totalRecebido = parseFloat(pagamentosMes.rows[0]?.total_recebido || 0);

    res.json({
      totalImoveis: parseInt(totalImoveis.rows[0].total),
      imoveisAlugados: parseInt(imoveisPorStatus.rows.find(s => s.status === 'alugado')?.total || 0),
      imoveisVagos: parseInt(imoveisPorStatus.rows.find(s => s.status === 'vago')?.total || 0),
      imoveisNegociacao: parseInt(imoveisPorStatus.rows.find(s => s.status === 'negociacao')?.total || 0),
      imoveisManutencao: parseInt(imoveisPorStatus.rows.find(s => s.status === 'manutencao')?.total || 0),
      totalReceber,
      totalRecebido,
      valorAberto: Math.max(0, totalReceber - totalRecebido),
      alugueisAtrasados: parseInt(pagamentosMes.rows[0]?.total_atrasados || 0),
      // Dívida total em aberto somando TODOS os meses (bate com a tela Inadimplência)
      totalEmAberto: parseFloat(emAbertoGeral.rows[0]?.total_em_aberto || 0),
      atrasadosGeral: parseInt(emAbertoGeral.rows[0]?.qtd_em_aberto || 0),
      despesasMes: parseFloat(despesasMes.rows[0]?.total || 0),
      contratosVencendo: parseInt(contratosVencendo.rows[0].total),
      reajustesPendentes: parseInt(reajustesPendentes.rows[0].total),
      alertas: {
        contratosVencendo7Dias: parseInt(alertas.rows[0].contratos_vencendo_7dias),
        reajustesUrgentes: parseInt(alertas.rows[0].reajustes_urgentes),
        despesasAtrasadas: parseInt(alertas.rows[0].despesas_atrasadas)
      }
    });
  } catch (error) {
    console.error('Erro no dashboard:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Evolução mensal (últimos 6 meses)
app.get('/api/dashboard/evolucao', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        mes, ano,
        SUM(valor_aluguel) as total_receber,
        SUM(CASE WHEN status IN ('pago','parcial') THEN COALESCE(valor_recebido,0) ELSE 0 END) as total_recebido
      FROM pagamentos
      WHERE (ano * 12 + mes) >= ((EXTRACT(YEAR FROM NOW())::int * 12 + EXTRACT(MONTH FROM NOW())::int) - 5)
      GROUP BY mes, ano
      ORDER BY ano, mes
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ============================================================
// RELATÓRIOS
// ============================================================

// Relatório mensal de aluguéis
app.get('/api/relatorios/mensal', authenticateToken, [
  query('mes').isInt({ min: 1, max: 12 }),
  query('ano').isInt({ min: 2000, max: 2099 })
], validate, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    if (!mes || !ano) return res.status(400).json({ error: 'Informe mês e ano' });

    const result = await pool.query(`
      SELECT p.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco, i.tipo as imovel_tipo,
             inq.nome as inquilino_nome, inq.cpf_cnpj as inquilino_documento, inq.telefone as inquilino_telefone
      FROM pagamentos p
      LEFT JOIN imoveis i ON p.imovel_id = i.id
      LEFT JOIN contratos c ON c.id = p.contrato_id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
      WHERE p.mes=$1 AND p.ano=$2
      ORDER BY i.codigo
    `, [mes, ano]);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Relatório de inadimplência
app.get('/api/relatorios/inadimplencia', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vw_inadimplencia');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Inadimplência consolidada POR INQUILINO — soma todos os meses em aberto
// (atrasado + pendente vencido) e o que falta dos pagamentos parciais.
// Diferente do relatório simples, aqui cada inquilino vira UMA ficha com o
// total devido, nº de meses e dias do atraso mais antigo.
app.get('/api/relatorios/inadimplencia/consolidada', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id, p.mes, p.ano, p.valor_aluguel, p.valor_recebido, p.status,
        p.data_vencimento,
        (CURRENT_DATE - p.data_vencimento) AS dias_atraso,
        (p.valor_aluguel - COALESCE(p.valor_recebido, 0)) AS falta,
        i.id AS imovel_id, i.codigo AS imovel_codigo, i.endereco AS imovel_endereco,
        inq.id AS inquilino_id, inq.nome AS inquilino_nome,
        inq.telefone AS inquilino_telefone, inq.email AS inquilino_email
      FROM pagamentos p
      JOIN imoveis i ON p.imovel_id = i.id
      LEFT JOIN contratos c ON c.id = p.contrato_id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
      WHERE (p.valor_aluguel - COALESCE(p.valor_recebido, 0)) > 0
        AND (
          p.status = 'atrasado'
          OR p.status = 'parcial'
          OR (p.status = 'pendente' AND p.data_vencimento < CURRENT_DATE)
        )
      ORDER BY p.ano, p.mes
    `);

    // Agrupa por inquilino (ou por imóvel quando não há inquilino vinculado)
    const mapa = new Map();
    for (const row of result.rows) {
      const chave = row.inquilino_id ? `inq-${row.inquilino_id}` : `imv-${row.imovel_id}`;
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          inquilino_id: row.inquilino_id || null,
          inquilino_nome: row.inquilino_nome || `Sem inquilino — ${row.imovel_codigo}`,
          inquilino_telefone: row.inquilino_telefone || null,
          inquilino_email: row.inquilino_email || null,
          meses_em_aberto: 0,
          dias_atraso_max: 0,
          total_devido: 0,
          total_atrasado: 0,
          total_pendente: 0,
          total_parcial: 0,
          pagamentos: []
        });
      }
      const g = mapa.get(chave);
      const falta = parseFloat(row.falta);
      const dias = Math.max(0, parseInt(row.dias_atraso, 10));
      g.meses_em_aberto += 1;
      g.total_devido += falta;
      if (dias > g.dias_atraso_max) g.dias_atraso_max = dias;
      if (row.status === 'parcial') g.total_parcial += falta;
      else if (row.status === 'atrasado') g.total_atrasado += falta;
      else g.total_pendente += falta; // pendente já vencido
      g.pagamentos.push({
        id: row.id, mes: row.mes, ano: row.ano,
        valor_aluguel: parseFloat(row.valor_aluguel),
        valor_recebido: row.valor_recebido != null ? parseFloat(row.valor_recebido) : null,
        falta, status: row.status,
        data_vencimento: row.data_vencimento,
        dias_atraso: dias,
        imovel_codigo: row.imovel_codigo,
        imovel_endereco: row.imovel_endereco
      });
    }

    // Ordena: maior dívida primeiro (mais crítico no topo)
    const inquilinos = Array.from(mapa.values()).sort((a, b) => b.total_devido - a.total_devido);
    const resumo = {
      total_inquilinos: inquilinos.length,
      total_devido: inquilinos.reduce((s, g) => s + g.total_devido, 0),
      total_atrasado: inquilinos.reduce((s, g) => s + g.total_atrasado, 0),
      total_pendente: inquilinos.reduce((s, g) => s + g.total_pendente, 0),
      total_parcial: inquilinos.reduce((s, g) => s + g.total_parcial, 0),
      meses_em_aberto: inquilinos.reduce((s, g) => s + g.meses_em_aberto, 0),
      criticos: inquilinos.filter((g) => g.meses_em_aberto >= 3).length
    };
    res.json({ resumo, inquilinos });
  } catch (error) {
    console.error('Erro na inadimplência consolidada:', error.message);
    res.status(500).json({ error: 'Erro ao gerar inadimplência consolidada' });
  }
});

// Relatório de imóveis vagos
app.get('/api/relatorios/imoveis-vagos', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM imoveis WHERE status IN ('vago', 'negociacao') ORDER BY codigo"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Relatório de contratos vencendo
app.get('/api/relatorios/contratos-vencendo', authenticateToken, [
  query('dias').optional().isInt({ min: 1, max: 365 })
], validate, async (req, res) => {
  try {
    const { dias = 60 } = req.query;
    const result = await pool.query(`
      SELECT c.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco,
             inq.nome as inquilino_nome, inq.telefone as inquilino_telefone,
             (c.data_fim - CURRENT_DATE) as dias_para_vencer
      FROM contratos c
      JOIN imoveis i ON c.imovel_id = i.id
      JOIN inquilinos inq ON c.inquilino_id = inq.id
      WHERE c.status='ativo' AND c.data_fim <= (CURRENT_DATE + $1::integer)
      ORDER BY c.data_fim
    `, [dias]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Relatório de despesas
app.get('/api/relatorios/despesas', authenticateToken, [
  query('mes').optional().isInt({ min: 1, max: 12 }),
  query('ano').optional().isInt({ min: 2000, max: 2099 })
], validate, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    let queryStr = `
      SELECT d.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco
      FROM despesas d LEFT JOIN imoveis i ON d.imovel_id = i.id
    `;
    const params = [];

    if (mes && ano) {
      queryStr += ' WHERE EXTRACT(MONTH FROM d.vencimento)=$1 AND EXTRACT(YEAR FROM d.vencimento)=$2';
      params.push(mes, ano);
    }
    queryStr += ' ORDER BY d.vencimento';

    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Exportar relatório Excel
app.get('/api/relatorios/exportar/excel', authenticateToken, async (req, res) => {
  try {
    const { tipo, mes, ano } = req.query;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sistema Gestão Aluguéis';
    workbook.created = new Date();

    if (tipo === 'mensal' && mes && ano) {
      const result = await pool.query(`
        SELECT p.mes, p.ano, i.codigo, i.endereco, inq.nome as inquilino, p.valor_aluguel,
               p.data_vencimento, p.data_pagamento, p.valor_recebido, p.forma_pagamento, p.status
        FROM pagamentos p
        LEFT JOIN imoveis i ON p.imovel_id = i.id
        LEFT JOIN contratos c ON c.id = p.contrato_id
        LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
        WHERE p.mes=$1 AND p.ano=$2 ORDER BY i.codigo
      `, [mes, ano]);

      // Nome de aba não pode conter / \ ? * [ ] : (restrição do Excel/exceljs)
      const ws = workbook.addWorksheet(`Aluguéis ${mes}-${ano}`);
      ws.columns = [
        { header: 'Código', key: 'codigo', width: 10 },
        { header: 'Endereço', key: 'endereco', width: 40 },
        { header: 'Inquilino', key: 'inquilino', width: 30 },
        { header: 'Valor', key: 'valor_aluguel', width: 12 },
        { header: 'Vencimento', key: 'data_vencimento', width: 14 },
        { header: 'Pagamento', key: 'data_pagamento', width: 14 },
        { header: 'Recebido', key: 'valor_recebido', width: 12 },
        { header: 'Forma', key: 'forma_pagamento', width: 14 },
        { header: 'Status', key: 'status', width: 12 }
      ];
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

      result.rows.forEach(row => {
        const newRow = ws.addRow(row);
        let color = 'FFFFFFFF';
        if (row.status === 'pago') color = 'FFD4EDDA';
        else if (row.status === 'atrasado') color = 'FFF8D7DA';
        else if (row.status === 'pendente') color = 'FFFFF3CD';
        newRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      });
    } else if (tipo === 'inadimplencia') {
      const result = await pool.query('SELECT * FROM vw_inadimplencia');
      const ws = workbook.addWorksheet('Inadimplência');
      ws.columns = [
        { header: 'Código Imóvel', key: 'imovel_codigo', width: 14 },
        { header: 'Endereço', key: 'imovel_endereco', width: 40 },
        { header: 'Inquilino', key: 'inquilino_nome', width: 30 },
        { header: 'Mês', key: 'mes', width: 6 },
        { header: 'Ano', key: 'ano', width: 6 },
        { header: 'Valor', key: 'valor_aluguel', width: 12 },
        { header: 'Vencimento', key: 'data_vencimento', width: 14 },
        { header: 'Dias Atraso', key: 'dias_atraso', width: 12 },
        { header: 'Telefone', key: 'inquilino_telefone', width: 16 }
      ];
      ws.getRow(1).font = { bold: true };
      result.rows.forEach(row => ws.addRow(row));
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-${tipo}-${Date.now()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Erro ao exportar Excel:', error);
    res.status(500).json({ error: 'Erro ao exportar' });
  }
});

// Exportar relatório PDF
app.get('/api/relatorios/exportar/pdf', authenticateToken, async (req, res) => {
  try {
    const { tipo, mes, ano } = req.query;
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    let rows = [];
    let titulo = '';

    if (tipo === 'mensal' && mes && ano) {
      const result = await pool.query(`
        SELECT i.codigo, i.endereco, inq.nome as inquilino,
               p.valor_aluguel, p.data_vencimento, p.status
        FROM pagamentos p
        LEFT JOIN imoveis i ON p.imovel_id = i.id
        LEFT JOIN contratos c ON c.id = p.contrato_id
        LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
        WHERE p.mes=$1 AND p.ano=$2 ORDER BY i.codigo
      `, [mes, ano]);
      rows = result.rows;
      titulo = `Relatório de Aluguéis — ${meses[parseInt(mes) - 1]}/${ano}`;
    } else if (tipo === 'inadimplencia') {
      const result = await pool.query('SELECT * FROM vw_inadimplencia');
      rows = result.rows;
      titulo = 'Relatório de Inadimplência';
    } else if (tipo === 'imoveis-vagos') {
      const result = await pool.query(
        "SELECT codigo, tipo, endereco, valor_sem_desconto, dia_vencimento, status FROM imoveis WHERE status IN ('vago','negociacao') ORDER BY codigo"
      );
      rows = result.rows;
      titulo = 'Relatório de Imóveis Vagos';
    } else {
      return res.status(400).json({ error: 'Tipo de relatório inválido. Use: mensal, inadimplencia ou imoveis-vagos' });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Nenhum dado encontrado para os filtros informados' });
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-${tipo}-${Date.now()}.pdf`);
    doc.pipe(res);

    // Colunas (campo + rótulo + largura) por tipo de relatório
    const defsMensal = [
      { key: 'codigo', label: 'Imóvel', w: 70 },
      { key: 'endereco', label: 'Endereço', w: 230 },
      { key: 'inquilino', label: 'Inquilino', w: 170 },
      { key: 'valor_aluguel', label: 'Valor', w: 90, money: true },
      { key: 'data_vencimento', label: 'Vencimento', w: 90, date: true },
      { key: 'status', label: 'Status', w: 80 }
    ];
    const defsInad = [
      { key: 'imovel_codigo', label: 'Imóvel', w: 70 },
      { key: 'inquilino_nome', label: 'Inquilino', w: 220 },
      { key: 'mes', label: 'Mês', w: 50 },
      { key: 'ano', label: 'Ano', w: 50 },
      { key: 'valor_aluguel', label: 'Valor', w: 90, money: true },
      { key: 'dias_atraso', label: 'Dias atraso', w: 80 }
    ];
    const defsVagos = [
      { key: 'codigo', label: 'Código', w: 80 },
      { key: 'tipo', label: 'Tipo', w: 100 },
      { key: 'endereco', label: 'Endereço', w: 280 },
      { key: 'valor_sem_desconto', label: 'Valor', w: 90, money: true },
      { key: 'dia_vencimento', label: 'Venc.', w: 60 },
      { key: 'status', label: 'Status', w: 80 }
    ];
    const defs = tipo === 'mensal' ? defsMensal : tipo === 'inadimplencia' ? defsInad : defsVagos;

    // Período e resumo
    let periodo = `Total de registros: ${rows.length}`;
    if (tipo === 'mensal') periodo = `Período: ${meses[parseInt(mes) - 1]}/${ano}`;
    const resumo = [{ label: 'Registros', valor: String(rows.length) }];
    if (tipo === 'mensal' || tipo === 'inadimplencia') {
      const somaValor = rows.reduce((s, r) => s + parseFloat(r.valor_aluguel || 0), 0);
      resumo.unshift({ label: 'Valor total', valor: `R$ ${somaValor.toFixed(2)}` });
    }

    desenharCabecalhoRelatorio(doc, { titulo, periodo, resumo });

    const startX = doc.page.margins.left;
    const larguraTabela = defs.reduce((s, d) => s + d.w, 0);
    const fmtCell = (val, def) => {
      if (val == null || val === '') return '—';
      if (def.money) return `R$ ${parseFloat(val).toFixed(2)}`;
      if (def.date) { const d = new Date(val); return isNaN(d.getTime()) ? String(val) : d.toLocaleDateString('pt-BR'); }
      return String(val);
    };
    const drawHeader = () => {
      const hy = doc.y;
      let x = startX;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e3a5f');
      defs.forEach((d) => { doc.text(d.label, x, hy, { width: d.w, lineBreak: false }); x += d.w; });
      const ly = hy + 14;
      doc.moveTo(startX, ly).lineTo(startX + larguraTabela, ly).strokeColor('#1e3a5f').lineWidth(0.5).stroke();
      doc.strokeColor('#000000').fillColor('#000000');
      doc.y = ly + 4;
    };
    drawHeader();

    rows.forEach((row) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        drawHeader();
      }
      const rowY = doc.y;
      let x = startX;
      doc.fontSize(8).font('Helvetica').fillColor('#333333');
      defs.forEach((d) => { doc.text(fmtCell(row[d.key], d), x, rowY, { width: d.w, lineBreak: false }); x += d.w; });
      doc.y = rowY + 13;
    });

    desenharRodapesRelatorio(doc);
    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao exportar PDF' });
  }
});

// Lista condensada de TODOS os imóveis (fichas resumidas, ~uma linha por imóvel)
app.get('/api/relatorios/imoveis/fichas-lista/pdf', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.codigo, i.tipo, i.endereco, i.status, i.dia_vencimento,
             i.valor_com_desconto, i.valor_sem_desconto,
             inq.nome AS inquilino_nome, c.valor AS contrato_valor
      FROM imoveis i
      LEFT JOIN LATERAL (
        SELECT * FROM contratos c2 WHERE c2.imovel_id = i.id AND c2.status = 'ativo'
        ORDER BY c2.id DESC LIMIT 1
      ) c ON true
      LEFT JOIN inquilinos inq ON inq.id = c.inquilino_id
      ORDER BY i.codigo
    `);

    const fmtMoeda = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const tipoLabel = { casa: 'Casa', apartamento: 'Apto', comercial: 'Comercial', terreno: 'Terreno', galpao: 'Galpão' };
    const statusLabel = { alugado: 'Alugado', vago: 'Vago', encerrado: 'Encerrado', negociacao: 'Negociação', manutencao: 'Manutenção' };

    const alugados = rows.filter(r => r.status === 'alugado').length;
    const vagos = rows.filter(r => r.status === 'vago').length;

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=fichas-imoveis-lista-${new Date().toISOString().split('T')[0]}.pdf`);
    doc.pipe(res);

    desenharCabecalhoRelatorio(doc, {
      titulo: 'Fichas dos Imóveis — Lista Resumida',
      periodo: `Emissão consolidada de todos os imóveis`,
      resumo: [
        { label: 'Imóveis', valor: String(rows.length) },
        { label: 'Alugados', valor: String(alugados) },
        { label: 'Vagos', valor: String(vagos) }
      ]
    });

    const defs = [
      { key: 'codigo', label: 'Código', w: 52 },
      { key: 'tipo', label: 'Tipo', w: 58 },
      { key: 'endereco', label: 'Endereço', w: 140 },
      { key: 'status', label: 'Situação', w: 62 },
      { key: 'inquilino_nome', label: 'Inquilino', w: 103 },
      { key: 'aluguel', label: 'Aluguel', w: 60 },
      { key: 'venc', label: 'Venc.', w: 40 }
    ];
    const startX = doc.page.margins.left;
    const larg = defs.reduce((s, d) => s + d.w, 0);
    const drawHead = () => {
      const hy = doc.y; let x = startX;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e3a5f');
      defs.forEach((d) => { doc.text(d.label, x, hy, { width: d.w, lineBreak: false }); x += d.w; });
      const ly = hy + 12;
      doc.moveTo(startX, ly).lineTo(startX + larg, ly).strokeColor('#1e3a5f').lineWidth(0.5).stroke();
      doc.strokeColor('#000000').fillColor('#000000');
      doc.y = ly + 3;
    };
    drawHead();

    rows.forEach((r) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        drawHead();
      }
      const ry = doc.y; let x = startX;
      const aluguel = r.contrato_valor != null ? r.contrato_valor : (r.valor_com_desconto || r.valor_sem_desconto);
      const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
      const valores = {
        codigo: r.codigo,
        tipo: tipoLabel[r.tipo] || r.tipo,
        endereco: trunc(r.endereco || '—', 30),
        status: statusLabel[r.status] || r.status,
        inquilino_nome: trunc(r.inquilino_nome || '—', 22),
        aluguel: fmtMoeda(aluguel),
        venc: `Dia ${r.dia_vencimento}`
      };
      doc.fontSize(8).font('Helvetica').fillColor('#333333');
      defs.forEach((d) => { doc.text(String(valores[d.key] ?? '—'), x, ry, { width: d.w, lineBreak: false }); x += d.w; });
      doc.y = ry + 14;
    });

    desenharRodapesRelatorio(doc);
    doc.end();
  } catch (error) {
    console.error('Erro ao gerar lista de fichas:', error.message);
    res.status(500).json({ error: 'Erro ao gerar lista de fichas' });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', uptime: process.uptime() });
  } catch (e) {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

// ============================================================
// RECIBOS — gerador de recibos avulsos
// ============================================================

// Primeiro número de recibo. Ajuste aqui se quiser continuar de outra
// numeração (ex.: para continuar de 118, defina 118).
const RECIBO_NUMERO_INICIAL = 1;

const FORMAS_RECIBO = {
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  debito: 'Cartão de Débito',
  credito: 'Cartão de Crédito',
  cartao: 'Cartão',
  ted: 'TED',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  cheque: 'Cheque',
  outro: 'Outro'
};

// ---- Valor por extenso (pt-BR) ----
const _ext_unidades = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const _ext_especiais = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const _ext_dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const _ext_centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function _extAte999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const partes = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) partes.push(_ext_centenas[c]);
  if (resto > 0) {
    if (resto < 10) partes.push(_ext_unidades[resto]);
    else if (resto < 20) partes.push(_ext_especiais[resto - 10]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${_ext_dezenas[d]} e ${_ext_unidades[u]}` : _ext_dezenas[d]);
    }
  }
  return partes.join(' e ');
}

function _extInteiro(n) {
  if (n === 0) return 'zero';
  const grupos = [];
  let resto = n;
  while (resto > 0) { grupos.push(resto % 1000); resto = Math.floor(resto / 1000); }
  const escalaSing = ['', 'mil', 'milhão', 'bilhão', 'trilhão'];
  const escalaPlur = ['', 'mil', 'milhões', 'bilhões', 'trilhões'];

  const itens = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g === 0) continue;
    let texto = _extAte999(g);
    if (i === 1) texto = (g === 1) ? 'mil' : `${texto} mil`;
    else if (i >= 2) texto = `${texto} ${g === 1 ? escalaSing[i] : escalaPlur[i]}`;
    itens.push({ idx: i, g, texto });
  }

  let saida = '';
  itens.forEach((it, k) => {
    if (k === 0) { saida = it.texto; return; }
    const liga = it.idx === 0 && (it.g < 100 || it.g % 100 === 0);
    saida += (liga ? ' e ' : ', ') + it.texto;
  });
  return saida;
}

function valorPorExtenso(valorNum) {
  const v = Math.round(Number(valorNum || 0) * 100);
  const reais = Math.floor(v / 100);
  const centavos = v % 100;
  const partes = [];
  if (reais > 0) {
    // milhões/bilhões/trilhões exatos pedem "de reais" (ex.: "dois milhões de reais")
    const usaDe = reais >= 1000000 && reais % 1000000 === 0;
    partes.push(`${_extInteiro(reais)} ${usaDe ? 'de ' : ''}${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos > 0) partes.push(`${_extInteiro(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  if (partes.length === 0) return 'zero real';
  return partes.join(' e ');
}

const _MESES_EXT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const fmtMoedaPdf = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDataPdf = (d) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
const fmtDataExtenso = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getUTCDate()} de ${_MESES_EXT[dt.getUTCMonth()]} de ${dt.getUTCFullYear()}`;
};

// Desenha o recibo no padrão visual (navy + faixa azul + canhoto)
function desenharReciboPDF(doc, r) {
  const M = 40;
  const W = doc.page.width - M * 2;
  const NAVY = '#16233f';
  const BLUE = '#2f63d8';
  const LIGHT = '#f1f4f9';
  const GRAY = '#6b7280';
  const DARK = '#1f2937';

  const numeroFmt = String(r.numero).padStart(4, '0');
  const valorFmt = fmtMoedaPdf(r.valor);
  const dataFmt = fmtDataPdf(r.data_pagamento);
  const formaLabel = FORMAS_RECIBO[r.forma_pagamento] || (r.forma_pagamento || '—');
  const docRec = r.recebedor_documento ? String(r.recebedor_documento) : '';

  // ---- Cabeçalho ----
  let y = M;
  const headerH = 92;
  doc.roundedRect(M, y, W, headerH, 8).fill(NAVY);

  let textX = M + 22;
  // Logo (se houver arquivo de imagem)
  if (r.recebedor_logo_url) {
    const logoPath = path.join(uploadDir, path.basename(r.recebedor_logo_url));
    const ext = path.extname(logoPath).toLowerCase();
    if (fs.existsSync(logoPath) && ['.png', '.jpg', '.jpeg'].includes(ext)) {
      try {
        const logoSize = 58;
        doc.roundedRect(M + 16, y + 17, logoSize, logoSize, 6).fill('#ffffff');
        doc.image(logoPath, M + 19, y + 20, { fit: [logoSize - 6, logoSize - 6], align: 'center', valign: 'center' });
        textX = M + 16 + logoSize + 16;
      } catch (_) { /* ignora logo inválida */ }
    }
  }

  const infoW = W * 0.62;
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(15).text(r.recebedor_nome, textX, y + 16, { width: infoW });
  doc.font('Helvetica').fontSize(8).fillColor('#c7d2e5');
  const linhas = [];
  if (docRec) linhas.push(`CNPJ/CPF: ${docRec}`);
  if (r.recebedor_endereco) linhas.push(r.recebedor_endereco);
  const contato = [];
  if (r.recebedor_telefone) contato.push(`Tel: ${r.recebedor_telefone}`);
  if (r.recebedor_whatsapp) contato.push(`WhatsApp: ${r.recebedor_whatsapp}`);
  if (contato.length) linhas.push(contato.join(' | '));
  if (r.recebedor_email) linhas.push(r.recebedor_email);
  if (r.recebedor_site) linhas.push(r.recebedor_site);
  doc.text(linhas.join('\n'), textX, doc.y + 2, { width: infoW, lineGap: 1 });

  // N° e data (direita)
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff').text(`N° ${numeroFmt}`, M, y + 20, { width: W - 18, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor('#c7d2e5').text(`Data: ${dataFmt}`, M, y + 40, { width: W - 18, align: 'right' });

  // ---- Faixa do título ----
  y += headerH + 10;
  const bandH = 30;
  doc.roundedRect(M, y, W, bandH, 4).fill(BLUE);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13).text('RECIBO DE PAGAMENTO', M, y + 9, { width: W, align: 'center', characterSpacing: 1 });

  // ---- Caixa de valor ----
  y += bandH + 16;
  const valH = 56;
  doc.roundedRect(M, y, W, valH, 6).fill(LIGHT);
  doc.rect(M, y, 5, valH).fill(BLUE);
  doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(9).text('VALOR RECEBIDO', M + 22, y + 21, { characterSpacing: 1 });
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(24).text(`R$ ${valorFmt}`, M, y + 15, { width: W - 22, align: 'right' });

  // ---- Corpo ----
  y += valH + 26;
  doc.fillColor(DARK).font('Helvetica').fontSize(11);
  doc.text('Recebi(emos) de ', M, y, { width: W, continued: true });
  doc.font('Helvetica-Bold').text(r.pagador_nome, { continued: true });
  if (r.pagador_documento) {
    doc.font('Helvetica').text(', inscrito(a) no CPF/CNPJ sob nº ', { continued: true });
    doc.font('Helvetica-Bold').text(String(r.pagador_documento), { continued: true });
  }
  doc.font('Helvetica').text(' a importância de ', { continued: true });
  doc.font('Helvetica-Bold').text(`R$ ${valorFmt} `, { continued: true });
  doc.font('Helvetica-Oblique').text(`(${r.valor_extenso})`, { continued: true });
  doc.font('Helvetica').text(', referente a ', { continued: true });
  doc.font('Helvetica-Bold').text(r.referente, { continued: true });
  doc.font('Helvetica').text('.');

  doc.moveDown(0.7);
  doc.font('Helvetica').fontSize(11).fillColor(DARK).text(
    'Para maior clareza firmo(amos) o presente recibo, dando plena, geral e irrevogável quitação do valor recebido.',
    M, doc.y, { width: W, align: 'left' }
  );

  // ---- Forma e data ----
  y = doc.y + 18;
  const fpH = 48;
  doc.roundedRect(M, y, W, fpH, 6).fill(LIGHT);
  const colW = W / 2;
  doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(8).text('FORMA DE PAGAMENTO', M + 18, y + 12, { characterSpacing: 0.5 });
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(formaLabel, M + 18, y + 25);
  doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(8).text('DATA DO PAGAMENTO', M + colW + 6, y + 12, { characterSpacing: 0.5 });
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text(dataFmt, M + colW + 6, y + 25);

  // ---- Local e data por extenso ----
  y += fpH + 22;
  const local = r.local || 'Brasília';
  doc.fillColor(DARK).font('Helvetica').fontSize(11).text(`${local}, ${fmtDataExtenso(r.data_pagamento)}.`, M, y, { width: W, align: 'right' });

  // ---- Assinatura ----
  y = doc.y + 46;
  const sigW = 280;
  const sigX = M + (W - sigW) / 2;
  doc.moveTo(sigX, y).lineTo(sigX + sigW, y).strokeColor('#9aa3b2').lineWidth(1).stroke();
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(r.recebedor_nome, sigX, y + 6, { width: sigW, align: 'center' });
  if (docRec) doc.fillColor(GRAY).font('Helvetica').fontSize(8).text(`CNPJ/CPF: ${docRec}`, sigX, doc.y + 1, { width: sigW, align: 'center' });

  // ---- Canhoto ----
  if (r.com_canhoto) {
    y = doc.y + 30;
    doc.save();
    doc.dash(3, { space: 3 }).strokeColor('#c0c6d2').lineWidth(1).moveTo(M, y).lineTo(M + W, y).stroke();
    doc.restore();
    // etiqueta "recorte aqui" sobre a linha tracejada
    const tag = 'recorte aqui';
    doc.font('Helvetica').fontSize(8).fillColor(GRAY);
    const tagW = doc.widthOfString(tag) + 12;
    doc.rect(M + 30, y - 6, tagW, 12).fill('#ffffff');
    doc.fillColor(GRAY).text(tag, M + 36, y - 4);

    y += 16;
    const canH = 92;
    doc.roundedRect(M, y, W, canH, 6).strokeColor('#d9deea').lineWidth(1).stroke();
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(`RECIBO N° ${numeroFmt} — VIA / CANHOTO`, M + 16, y + 14);
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(13).text(`R$ ${valorFmt}`, M, y + 12, { width: W - 16, align: 'right' });

    let cy = y + 36;
    doc.fontSize(9);
    doc.fillColor(DARK).font('Helvetica-Bold').text('Pagador: ', M + 16, cy, { continued: true }).font('Helvetica').text(r.pagador_nome);
    cy += 14;
    doc.fillColor(DARK).font('Helvetica-Bold').text('Referente a: ', M + 16, cy, { continued: true }).font('Helvetica').text(r.referente, { width: W - 200 });
    cy += 14;
    doc.fillColor(DARK).font('Helvetica-Bold').text('Forma: ', M + 16, cy, { continued: true }).font('Helvetica').text(`${formaLabel}  ·  `, { continued: true }).font('Helvetica-Bold').text('Data: ', { continued: true }).font('Helvetica').text(dataFmt);
  }

  // ---- Rodapé fixo ----
  const footH = 24;
  const footY = doc.page.height - M - footH;
  doc.roundedRect(M, footY, W, footH, 4).fill(NAVY);
  doc.fillColor('#c7d2e5').font('Helvetica').fontSize(8).text(`${r.recebedor_nome}${docRec ? ' · CNPJ/CPF: ' + docRec : ''}`, M + 12, footY + 8, { width: W * 0.6 });
  doc.fillColor('#c7d2e5').font('Helvetica').fontSize(8).text(`Recibo N° ${numeroFmt} · ${dataFmt}`, M, footY + 8, { width: W - 12, align: 'right' });
}

// ---- Recebedores (CRUD) ----
app.get('/api/recibos/recebedores', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM recibo_recebedores ORDER BY padrao DESC, nome ASC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Erro ao listar recebedores' }); }
});

app.post('/api/recibos/recebedores', authenticateToken, [
  body('nome').trim().notEmpty().withMessage('Nome é obrigatório'),
  body('padrao').optional().isBoolean()
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { nome, documento, endereco, telefone, whatsapp, email, site, logo_url, padrao } = req.body;
    await client.query('BEGIN');
    if (padrao) await client.query('UPDATE recibo_recebedores SET padrao = false WHERE padrao = true');
    const r = await client.query(
      `INSERT INTO recibo_recebedores (nome, documento, endereco, telefone, whatsapp, email, site, logo_url, padrao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [nome, documento || null, endereco || null, telefone || null, whatsapp || null, email || null, site || null, logo_url || null, !!padrao]
    );
    await client.query('COMMIT');
    logAtividade(req.user.id, 'criar', 'recibo_recebedor', r.rows[0].id, nome, req.ip);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erro ao salvar recebedor' });
  } finally { client.release(); }
});

app.put('/api/recibos/recebedores/:id', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('nome').trim().notEmpty()
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { nome, documento, endereco, telefone, whatsapp, email, site, logo_url, padrao } = req.body;
    await client.query('BEGIN');
    if (padrao) await client.query('UPDATE recibo_recebedores SET padrao = false WHERE padrao = true AND id <> $1', [req.params.id]);
    const r = await client.query(
      `UPDATE recibo_recebedores SET nome=$1, documento=$2, endereco=$3, telefone=$4, whatsapp=$5, email=$6, site=$7, logo_url=$8, padrao=$9
       WHERE id=$10 RETURNING *`,
      [nome, documento || null, endereco || null, telefone || null, whatsapp || null, email || null, site || null, logo_url || null, !!padrao, req.params.id]
    );
    await client.query('COMMIT');
    if (r.rows.length === 0) return res.status(404).json({ error: 'Recebedor não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erro ao atualizar recebedor' });
  } finally { client.release(); }
});

app.delete('/api/recibos/recebedores/:id', authenticateToken, [param('id').isInt({ min: 1 })], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM recibo_recebedores WHERE id=$1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Recebedor não encontrado' });
    logAtividade(req.user.id, 'excluir', 'recibo_recebedor', req.params.id, null, req.ip);
    res.json({ message: 'Recebedor excluído' });
  } catch (e) { res.status(500).json({ error: 'Erro ao excluir recebedor' }); }
});

// ---- Pagadores (CRUD) ----
app.get('/api/recibos/pagadores', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM recibo_pagadores ORDER BY nome ASC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Erro ao listar pagadores' }); }
});

app.post('/api/recibos/pagadores', authenticateToken, [
  body('nome').trim().notEmpty().withMessage('Nome é obrigatório')
], validate, async (req, res) => {
  try {
    const { nome, documento } = req.body;
    const r = await pool.query('INSERT INTO recibo_pagadores (nome, documento) VALUES ($1,$2) RETURNING *', [nome, documento || null]);
    logAtividade(req.user.id, 'criar', 'recibo_pagador', r.rows[0].id, nome, req.ip);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erro ao salvar pagador' }); }
});

app.put('/api/recibos/pagadores/:id', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('nome').trim().notEmpty()
], validate, async (req, res) => {
  try {
    const { nome, documento } = req.body;
    const r = await pool.query('UPDATE recibo_pagadores SET nome=$1, documento=$2 WHERE id=$3 RETURNING *', [nome, documento || null, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Pagador não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erro ao atualizar pagador' }); }
});

app.delete('/api/recibos/pagadores/:id', authenticateToken, [param('id').isInt({ min: 1 })], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM recibo_pagadores WHERE id=$1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Pagador não encontrado' });
    res.json({ message: 'Pagador excluído' });
  } catch (e) { res.status(500).json({ error: 'Erro ao excluir pagador' }); }
});

// ---- Upload de logo do recebedor ----
app.post('/api/recibos/logo', authenticateToken, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  const ext = path.extname(req.file.filename).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'A logo deve ser PNG ou JPG' });
  }
  res.status(201).json({ logo_url: req.file.filename, url: `/api/uploads/${req.file.filename}` });
});

// ---- Próximo número de recibo ----
app.get('/api/recibos/proximo-numero', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query('SELECT COALESCE(MAX(numero), $1) AS max FROM recibos', [RECIBO_NUMERO_INICIAL - 1]);
    res.json({ proximo: parseInt(r.rows[0].max, 10) + 1 });
  } catch (e) { res.status(500).json({ error: 'Erro ao obter número' }); }
});

// ---- Listar recibos gerados ----
app.get('/api/recibos', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, numero, recebedor_nome, pagador_nome, valor, forma_pagamento,
             data_pagamento, referente, com_canhoto, created_at
      FROM recibos ORDER BY numero DESC LIMIT 500
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Erro ao listar recibos' }); }
});

// ---- Criar recibo ----
app.post('/api/recibos', authenticateToken, [
  body('valor').isFloat({ gt: 0 }).withMessage('Valor deve ser maior que zero'),
  body('data_pagamento').isISO8601().withMessage('Data inválida'),
  body('referente').trim().notEmpty().withMessage('Informe a que se refere o pagamento'),
  body('forma_pagamento').optional({ values: 'falsy' }).isIn(Object.keys(FORMAS_RECIBO)),
  body('com_canhoto').optional().isBoolean(),
  body('recebedor_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('pagador_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('recebedor_nome').optional({ values: 'falsy' }).trim().notEmpty(),
  body('pagador_nome').optional({ values: 'falsy' }).trim().notEmpty()
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const b = req.body;
    await client.query('BEGIN');

    // Resolve recebedor (cadastrado ou manual)
    let rec = {
      id: null, nome: b.recebedor_nome, documento: b.recebedor_documento || null,
      endereco: b.recebedor_endereco || null, telefone: b.recebedor_telefone || null,
      whatsapp: b.recebedor_whatsapp || null, email: b.recebedor_email || null,
      site: b.recebedor_site || null, logo_url: b.recebedor_logo_url || null
    };
    if (b.recebedor_id) {
      const q = await client.query('SELECT * FROM recibo_recebedores WHERE id=$1', [b.recebedor_id]);
      if (q.rows.length === 0) { await client.query('ROLLBACK'); return res.status(422).json({ error: 'Recebedor não encontrado' }); }
      const x = q.rows[0];
      rec = { id: x.id, nome: x.nome, documento: x.documento, endereco: x.endereco, telefone: x.telefone, whatsapp: x.whatsapp, email: x.email, site: x.site, logo_url: x.logo_url };
    } else if (b.salvar_recebedor && rec.nome) {
      const ins = await client.query(
        `INSERT INTO recibo_recebedores (nome, documento, endereco, telefone, whatsapp, email, site, logo_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [rec.nome, rec.documento, rec.endereco, rec.telefone, rec.whatsapp, rec.email, rec.site, rec.logo_url]
      );
      rec.id = ins.rows[0].id;
    }
    if (!rec.nome) { await client.query('ROLLBACK'); return res.status(422).json({ error: 'Informe quem está recebendo' }); }

    // Resolve pagador (cadastrado ou manual)
    let pag = { id: null, nome: b.pagador_nome, documento: b.pagador_documento || null };
    if (b.pagador_id) {
      const q = await client.query('SELECT * FROM recibo_pagadores WHERE id=$1', [b.pagador_id]);
      if (q.rows.length === 0) { await client.query('ROLLBACK'); return res.status(422).json({ error: 'Pagador não encontrado' }); }
      pag = { id: q.rows[0].id, nome: q.rows[0].nome, documento: q.rows[0].documento };
    } else if (b.salvar_pagador && pag.nome) {
      const ins = await client.query('INSERT INTO recibo_pagadores (nome, documento) VALUES ($1,$2) RETURNING id', [pag.nome, pag.documento]);
      pag.id = ins.rows[0].id;
    }
    if (!pag.nome) { await client.query('ROLLBACK'); return res.status(422).json({ error: 'Informe quem está pagando' }); }

    // Trava de concorrência: serializa a alocação do número entre requisições
    // simultâneas (a trava é liberada automaticamente no COMMIT/ROLLBACK).
    await client.query('SELECT pg_advisory_xact_lock(916273)');
    const numQ = await client.query('SELECT COALESCE(MAX(numero), $1) AS max FROM recibos', [RECIBO_NUMERO_INICIAL - 1]);
    const numero = parseInt(numQ.rows[0].max, 10) + 1;
    const extenso = valorPorExtenso(b.valor);
    const comCanhoto = b.com_canhoto === undefined ? true : !!b.com_canhoto;

    const ins = await client.query(
      `INSERT INTO recibos
        (numero, recebedor_id, pagador_id, recebedor_nome, recebedor_documento, recebedor_endereco,
         recebedor_telefone, recebedor_whatsapp, recebedor_email, recebedor_site, recebedor_logo_url,
         pagador_nome, pagador_documento, valor, valor_extenso, forma_pagamento, data_pagamento,
         referente, local, com_canhoto, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id, numero`,
      [numero, rec.id, pag.id, rec.nome, rec.documento, rec.endereco, rec.telefone, rec.whatsapp,
       rec.email, rec.site, rec.logo_url, pag.nome, pag.documento, b.valor, extenso,
       b.forma_pagamento || null, b.data_pagamento, b.referente, b.local || null, comCanhoto, req.user.id]
    );
    await client.query('COMMIT');
    logAtividade(req.user.id, 'criar', 'recibo', ins.rows[0].id, `Recibo Nº ${numero}`, req.ip);
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erro ao gerar recibo' });
  } finally { client.release(); }
});

// ---- PDF do recibo ----
app.get('/api/recibos/:id/pdf', authenticateToken, [param('id').isInt({ min: 1 })], validate, async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM recibos WHERE id=$1', [req.params.id]);
    if (q.rows.length === 0) return res.status(404).json({ error: 'Recibo não encontrado' });
    const r = q.rows[0];
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=recibo-${String(r.numero).padStart(4, '0')}.pdf`);
    doc.pipe(res);
    desenharReciboPDF(doc, r);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: 'Erro ao gerar PDF do recibo' });
  }
});

// ---- Excluir recibo ----
app.delete('/api/recibos/:id', authenticateToken, [param('id').isInt({ min: 1 })], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM recibos WHERE id=$1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Recibo não encontrado' });
    logAtividade(req.user.id, 'excluir', 'recibo', req.params.id, null, req.ip);
    res.json({ message: 'Recibo excluído' });
  } catch (e) { res.status(500).json({ error: 'Erro ao excluir recibo' }); }
});

// ============================================================
// AGENDA — eventos manuais
// ============================================================
const TIPOS_AGENDA = ['vistoria_entrada', 'vistoria_saida', 'visita', 'manutencao', 'reuniao', 'outro'];

app.get('/api/agenda-eventos', authenticateToken, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.*, i.codigo AS imovel_codigo, i.endereco AS imovel_endereco
      FROM agenda_eventos a
      LEFT JOIN imoveis i ON a.imovel_id = i.id
      ORDER BY a.data ASC, a.hora ASC NULLS FIRST
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Erro ao listar eventos' }); }
});

app.post('/api/agenda-eventos', authenticateToken, [
  body('titulo').trim().notEmpty().withMessage('Título é obrigatório'),
  body('data').isDate().withMessage('Data inválida'),
  body('hora').optional({ values: 'falsy' }).matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage('Hora inválida'),
  body('tipo').optional({ values: 'falsy' }).isIn(TIPOS_AGENDA),
  body('imovel_id').optional({ values: 'falsy' }).isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { titulo, data, hora, tipo, imovel_id, descricao } = req.body;
    const r = await pool.query(
      `INSERT INTO agenda_eventos (titulo, data, hora, tipo, imovel_id, descricao, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [titulo, data, hora || null, tipo || 'outro', imovel_id || null, descricao || null, req.user.id]
    );
    logAtividade(req.user.id, 'criar', 'agenda', r.rows[0].id, titulo, req.ip);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erro ao salvar evento' }); }
});

app.put('/api/agenda-eventos/:id', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('titulo').trim().notEmpty(),
  body('data').isDate(),
  body('hora').optional({ values: 'falsy' }).matches(/^\d{2}:\d{2}(:\d{2})?$/),
  body('tipo').optional({ values: 'falsy' }).isIn(TIPOS_AGENDA),
  body('imovel_id').optional({ values: 'falsy' }).isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { titulo, data, hora, tipo, imovel_id, descricao } = req.body;
    const r = await pool.query(
      `UPDATE agenda_eventos SET titulo=$1, data=$2, hora=$3, tipo=$4, imovel_id=$5, descricao=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [titulo, data, hora || null, tipo || 'outro', imovel_id || null, descricao || null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Evento não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Erro ao atualizar evento' }); }
});

app.delete('/api/agenda-eventos/:id', authenticateToken, [param('id').isInt({ min: 1 })], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM agenda_eventos WHERE id=$1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Evento não encontrado' });
    logAtividade(req.user.id, 'excluir', 'agenda', req.params.id, null, req.ip);
    res.json({ message: 'Evento excluído' });
  } catch (e) { res.status(500).json({ error: 'Erro ao excluir evento' }); }
});

app.get('/', (req, res) => {
  res.json({ name: 'gestao-alugueis-api', version: '2.0.0', status: 'running' });
});

// ============================================================
// ERROR HANDLER GLOBAL
// ============================================================

// 404 para rotas /api desconhecidas
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Captura erros de Multer (arquivo grande, tipo inválido) e outros não tratados
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Arquivo excede o tamanho máximo permitido' });
    }
    return res.status(400).json({ error: `Erro no upload: ${err.message}` });
  }
  if (err && err.message && err.message.includes('Tipo de arquivo')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ============================================================
// SCHEMA INICIAL (cria tabelas/admin no boot — idempotente)
// ============================================================
// Roda o database.sql inteiro no boot. O arquivo é todo idempotente
// (CREATE TABLE IF NOT EXISTS, índices IF NOT EXISTS, inserts ON CONFLICT/
// guardados por NOT EXISTS), então é seguro rodar a cada start. Isso dispensa
// rodar o database.sql manualmente ao subir o banco em produção (Railway etc.).
async function runSchemaInit() {
  try {
    const schemaPath = path.join(__dirname, 'database.sql');
    if (!fs.existsSync(schemaPath)) {
      console.warn('⚠️  database.sql não encontrado — pulando criação de schema.');
      return;
    }
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('✅ Schema verificado/criado');

    // Dados de exemplo só entram se explicitamente pedido (demo/dev). Em
    // produção o sistema sobe LIMPO — sem imóveis/inquilinos fictícios.
    if (process.env.SEED_EXAMPLE_DATA === 'true') {
      const seedPath = path.join(__dirname, 'seed-exemplo.sql');
      if (fs.existsSync(seedPath)) {
        await pool.query(fs.readFileSync(seedPath, 'utf8'));
        console.log('🌱 Dados de exemplo carregados (SEED_EXAMPLE_DATA=true)');
      }
    }
  } catch (err) {
    console.error('⚠️  Erro ao inicializar schema:', err.message);
  }
}

// ============================================================
// MIGRATIONS (rodadas no boot, idempotentes)
// ============================================================
async function runMigrations() {
  try {
    // Adiciona 'manutencao' ao CHECK de imoveis.status
    await pool.query(`
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
    `);
    // Adiciona coluna recorrencia_id em despesas
    await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS recorrencia_id INTEGER`);
    // Índice para busca de série de despesas
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_despesas_recorrencia ON despesas(recorrencia_id)`);
    // FK de integridade referencial para recorrencia_id (bancos existentes)
    await pool.query(`
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
    `);
    // ===== Contas a Pagar (upgrade da tabela despesas) =====
    // Categorias cadastráveis
    await pool.query(`
      CREATE TABLE IF NOT EXISTS despesa_tipos (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(60) UNIQUE NOT NULL,
        nome VARCHAR(120) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      INSERT INTO despesa_tipos (codigo, nome) VALUES
      ('iptu','IPTU'),('condominio','Condomínio'),('agua','Água'),('energia','Energia'),
      ('manutencao','Manutenção'),('seguro','Seguro'),('outros','Outros')
      ON CONFLICT (codigo) DO NOTHING
    `);
    // imovel_id passa a ser opcional
    await pool.query(`ALTER TABLE despesas ALTER COLUMN imovel_id DROP NOT NULL`);
    // Novas colunas de baixa / parcelamento
    await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS data_pagamento DATE`);
    await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS valor_pago DECIMAL(12,2)`);
    await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(30)`);
    await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS juros DECIMAL(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS multa DECIMAL(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS desconto DECIMAL(12,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS parcela_num INTEGER DEFAULT 1`);
    await pool.query(`ALTER TABLE despesas ADD COLUMN IF NOT EXISTS parcela_total INTEGER DEFAULT 1`);
    // Remove o CHECK antigo de tipo (agora aceita categorias customizadas)
    await pool.query(`ALTER TABLE despesas DROP CONSTRAINT IF EXISTS despesas_tipo_check`);
    // Atualiza o CHECK de status para incluir 'parcial'
    await pool.query(`
      DO $$
      BEGIN
        ALTER TABLE despesas DROP CONSTRAINT IF EXISTS despesas_status_check;
        ALTER TABLE despesas ADD CONSTRAINT despesas_status_check
          CHECK (status IN ('pago', 'pendente', 'atrasado', 'parcial'));
      END $$;
    `);

    // Renovação automática anual de contratos
    await pool.query(`ALTER TABLE contratos ADD COLUMN IF NOT EXISTS renovacao_automatica BOOLEAN NOT NULL DEFAULT true`);

    // Pagamentos — encargos no "informar pagamento" (igual Contas a Pagar)
    await pool.query(`ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS juros DECIMAL(10,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS multa DECIMAL(10,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS desconto DECIMAL(10,2) DEFAULT 0`);

    // Agenda — eventos manuais persistidos no banco
    await pool.query(`
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
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_agenda_data ON agenda_eventos(data)`);

    // Tabelas do gerador de recibos (criadas em bancos já existentes)
    await pool.query(`
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
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recibo_pagadores (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        documento VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
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
      )
    `);
    // Índice ÚNICO no número do recibo (evita numeração duplicada).
    // Em try próprio para não abortar as demais migrations caso existam dados legados.
    try {
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_recibos_numero ON recibos(numero)`);
    } catch (e) {
      console.warn('⚠️  Não foi possível criar índice único de recibos.numero:', e.message);
    }
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_recibos_created ON recibos(created_at)`);
    console.log('✅ Migrations aplicadas');
  } catch (err) {
    console.error('⚠️  Erro ao rodar migrations:', err.message);
  }
}

// ============================================================
// INICIAR SERVIDOR
// ============================================================

const server = app.listen(PORT, async () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  await runSchemaInit();
  await runMigrations();
  sincronizarStatusVencidos();
});

// Re-sincroniza status de contratos / pagamentos / despesas vencidos a cada 6h.
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const syncTimer = setInterval(sincronizarStatusVencidos, SYNC_INTERVAL_MS);

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n${signal} recebido. Encerrando servidor...`);
  clearInterval(syncTimer);
  server.close(() => {
    pool.end(() => {
      console.log('Conexões encerradas. Adeus!');
      process.exit(0);
    });
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Rede de segurança: a partir do Node 15, uma Promise rejeitada sem catch
// DERRUBA o processo. Aqui logamos e seguimos — uma falha pontual numa
// requisição não tira o sistema do ar (os dados já commitados estão a salvo
// no Postgres). Erros graves o Railway reinicia sozinho.
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Promise rejeitada sem tratamento:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  Exceção não capturada:', err);
});
