import express from "express";
import pkg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";

const { Pool } = pkg;

const app = express();
app.use(helmet());
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: false }));
app.use(rateLimit({ windowMs: 60_000, max: 100 }));

// Use DATABASE_URL provided by Render or fallback to individual vars
const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION;
const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || "change_this_long_secret";

// Helper: query wrapper
async function q(text, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// --- Authentication ---
app.post("/api/register", async (req, res) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: "email and password required" });
    const hash = await bcrypt.hash(password, 10);
    const result = await q(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id`,
      [email, hash, display_name || null]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "email already exists" });
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await q("SELECT id, password_hash, display_name FROM users WHERE email=$1", [email]);
    if (!result.rowCount) return res.status(401).json({ error: "Invalid credentials" });
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, display_name: user.display_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// --- Expansions & Cards ---
app.get("/api/expansions", async (req, res) => {
  const r = await q("SELECT * FROM expansions ORDER BY release_date DESC");
  res.json(r.rows);
});

app.post("/api/expansions", auth, async (req, res) => {
  const { name, series, set_code, release_date, total_cards, official_url } = req.body;
  const r = await q(
    `INSERT INTO expansions (name, series, set_code, release_date, total_cards, official_url)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [name, series, set_code, release_date || null, total_cards || null, official_url || null]
  );
  res.json({ id: r.rows[0].id });
});

app.get("/api/cards", async (req, res) => {
  const { q: search } = req.query;
  if (search) {
    const r = await q("SELECT * FROM cards WHERE name ILIKE $1 ORDER BY name LIMIT 200", [`%${search}%`]);
    return res.json(r.rows);
  }
  const r = await q("SELECT * FROM cards ORDER BY name LIMIT 500");
  res.json(r.rows);
});

