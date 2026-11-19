ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

UPDATE users
SET role = 'admin'
WHERE LOWER(email) = 'fnaandd44@gmail.com'
   OR LOWER(username) = 'fnaandd44';
