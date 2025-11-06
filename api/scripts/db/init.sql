CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE expansions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  set_code VARCHAR(50) UNIQUE,
  release_date DATE
);

CREATE TABLE cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  expansion_id INT,
  card_number VARCHAR(20),
  card_type ENUM('Pokemon','Trainer','Energy'),
  FOREIGN KEY (expansion_id) REFERENCES expansions(id)
);

CREATE TABLE inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  card_id INT,
  count INT,
  UNIQUE KEY (user_id, card_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE decks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  name VARCHAR(255),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE deck_cards (
  deck_id INT,
  card_id INT,
  count INT,
  PRIMARY KEY (deck_id, card_id),
  FOREIGN KEY (