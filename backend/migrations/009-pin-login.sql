CREATE TABLE user_pins (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pin_hash text NOT NULL CHECK (pin_hash ~ '^[a-f0-9]{32}:[a-f0-9]{128}$')
);