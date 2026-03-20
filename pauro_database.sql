-- ============================================================
-- BANCO DE DADOS: pauro  (versão 4 — liked_by como VARCHAR)
-- SGBD: SQL Server (T-SQL)
--
-- liked_by: string de IDs separados por vírgula, ex: "1,3,7"
-- likes: contador derivado do tamanho de liked_by (mantido por
--        conveniência de ordenação/índice)
-- ============================================================

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'pauro')
BEGIN
    CREATE DATABASE pauro;
END
GO

USE pauro;
GO

-- Ordem de drop: inversa das dependências
IF OBJECT_ID('dbo.levels', 'U') IS NOT NULL DROP TABLE dbo.levels;
GO
IF OBJECT_ID('dbo.files',  'U') IS NOT NULL DROP TABLE dbo.files;
GO
IF OBJECT_ID('dbo.users',  'U') IS NOT NULL DROP TABLE dbo.users;
GO

-- users
CREATE TABLE dbo.users (
    id                INT           NOT NULL IDENTITY(1,1),
    username          VARCHAR(100)  NOT NULL,
    bio               VARCHAR(500)  NULL,
    password_hash     VARCHAR(64)   NULL,
    downloaded_levels INT           NOT NULL DEFAULT 0,
    liked_levels      INT           NOT NULL DEFAULT 0,

    CONSTRAINT PK_users          PRIMARY KEY (id),
    CONSTRAINT UQ_users_username UNIQUE      (username)
);
GO

-- files
CREATE TABLE dbo.files (
    id         INT           NOT NULL IDENTITY(1,1),
    user_id    INT           NOT NULL,
    hash       VARCHAR(255)  NOT NULL,
    created_at DATETIME2     NOT NULL DEFAULT SYSDATETIME(),

    CONSTRAINT PK_files       PRIMARY KEY (id),
    CONSTRAINT FK_files_users FOREIGN KEY (user_id) REFERENCES dbo.users (id)
);
GO

-- levels — liked_by guarda os IDs dos usuários que curtiram,
--          separados por vírgula: '' (vazio) = nenhum like ainda
CREATE TABLE dbo.levels (
    id          INT            NOT NULL IDENTITY(1,1),
    name        VARCHAR(200)   NOT NULL,
    description VARCHAR(1000)  NULL,
    author      INT            NOT NULL,
    downloads   INT            NOT NULL DEFAULT 0,
    likes       INT            NOT NULL DEFAULT 0,
    liked_by    VARCHAR(MAX)   NOT NULL DEFAULT '',   -- ex: '1,3,7'
    file_id     INT            NOT NULL,

    CONSTRAINT PK_levels        PRIMARY KEY (id),
    CONSTRAINT FK_levels_author FOREIGN KEY (author)  REFERENCES dbo.users (id),
    CONSTRAINT FK_levels_file   FOREIGN KEY (file_id) REFERENCES dbo.files (id)
);
GO

-- Índices
CREATE NONCLUSTERED INDEX IX_levels_author       ON dbo.levels (author);
CREATE NONCLUSTERED INDEX IX_files_user_id       ON dbo.files  (user_id);
CREATE NONCLUSTERED INDEX IX_levels_popularidade ON dbo.levels (downloads DESC, likes DESC);
GO

-- Seed
IF NOT EXISTS (SELECT 1 FROM dbo.users)
BEGIN
    INSERT INTO dbo.users (username, bio, downloaded_levels, liked_levels)
    VALUES
        ('xx_poste_xx',   'Viva Jesus',                    11, 9),
        ('JacaboMassola', NULL,                              0, 0),
        ('BillyShears',   'The one and only Billy Shears!',  0, 0);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.files)
BEGIN
    INSERT INTO dbo.files (user_id, hash)
    VALUES
        (1, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'),
        (1, 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5'),
        (2, 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6');
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.levels)
BEGIN
    INSERT INTO dbo.levels (name, description, author, downloads, likes, liked_by, file_id)
    VALUES
        ('Meu Nivel Bacana',   'Bacanices Bananas',      1, 11, 10, '2,3', 1),
        ('Meu Nivel Bacana 2', 'Os dentes de Berenice',  1, 11,  9, '3',   2),
        ('A Extraordinaria Jornada de Henrique',
         'I have a feeling this album will become a classic.', 3, 0, 0, '', 3);
END
GO
