# Deploy no Railway — Sistema de Gestão de Aluguéis

Guia passo-a-passo para subir o sistema no [Railway](https://railway.app).

## Arquitetura no Railway

Você vai criar **3 serviços** dentro do mesmo projeto:

1. **PostgreSQL** (plugin oficial do Railway)
2. **Backend** (Node.js/Express) — este repositório, pasta `backend/`
3. **Frontend** (React + Nginx) — este repositório, pasta `frontend/`

---

## 1. Criar o projeto e o banco

1. Login em [railway.app](https://railway.app) → **New Project**.
2. **Add Service → Database → PostgreSQL**.
3. Aguarde o provisionamento. O Railway gera automaticamente a variável `DATABASE_URL`.

> O schema é aplicado automaticamente na **primeira execução do backend** (função `runMigrations()` + script `database.sql` montado pelo `docker-compose`, mas no Railway as migrations rodam no boot via `runMigrations()` em `server.js`). Se quiser popular o schema completo, conecte com `psql` usando o `DATABASE_URL` e rode `backend/database.sql` manualmente uma vez.

---

## 2. Subir o backend

1. **Add Service → GitHub Repo** → selecione este repositório.
2. Em **Settings**:
   - **Root Directory**: `backend`
   - **Build**: Dockerfile (já detectado pelo `railway.toml`)
   - **Healthcheck Path**: `/health` (já configurado)
3. Em **Variables**, adicione:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<rode: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
JWT_EXPIRES_IN=8h
NODE_ENV=production
FRONTEND_URL=https://<seu-frontend>.up.railway.app
DB_POOL_MAX=10
MAX_FILE_SIZE_MB=10
UPLOAD_DIR=/app/uploads
```

> `${{Postgres.DATABASE_URL}}` é uma referência cruzada — o Railway preenche automaticamente. Se nomeou o serviço de outra forma (ex: `db`), use `${{db.DATABASE_URL}}`.

4. **CRÍTICO — Configure o Volume para uploads de PDFs:**
   - **Settings → Volumes → Add Volume**
   - **Mount path**: `/app/uploads`
   - Sem isso, **todos os PDFs de contratos são perdidos a cada deploy**.

5. Deploy. Acompanhe os logs: deve aparecer:
   ```
   🚀 Servidor rodando na porta 8080
   📍 Ambiente: production
   ✅ Migrations aplicadas
   ```

---

## 3. Subir o frontend

1. **Add Service → GitHub Repo** → mesmo repositório.
2. **Settings**:
   - **Root Directory**: `frontend`
   - **Build**: Dockerfile
3. **Variables → Build-time variable:**
   ```
   REACT_APP_API_URL=https://<seu-backend>.up.railway.app/api
   ```
   (Tem que ser build-time porque o React injeta no bundle final.)
4. Deploy. Acesse a URL pública do frontend.

5. **Volte no backend** e atualize `FRONTEND_URL` para a URL real do frontend gerada pelo Railway. Faça redeploy do backend.

---

## 4. Primeiro login

Credenciais default (criadas pelo seed em `database.sql`):

- **Admin**: `admin@sistema.com` / `admin123`
- **Operador**: `operador@sistema.com` / `admin123`

**TROQUE AS SENHAS IMEDIATAMENTE** após o primeiro acesso.

---

## 5. Checklist pós-deploy

- [ ] `https://<backend>/health` retorna `{"status":"ok"}`
- [ ] `https://<backend>/health/db` retorna `{"status":"ok","db":"ok"}`
- [ ] Login funciona no frontend
- [ ] Volume montado em `/app/uploads` (testar upload de PDF + redeploy + verificar se sobrevive)
- [ ] CORS bloqueado para origens não listadas (testar com curl `-H "Origin: https://evil.com"`)
- [ ] Backups automáticos do Postgres ativados (Railway Postgres → Settings → Backups)
- [ ] Senhas default trocadas

---

## 6. Variáveis sensíveis — geração

```bash
# JWT_SECRET (64 bytes hex)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 7. Custos esperados (estimativa)

- **Hobby Plan** ($5/mês de crédito grátis):
  - Postgres ~$2-3/mês (uso leve)
  - Backend Node ~$3-5/mês
  - Frontend Nginx ~$1-2/mês
- **Volume**: $0.25/GB/mês

Total: ~$6-10/mês em uso real. O crédito grátis ($5) cobre testes iniciais.

---

## 8. Problemas comuns

| Problema | Solução |
|---|---|
| `FATAL: JWT_SECRET não definido` | Configure a variável no Railway Variables |
| `FATAL: FRONTEND_URL não definida em produção` | Configure a URL do frontend (pode ser lista separada por vírgula) |
| `CORS bloqueado para origem` | Adicione a URL exata em `FRONTEND_URL` |
| PDFs sumem após redeploy | Volume não foi configurado em `/app/uploads` |
| `connection terminated unexpectedly` | Reduza `DB_POOL_MAX` (tente 5) |
| 503 no `/health/db` mas `/health` OK | Postgres está offline ou travado — verifique métricas do serviço |
