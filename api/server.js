import express from "express";
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";

const app = express();
app.use(helmet());
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: false }));

const limiter = rateLimit({ windowMs: 60_000, max: 100 });
app.use(limiter);

const pool = await mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});

const JWT_SECRET = process.env.JWT_SECRET || "secret";

// --- Auth ---
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const [r] = await pool.query("INSERT INTO users (email, password_hash) VALUES (?,?)", [email, hash]);
  res.json({ id: r.insertId });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.query("SELECT * FROM users WHERE email=?", [email]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

// --- Expansions & Cards ---
app.get("/api/expansions", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM expansions ORDER BY release_date DESC");
  res.json(rows);
});

app.get("/api/cards", async (req, res) => {
  const { q } = req.query;
  let sql = "SELECT * FROM cards";
  const params = [];
  if (q) {
    sql += " WHERE name LIKE ?";
    params.push(`%${q}%`);
  }
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// --- Inventory ---
app.get("/api/inventory", auth, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT i.*, c.name AS card_name FROM inventory i JOIN cards c ON i.card_id=c.id WHERE i.user_id=?",
    [req.userId]
  );
  res.json(rows);
});

app.post("/api/inventory", auth, async (req, res) => {
  const { card_id, count } = req.body;
  await pool.query(
    "INSERT INTO inventory (user_id, card_id, count) VALUES (?,?,?) ON DUPLICATE KEY UPDATE count=count+?",
    [req.userId, card_id, count || 1, count || 1]
  );
  res.json({ ok: true });
});

// --- Decks ---
app.post("/api/decks", auth, async (req, res) => {
  const { name } = req.body;
  const [r] = await pool.query("INSERT INTO decks (user_id, name) VALUES (?,?)", [req.userId, name]);
  res.json({ id: r.insertId });
});

app.get("/api/decks", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM decks WHERE user_id=?", [req.userId]);
  res.json(rows);
});

// --- Auto-build (simple heuristic) ---
app.post("/api/decks/auto-build", auth, async (req, res) => {
  const [cards] = await pool.query(
    "SELECT c.id, c.card_type FROM inventory i JOIN cards c ON i.card_id=c.id WHERE i.user_id=?",
    [req.userId]
  );
  const deck = cards.slice(0, 60);
  const [r] = await pool.query("INSERT INTO decks (user_id, name) VALUES (?,?)", [req.userId, "Auto Deck"]);
  const deckId = r.insertId;
  for (const c of deck) {
    await pool.query("INSERT INTO deck_cards (deck_id, card_id, count) VALUES (?,?,1)", [deckId, c.id]);
  }
  res.json({ deck_id: deckId, cards_added: deck.length });
});

// --- CSV import ---
const upload = multer({ storage: multer.memoryStorage() });
app.post("/api/inventory/import-csv", auth, upload.single("file"), async (req, res) => {
  const content = req.file.buffer.toString("utf8").trim();
  const lines = content.split(/\r?\n/);
  lines.shift(); // header
  let added = 0;
  for (const line of lines) {
    const [set_code, card_number, count] = line.split(",");
    const [rows] = await pool.query(
      "SELECT c.id FROM cards c JOIN expansions e ON c.expansion_id=e.id WHERE e.set_code=? AND c.card_number=?",
      [set_code, card_number]
    );
    if (rows.length) {
      await pool.query(
        "INSERT INTO inventory (user_id, card_id, count) VALUES (?,?,?) ON DUPLICATE KEY UPDATE count=count+?",
        [req.userId, rows[0].id, count, count]
      );
      added++;
    }
  }
  res.json({ added });
});

// --- Health check ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "ptcg-api", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
