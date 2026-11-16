CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  whatsapp TEXT,
  farm_name TEXT NOT NULL DEFAULT 'Pemilik Lahan',
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
