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

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'gestao_alugueis',
  password: process.env.DB_PASSWORD || 'postgres',
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

// ============================================================
// UPLOAD DE ARQUIVOS
// ============================================================

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

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
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Tipo de arquivo não permitido. Use PDF, JPG ou PNG.'));
  }
});

app.use('/uploads', express.static(uploadDir));

// ============================================================
// AUTENTICAÇÃO E AUTORIZAÇÃO
// ============================================================

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.warn('⚠️  JWT_SECRET não definido ou muito curto. Use uma string forte em produção!');
}

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  jwt.verify(token, JWT_SECRET || 'secretkey_dev_only', (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido ou expirado' });
    req.user = user;
    next();
  });
};

const authorizeAdmin = (req, res, next) => {
  if (req.user.perfil !== 'admin') {
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
// AUTENTICAÇÃO
// ============================================================

app.post('/api/auth/login', loginLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('senha').isLength({ min: 3 })
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
      JWT_SECRET || 'secretkey_dev_only',
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
  body('status').isIn(['ativo', 'inativo'])
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, email, senha, perfil, status } = req.body;

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

    const existe = await pool.query('SELECT id FROM inquilinos WHERE cpf_cnpj=$1', [cpf_cnpj]);
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

    const result = await pool.query(
      'UPDATE inquilinos SET nome=$1, cpf_cnpj=$2, telefone=$3, email=$4, endereco=$5, observacoes=$6, updated_at=NOW() WHERE id=$7 RETURNING *',
      [nome, cpf_cnpj, telefone, email || null, endereco, observacoes, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Inquilino não encontrado' });

    await logAtividade(req.user.id, 'editar_inquilino', 'inquilinos', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.delete('/api/inquilinos/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;

    const contratos = await pool.query(
      "SELECT id FROM contratos WHERE inquilino_id=$1 AND status='ativo'", [id]
    );
    if (contratos.rows.length > 0) {
      return res.status(400).json({ error: 'Inquilino possui contratos ativos. Encerre os contratos antes de excluir.' });
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
  body('status').isIn(['alugado', 'vago', 'encerrado', 'negociacao'])
], validate, async (req, res) => {
  try {
    const {
      codigo, tipo, endereco, valor_com_desconto, valor_sem_desconto,
      dia_vencimento, status, numero_iptu, matricula, conta_agua, conta_energia, observacoes
    } = req.body;

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
  body('status').isIn(['alugado', 'vago', 'encerrado', 'negociacao'])
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      codigo, tipo, endereco, valor_com_desconto, valor_sem_desconto,
      dia_vencimento, status, numero_iptu, matricula, conta_agua, conta_energia, observacoes
    } = req.body;

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
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.delete('/api/imoveis/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;

    const contratos = await pool.query(
      "SELECT id FROM contratos WHERE imovel_id=$1 AND status='ativo'", [id]
    );
    if (contratos.rows.length > 0) {
      return res.status(400).json({ error: 'Imóvel possui contratos ativos. Encerre os contratos antes de excluir.' });
    }

    const result = await pool.query('DELETE FROM imoveis WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Imóvel não encontrado' });

    await logAtividade(req.user.id, 'excluir_imovel', 'imoveis', parseInt(id), null, req.ip);
    res.json({ message: 'Imóvel excluído com sucesso' });
  } catch (error) {
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
    if (imovel_id) {
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

    if (status === 'ativo') {
      const contratoAtivo = await pool.query(
        "SELECT id FROM contratos WHERE imovel_id=$1 AND status='ativo'", [imovel_id]
      );
      if (contratoAtivo.rows.length > 0) {
        return res.status(400).json({ error: 'Este imóvel já possui um contrato ativo. Encerre o contrato atual antes de criar um novo.' });
      }
    }

    const result = await pool.query(
      `INSERT INTO contratos (imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status, arquivo_pdf, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status, arquivo_pdf, observacoes]
    );

    if (status === 'ativo') {
      await pool.query("UPDATE imoveis SET status='alugado' WHERE id=$1", [imovel_id]);
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

    const arquivo_pdf = req.file ? req.file.filename : contrato.rows[0].arquivo_pdf;

    const contratoAntes = contrato.rows[0];

    const result = await pool.query(
      `UPDATE contratos SET imovel_id=$1, inquilino_id=$2, data_inicio=$3, data_fim=$4,
        valor=$5, garantia=$6, status=$7, arquivo_pdf=$8, observacoes=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [imovel_id, inquilino_id, data_inicio, data_fim, valor, garantia, status, arquivo_pdf, observacoes, id]
    );

    // Sincroniza status do imóvel quando o status do contrato muda
    if (contratoAntes.status !== status) {
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
    const result = await pool.query('DELETE FROM contratos WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Contrato não encontrado' });

    await logAtividade(req.user.id, 'excluir_contrato', 'contratos', parseInt(id), null, req.ip);
    res.json({ message: 'Contrato excluído com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ============================================================
// PAGAMENTOS
// ============================================================

app.get('/api/pagamentos', authenticateToken, async (req, res) => {
  try {
    const { mes, ano, imovel_id, status, busca } = req.query;
    let queryStr = `
      SELECT p.*, i.codigo as imovel_codigo, i.endereco as imovel_endereco,
             inq.nome as inquilino_nome, inq.telefone as inquilino_telefone
      FROM pagamentos p
      LEFT JOIN imoveis i ON p.imovel_id = i.id
      LEFT JOIN contratos c ON c.id = p.contrato_id
      LEFT JOIN inquilinos inq ON c.inquilino_id = inq.id
    `;
    const params = [];
    const conditions = [];

    if (mes) { params.push(mes); conditions.push(`p.mes = $${params.length}`); }
    if (ano) { params.push(ano); conditions.push(`p.ano = $${params.length}`); }
    if (imovel_id) { params.push(imovel_id); conditions.push(`p.imovel_id = $${params.length}`); }
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
    doc.text(`Valor Recebido: R$ ${parseFloat(p.valor_recebido || 0).toFixed(2)}`);
    doc.text(`Data do Pagamento: ${p.data_pagamento ? new Date(p.data_pagamento).toLocaleDateString('pt-BR') : 'N/A'}`);
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

    if (imovel_id) { params.push(imovel_id); conditions.push(`d.imovel_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`d.status = $${params.length}`); }
    if (tipo) { params.push(tipo); conditions.push(`d.tipo = $${params.length}`); }
    if (mes) { params.push(mes); conditions.push(`EXTRACT(MONTH FROM d.vencimento) = $${params.length}`); }
    if (ano) { params.push(ano); conditions.push(`EXTRACT(YEAR FROM d.vencimento) = $${params.length}`); }

    if (conditions.length > 0) queryStr += ' WHERE ' + conditions.join(' AND ');
    queryStr += ' ORDER BY d.vencimento DESC';

    const result = await pool.query(queryStr, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/despesas', authenticateToken, [
  body('imovel_id').isInt({ min: 1 }),
  body('tipo').isIn(['iptu', 'condominio', 'agua', 'energia', 'manutencao', 'seguro', 'outros']),
  body('valor').isFloat({ min: 0 }),
  body('vencimento').isDate(),
  body('status').isIn(['pago', 'pendente', 'atrasado'])
], validate, async (req, res) => {
  try {
    const { imovel_id, tipo, valor, vencimento, status, descricao, observacoes } = req.body;

    const result = await pool.query(
      'INSERT INTO despesas (imovel_id, tipo, valor, vencimento, status, descricao, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [imovel_id, tipo, valor, vencimento, status, descricao, observacoes]
    );

    await logAtividade(req.user.id, 'criar_despesa', 'despesas', result.rows[0].id, tipo, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.put('/api/despesas/:id', authenticateToken, [
  param('id').isInt({ min: 1 }),
  body('imovel_id').isInt({ min: 1 }),
  body('tipo').isIn(['iptu', 'condominio', 'agua', 'energia', 'manutencao', 'seguro', 'outros']),
  body('valor').isFloat({ min: 0 }),
  body('vencimento').isDate(),
  body('status').isIn(['pago', 'pendente', 'atrasado'])
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { imovel_id, tipo, valor, vencimento, status, descricao, observacoes } = req.body;

    const result = await pool.query(
      `UPDATE despesas SET imovel_id=$1, tipo=$2, valor=$3, vencimento=$4, status=$5,
        descricao=$6, observacoes=$7, updated_at=NOW() WHERE id=$8 RETURNING *`,
      [imovel_id, tipo, valor, vencimento, status, descricao, observacoes, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Despesa não encontrada' });

    await logAtividade(req.user.id, 'editar_despesa', 'despesas', parseInt(id), null, req.ip);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.delete('/api/despesas/:id', authenticateToken, authorizeAdmin, [
  param('id').isInt({ min: 1 })
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM despesas WHERE id=$1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Despesa não encontrada' });

    await logAtividade(req.user.id, 'excluir_despesa', 'despesas', parseInt(id), null, req.ip);
    res.json({ message: 'Despesa excluída com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
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
  body('novo_valor').isFloat({ min: 0 }),
  body('status').isIn(['pendente', 'avisado', 'aplicado'])
], validate, async (req, res) => {
  try {
    const { imovel_id, contrato_id, valor_atual, data_ultimo, data_proximo, percentual, novo_valor, status, observacoes } = req.body;

    const result = await pool.query(
      `INSERT INTO reajustes (imovel_id, contrato_id, valor_atual, data_ultimo, data_proximo, percentual, novo_valor, status, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [imovel_id, contrato_id || null, valor_atual, data_ultimo || null, data_proximo, percentual, novo_valor, status, observacoes]
    );

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
  body('novo_valor').isFloat({ min: 0 }),
  body('status').isIn(['pendente', 'avisado', 'aplicado'])
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { imovel_id, contrato_id, valor_atual, data_ultimo, data_proximo, percentual, novo_valor, status, observacoes } = req.body;

    const result = await pool.query(
      `UPDATE reajustes SET imovel_id=$1, contrato_id=$2, valor_atual=$3, data_ultimo=$4,
        data_proximo=$5, percentual=$6, novo_valor=$7, status=$8, observacoes=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [imovel_id, contrato_id || null, valor_atual, data_ultimo || null, data_proximo, percentual, novo_valor, status, observacoes, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Reajuste não encontrado' });

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
      totalImoveis, imoveisPorStatus, pagamentosMes,
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
      totalReceber,
      totalRecebido,
      valorAberto: totalReceber - totalRecebido,
      alugueisAtrasados: parseInt(pagamentosMes.rows[0]?.total_atrasados || 0),
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
app.get('/api/relatorios/mensal', authenticateToken, async (req, res) => {
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
app.get('/api/relatorios/contratos-vencendo', authenticateToken, async (req, res) => {
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
app.get('/api/relatorios/despesas', authenticateToken, async (req, res) => {
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

      const ws = workbook.addWorksheet(`Aluguéis ${mes}/${ano}`);
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
      ws.getRow(1).font = { bold: true };
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
        SELECT i.codigo, i.endereco, inq.nome as inquilino, p.valor_aluguel, p.status
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
      const result = await pool.query("SELECT * FROM imoveis WHERE status IN ('vago','negociacao') ORDER BY codigo");
      rows = result.rows;
      titulo = 'Relatório de Imóveis Vagos';
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-${tipo}-${Date.now()}.pdf`);
    doc.pipe(res);

    doc.fontSize(16).fillColor('#1e3a5f').text(titulo, { align: 'center' });
    doc.fontSize(10).fillColor('#666').text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'center' });
    doc.moveDown();

    rows.forEach((row, i) => {
      if (i > 0 && i % 25 === 0) doc.addPage();
      const bg = i % 2 === 0 ? '#f8f9fa' : '#ffffff';
      doc.fontSize(9).fillColor('#333');
      const line = Object.values(row).slice(0, 6).map(v => String(v || '')).join(' | ');
      doc.text(line, 40, doc.y, { width: 760 });
    });

    doc.end();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao exportar PDF' });
  }
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