app.post("/api/cards", auth, async (req, res) => {
  const {
    name, expansion_id, card_number, rarity, card_type, subtype, hp,
    retreat_cost, weakness, resistance, illustrator, image_url,
    legal_standard, legal_expanded, is_basic_energy
  } = req.body;
  const r = await q(
    `INSERT INTO cards (
      name, expansion_id, card_number, rarity, card_type, subtype, hp, retreat_cost,
      weakness, resistance, illustrator, image_url, legal_standard, legal_expanded, is_basic_energy
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [name, expansion_id || null, card_number || null, rarity || null, card_type || null, subtype || null,
     hp || null, retreat_cost || null, weakness || null, resistance || null, illustrator || null,
     image_url || null, legal_standard === true, legal_expanded === true, is_basic_energy === true]
  );
  res.json({ id: r.rows[0].id });
});

// --- Inventory ---
app.get("/api/inventory", auth, async (req, res) => {
  const r = await q(
    `SELECT i.*, c.name AS card_name, c.card_type, c.image_url
     FROM inventory i JOIN cards c ON i.card_id=c.id
     WHERE i.user_id=$1 ORDER BY c.name`,
    [req.userId]
  );
  res.json(r.rows);
});

app.post("/api/inventory", auth, async (req, res) => {
  const { card_id, count = 1, condition = "NearMint", foil = false, storage_location = null } = req.body;
  await q(
    `INSERT INTO inventory (user_id, card_id, count, condition, foil, storage_location)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, card_id) DO UPDATE SET count = inventory.count + EXCLUDED.count, condition = EXCLUDED.condition, foil = EXCLUDED.foil, storage_location = EXCLUDED.storage_location`,
    [req.userId, card_id, count, condition, foil, storage_location]
  );
  res.json({ ok: true });
});

app.delete("/api/inventory/:id", auth, async (req, res) => {
  const id = req.params.id;
  await q("DELETE FROM inventory WHERE id=$1 AND user_id=$2", [id, req.userId]);
  res.json({ ok: true });
});

// --- Decks ---
app.get("/api/decks", auth, async (req, res) => {
  const r = await q("SELECT * FROM decks WHERE user_id=$1 ORDER BY created_at DESC", [req.userId]);
  res.json(r.rows);
});

app.post("/api/decks", auth, async (req, res) => {
  const { name, format = "Standard", archetype = null, notes = null } = req.body;
  const r = await q("INSERT INTO decks (user_id, name, format, archetype, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id", [req.userId, name, format, archetype, notes]);
  res.json({ id: r.rows[0].id });
});

app.get("/api/decks/:deckId/cards", auth, async (req, res) => {
  const deckId = req.params.deckId;
  const r = await q(
    `SELECT dc.count, c.* FROM deck_cards dc JOIN cards c ON dc.card_id=c.id WHERE dc.deck_id=$1`,
    [deckId]
  );
  res.json(r.rows);
});

app.post("/api/decks/:deckId/cards", auth, async (req, res) => {
  const deckId = req.params.deckId;
  const { card_id, count = 1 } = req.body;
  await q(
    `INSERT INTO deck_cards (deck_id, card_id, count) VALUES ($1,$2,$3)
     ON CONFLICT (deck_id, card_id) DO UPDATE SET count = EXCLUDED.count`,
    [deckId, card_id, count]
  );
  res.json({ ok: true });
});

app.delete("/api/decks/:deckId/cards/:cardId", auth, async (req, res) => {
  const { deckId, cardId } = req.params;
  await q("DELETE FROM deck_cards WHERE deck_id=$1 AND card_id=$2", [deckId, cardId]);
  res.json({ ok: true });
});

// --- Auto-build (improved heuristic) ---
async function autoBuildSmart(userId, format = "Standard", name = "Auto Deck") {
  const r = await q(
    `SELECT c.id, c.card_type, c.is_basic_energy, COALESCE(ms.times_in_decks,0) AS freq, COALESCE(ms.meta_win_rate,0) AS win
     FROM inventory i JOIN cards c ON i.card_id=c.id
     LEFT JOIN meta_stats ms ON ms.card_id=c.id
     WHERE i.user_id=$1 AND ($2='Expanded' AND c.legal_expanded OR $2!='Expanded' AND c.legal_standard)`,
    [userId, format]
  );
  const poolCards = r.rows;
  const WEIGHTS = { freq: 0.5, win: 0.3, synergy: 0.2 };

  // simple synergy heuristic
  const scored = poolCards.map(c => {
    let synergy = 0;
    if (c.card_type === "Trainer") synergy += 0.15;
    if (c.card_type === "Energy" && c.is_basic_energy) synergy += 0.05;
    if (c.card_type === "Pokemon" && c.is_basic_energy === false) synergy += 0.03;
    return { ...c, score: WEIGHTS.freq * c.freq + WEIGHTS.win * c.win + WEIGHTS.synergy * synergy };
  }).sort((a,b) => b.score - a.score);

  const target = { Pokemon: 18, Trainer: 30, Energy: 12 };
  const chosen = [];
  const counts = { Pokemon: 0, Trainer: 0, Energy: 0 };
  const copies = new Map();

  for (const c of scored) {
    const t = c.card_type;
    if (counts[t] >= target[t]) continue;
    const current = copies.get(c.id) || 0;
    const limit = c.is_basic_energy ? 60 : 4;
    if (current >= limit) continue;
    chosen.push({ card_id: c.id, count: 1 });
    copies.set(c.id, current + 1);
    counts[t]++;
    const total = counts.Pokemon + counts.Trainer + counts.Energy;
    if (total >= 60) break;
  }

  const ins = await q("INSERT INTO decks (user_id, name, format) VALUES ($1,$2,$3) RETURNING id", [userId, name, format]);
  const deckId = ins.rows[0].id;
  for (const c of chosen) {
    await q("INSERT INTO deck_cards (deck_id, card_id, count) VALUES ($1,$2,$3) ON CONFLICT (deck_id, card_id) DO UPDATE SET count = EXCLUDED.count", [deckId, c.card_id, c.count]);
  }
  return { deckId, added: chosen.length };
}

app.post("/api/decks/auto-build", auth, async (req, res) => {
  const { format = "Standard", name = "Auto Deck" } = req.body;
  const result = await autoBuildSmart(req.userId, format, name);
  res.json({ deck_id: result.deckId, cards_added: result.added });
});

// --- CSV import ---
const upload = multer({ storage: multer.memoryStorage() });

app.post("/api/inventory/import-csv", auth, upload.single("file"), async (req, res) => {
  try {
    const content = req.file.buffer.toString("utf8").trim();
    const lines = content.split(/\r?\n/);
    const header = lines.shift().split(",").map(h => h.trim());
    const idx = name => header.indexOf(name);
    let added = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = line.split(",").map(s => s.trim());
      const setCode = cols[idx("set_code")];
      const cardNumber = cols[idx("card_number")];
      const count = parseInt(cols[idx("count")] || "1", 10);
      const condition = cols[idx("condition")] || "NearMint";
      const foil = (cols[idx("foil")] || "false").toLowerCase() === "true";

      const r = await q(
        `SELECT c.id FROM cards c JOIN expansions e ON c.expansion_id=e.id WHERE e.set_code=$1 AND c.card_number=$2 LIMIT 1`,
        [setCode, cardNumber]
      );
      if (!r.rowCount) continue;
      const cardId = r.rows[0].id;
      await q(
        `INSERT INTO inventory (user_id, card_id, count, condition, foil) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, card_id) DO UPDATE SET count = inventory.count + EXCLUDED.count`,
        [req.userId, cardId, count, condition, foil]
      );
      added++;
    }
    res.json({ added });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "import failed" });
  }
});

// Health
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
