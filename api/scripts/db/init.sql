-- create schema for PostgreSQL (run in your Render DB)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expansions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  series VARCHAR(255),
  set_code VARCHAR(50) UNIQUE,
  release_date DATE,
  total_cards INT,
  official_url TEXT
);

CREATE TABLE IF NOT EXISTS cards (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  expansion_id INT REFERENCES expansions(id) ON DELETE SET NULL,
  card_number VARCHAR(20),
  rarity VARCHAR(50),
  card_type VARCHAR(20) NOT NULL,
  subtype VARCHAR(100),
  hp INT,
  retreat_cost INT,
  weakness VARCHAR(50),
  resistance VARCHAR(50),
  illustrator VARCHAR(255),
  image_url TEXT,
  legal_standard BOOLEAN DEFAULT TRUE,
  legal_expanded BOOLEAN DEFAULT TRUE,
  is_basic_energy BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS pokemon_attacks (
  id SERIAL PRIMARY KEY,
  card_id INT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  attack_name VARCHAR(100) NOT NULL,
  cost TEXT,
  damage VARCHAR(50),
  effect TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id INT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  condition VARCHAR(50) DEFAULT 'NearMint',
  count INT NOT NULL DEFAULT 1,
  foil BOOLEAN DEFAULT FALSE,
  storage_location VARCHAR(255),
  date_added TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, card_id)
);

CREATE TABLE IF NOT EXISTS decks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  format VARCHAR(50) DEFAULT 'Standard',
  archetype VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id INT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  count INT NOT NULL,
  PRIMARY KEY (deck_id, card_id)
);

CREATE TABLE IF NOT EXISTS meta_stats (
  card_id INT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  times_in_decks INT DEFAULT 0,
  top8_count INT DEFAULT 0,
  meta_win_rate REAL DEFAULT 0,
  last_seen_date DATE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards (name);
CREATE INDEX IF NOT EXISTS idx_cards_expansion ON cards (expansion_id);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory (user_id);
CREATE INDEX IF NOT EXISTS idx_deck_user ON decks (user_id);
