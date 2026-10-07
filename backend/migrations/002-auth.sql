CREATE TABLE users (id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, enabled boolean NOT NULL DEFAULT true);
CREATE TABLE memberships (user_id uuid REFERENCES users(id), warehouse text NOT NULL, role text NOT NULL CHECK(role IN ('Staff','Admin','Head')), PRIMARY KEY(user_id,warehouse));
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_attempts (key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL);
