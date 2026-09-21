-- ============================================================
-- BANCO DE DADOS: pauro  (versão 6 — PostgreSQL puro)
--
-- Compatível com Neon / Railway / Supabase / qualquer Postgres.
-- Execute inteiro numa instância limpa.
-- Para bancos já existentes na v5, use a seção MIGRAÇÃO no final.
-- ============================================================

-- ── Drop (ordem inversa das FK) ─────────────────────────────
DROP TABLE IF EXISTS download_history CASCADE;
DROP TABLE IF EXISTS comments         CASCADE;
DROP TABLE IF EXISTS levels           CASCADE;
DROP TABLE IF EXISTS files            CASCADE;
DROP TABLE IF EXISTS users            CASCADE;

-- ── users ────────────────────────────────────────────────────
CREATE TABLE users (
    id                SERIAL        PRIMARY KEY,
    username          VARCHAR(100)  NOT NULL UNIQUE,
    bio               VARCHAR(500),
    password_hash     VARCHAR(255),
    downloaded_levels INT           NOT NULL DEFAULT 0,
    liked_levels      INT           NOT NULL DEFAULT 0,
    recovery_code     VARCHAR(255),
    recovery_expires  TIMESTAMPTZ,
    role              VARCHAR(20)   NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    banned            BOOLEAN       NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── files ────────────────────────────────────────────────────
CREATE TABLE files (
    id         SERIAL        PRIMARY KEY,
    user_id    INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hash       VARCHAR(255)  NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IX_files_user_id ON files(user_id);

-- ── levels ───────────────────────────────────────────────────
-- liked_by_ids: array de INT nativo do PostgreSQL (atômico, sem race condition)
-- liked_by (TEXT CSV) foi removido — use liked_by_ids
CREATE TABLE levels (
    id           SERIAL         PRIMARY KEY,
    name         VARCHAR(200)   NOT NULL,
    description  VARCHAR(1000),
    author       INT            NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    downloads    INT            NOT NULL DEFAULT 0,
    likes        INT            NOT NULL DEFAULT 0,
    liked_by_ids INT[]          NOT NULL DEFAULT '{}',
    file_id      INT            NOT NULL REFERENCES files(id)  ON DELETE RESTRICT,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IX_levels_author       ON levels(author);
CREATE INDEX IX_levels_popularidade ON levels(downloads DESC, likes DESC);
-- Index GIN permite checar "userId IN liked_by_ids" de forma eficiente
CREATE INDEX IX_levels_liked_by_ids ON levels USING GIN(liked_by_ids);

-- ── comments ─────────────────────────────────────────────────
CREATE TABLE comments (
    id         SERIAL        PRIMARY KEY,
    level_id   INT           NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    user_id    INT           NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    content    VARCHAR(500)  NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IX_comments_level_id ON comments(level_id);
CREATE INDEX IX_comments_user_id  ON comments(user_id);

-- ── download_history ─────────────────────────────────────────
CREATE TABLE download_history (
    id         SERIAL        PRIMARY KEY,
    user_id    INT           NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    level_id   INT           NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, level_id)
);
CREATE INDEX IX_dl_history_user ON download_history(user_id);

-- ── reports ──────────────────────────────────────────────────
CREATE TABLE reports (
    id         SERIAL        PRIMARY KEY,
    level_id   INT           NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    user_id    INT           NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    reason     VARCHAR(100)  NOT NULL,
    detail     VARCHAR(300),
    status     VARCHAR(20)   NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (level_id, user_id)
);
CREATE INDEX IX_reports_level_id ON reports(level_id);
CREATE INDEX IX_reports_status   ON reports(status);

-- ── like_history ─────────────────────────────────────────────
-- Espelha download_history, mas para curtidas — existe só para dar
-- ao painel admin um gráfico real de curtidas por dia (não estimado).
CREATE TABLE like_history (
    id         SERIAL        PRIMARY KEY,
    user_id    INT           NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    level_id   INT           NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, level_id)
);
CREATE INDEX IX_like_history_created ON like_history(created_at);

-- ── settings ─────────────────────────────────────────────────
-- Flags globais da plataforma, editáveis no painel admin.
CREATE TABLE settings (
    key   VARCHAR(50)  PRIMARY KEY,
    value BOOLEAN      NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('maintenance_mode',    false),
  ('allow_registration',  true),
  ('allow_upload',        true)
ON CONFLICT (key) DO NOTHING;

-- ── admin_logs ───────────────────────────────────────────────
-- Histórico de ações administrativas, mostrado na aba "Logs" do painel.
CREATE TABLE admin_logs (
    id         SERIAL        PRIMARY KEY,
    admin_id   INT           REFERENCES users(id) ON DELETE SET NULL,
    admin_name VARCHAR(100)  NOT NULL,
    icon       VARCHAR(10)   NOT NULL,
    text       TEXT          NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IX_admin_logs_created ON admin_logs(created_at DESC);

-- ── login_attempts ───────────────────────────────────────────
-- Defesa contra força bruta: contador de erros + bloqueio progressivo por username.
CREATE TABLE login_attempts (
    username     VARCHAR(100) PRIMARY KEY,
    fail_count   INT          NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Seed ─────────────────────────────────────────────────────
INSERT INTO users (username, bio, downloaded_levels, liked_levels)
VALUES
  ('xx_poste_xx',   'Viva Jesus',                    11, 9),
  ('jacobomassola', NULL,                              0, 0),
  ('billyshears',   'The one and only Billy Shears!',  0, 0)
ON CONFLICT (username) DO NOTHING;

INSERT INTO files (user_id, hash)
VALUES
  (1, 'seed-file-a1b2c3d4'),
  (1, 'seed-file-b2c3d4e5'),
  (2, 'seed-file-c3d4e5f6')
ON CONFLICT DO NOTHING;

INSERT INTO levels (name, description, author, downloads, likes, liked_by_ids, file_id)
VALUES
  ('Meu Level Bacana',   'Bacanices Bananas',      1, 11, 10, ARRAY[2,3], 1),
  ('Meu Level Bacana 2', 'Os dentes de Berenice',  1, 11,  9, ARRAY[3],   2),
  ('A Extraordinaria Jornada de Henrique',
   'I have a feeling this album will become a classic.', 3, 0, 0, '{}', 3)
ON CONFLICT DO NOTHING;

-- ============================================================
-- MIGRAÇÃO v5 → v6 (banco já existente)
-- Execute apenas se o banco já tiver dados na v5.
-- ============================================================
/*
-- 1. Adiciona coluna nova
ALTER TABLE levels ADD COLUMN IF NOT EXISTS liked_by_ids INT[] NOT NULL DEFAULT '{}';

-- 2. Converte CSV existente para array
UPDATE levels
SET liked_by_ids = (
  SELECT ARRAY(
    SELECT NULLIF(trim(x), '')::int
    FROM unnest(string_to_array(liked_by, ',')) AS x
    WHERE NULLIF(trim(x), '') IS NOT NULL
  )
)
WHERE liked_by IS NOT NULL AND liked_by <> '';

-- 3. Cria index GIN
CREATE INDEX IF NOT EXISTS IX_levels_liked_by_ids ON levels USING GIN(liked_by_ids);

-- 4. Remove coluna antiga (confirme backup antes!)
ALTER TABLE levels DROP COLUMN IF EXISTS liked_by;
*/

-- ============================================================
-- MIGRAÇÃO v6 → v6.1 (banco v6 já existente)
-- Adiciona suporte a recuperação de senha e denúncias.
-- ============================================================
/*
-- Recuperação de senha
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code    VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_expires TIMESTAMPTZ;

-- Tabela de denúncias
CREATE TABLE IF NOT EXISTS reports (
    id         SERIAL        PRIMARY KEY,
    level_id   INT           NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    user_id    INT           NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    reason     VARCHAR(100)  NOT NULL,
    detail     VARCHAR(300),
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (level_id, user_id)
);
CREATE INDEX IF NOT EXISTS IX_reports_level_id ON reports(level_id);
*/

-- ============================================================
-- MIGRAÇÃO v6.1 → v6.2 (banco v6.1 já existente)
-- Adiciona papel de admin, banimento, status de denúncia,
-- histórico de curtidas, configurações e logs administrativos.
-- Necessária para o painel /admin.html funcionar de verdade.
-- ============================================================
-- Execute o bloco inteiro (remova os comentários /* */ abaixo):
/*
ALTER TABLE users ADD COLUMN IF NOT EXISTS role       VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned     BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','admin'));

ALTER TABLE reports ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';
ALTER TABLE reports ADD CONSTRAINT reports_status_check CHECK (status IN ('open','closed'));
CREATE INDEX IF NOT EXISTS IX_reports_status ON reports(status);

CREATE TABLE IF NOT EXISTS like_history (
    id         SERIAL        PRIMARY KEY,
    user_id    INT           NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    level_id   INT           NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, level_id)
);
CREATE INDEX IF NOT EXISTS IX_like_history_created ON like_history(created_at);

CREATE TABLE IF NOT EXISTS settings (
    key   VARCHAR(50)  PRIMARY KEY,
    value BOOLEAN      NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('maintenance_mode',   false),
  ('allow_registration', true),
  ('allow_upload',       true)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_logs (
    id         SERIAL        PRIMARY KEY,
    admin_id   INT           REFERENCES users(id) ON DELETE SET NULL,
    admin_name VARCHAR(100)  NOT NULL,
    icon       VARCHAR(10)   NOT NULL,
    text       TEXT          NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS IX_admin_logs_created ON admin_logs(created_at DESC);

-- IMPORTANTE: promova sua própria conta a admin depois de rodar isto
-- (troque 'seu_usuario' pelo seu username de login):
-- UPDATE users SET role = 'admin' WHERE username = 'seu_usuario';
*/

-- ============================================================
-- MIGRAÇÃO v6.2 → v6.3
-- Defesa contra força bruta no login: CAPTCHA + bloqueio progressivo.
-- ============================================================
-- Execute o bloco inteiro (remova os comentários /* */ abaixo):
/*
CREATE TABLE IF NOT EXISTS login_attempts (
    username     VARCHAR(100) PRIMARY KEY,
    fail_count   INT          NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
*/
