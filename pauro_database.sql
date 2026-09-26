-- Pellizzola Brothers — PostgreSQL schema (Neon / Railway / Supabase / local).
-- Run once on an empty database. To make yourself admin afterwards:
--   UPDATE users SET role = 'admin' WHERE username = 'your_username';

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

CREATE TABLE files (
    id         SERIAL        PRIMARY KEY,
    user_id    INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hash       VARCHAR(255)  NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_files_user_id ON files(user_id);

-- liked_by_ids: native INT[] so like/unlike are single atomic UPDATEs
CREATE TABLE levels (
    id           SERIAL         PRIMARY KEY,
    name         VARCHAR(200)   NOT NULL,
    description  VARCHAR(1000),
    author       INT            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    downloads    INT            NOT NULL DEFAULT 0,
    likes        INT            NOT NULL DEFAULT 0,
    liked_by_ids INT[]          NOT NULL DEFAULT '{}',
    file_id      INT            NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
    active       BOOLEAN        NOT NULL DEFAULT true,  -- false = apagado (soft delete): só admins enxergam
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_levels_author       ON levels(author);
CREATE INDEX ix_levels_popularity   ON levels(downloads DESC, likes DESC);
CREATE INDEX ix_levels_liked_by_ids ON levels USING GIN(liked_by_ids);

CREATE TABLE comments (
    id         SERIAL        PRIMARY KEY,
    level_id   INT           NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    user_id    INT           NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    content    VARCHAR(500)  NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_comments_level_id ON comments(level_id);
CREATE INDEX ix_comments_user_id  ON comments(user_id);

CREATE TABLE download_history (
    id         SERIAL        PRIMARY KEY,
    user_id    INT           NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    level_id   INT           NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, level_id)
);
CREATE INDEX ix_dl_history_user ON download_history(user_id);

CREATE TABLE like_history (
    id         SERIAL        PRIMARY KEY,
    user_id    INT           NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    level_id   INT           NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, level_id)
);
CREATE INDEX ix_like_history_created ON like_history(created_at);

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
CREATE INDEX ix_reports_level_id ON reports(level_id);
CREATE INDEX ix_reports_status   ON reports(status);

CREATE TABLE settings (
    key   VARCHAR(50)  PRIMARY KEY,
    value BOOLEAN      NOT NULL
);
INSERT INTO settings (key, value) VALUES
    ('maintenance_mode',   false),
    ('allow_registration', true),
    ('allow_upload',       true);

CREATE TABLE admin_logs (
    id         SERIAL        PRIMARY KEY,
    admin_id   INT           REFERENCES users(id) ON DELETE SET NULL,
    admin_name VARCHAR(100)  NOT NULL,
    icon       VARCHAR(10)   NOT NULL,
    text       TEXT          NOT NULL,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_admin_logs_created ON admin_logs(created_at DESC);

CREATE TABLE login_attempts (
    username     VARCHAR(100) PRIMARY KEY,
    fail_count   INT          NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
