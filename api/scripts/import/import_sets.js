import fs from "fs";
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.PG_CONNECTION,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

async function q(text, params = []) {
  const client = await pool.connect();
  try {
    const r = await client.query(text, params);
    return r;
  } finally {
    client.release();
  }
}

async function main() {
  const [setsFile, cardsFile] = process.argv.slice(2);
  if (!setsFile || !cardsFile) {
    console.error("Usage: node import_sets.js sets.json cards.json");
    process.exit(1);
  }
  const sets = JSON.parse(fs.readFileSync(setsFile, "utf8"));
  const cards = JSON.parse(fs.readFileSync(cardsFile, "utf8"));

  for (const s of sets) {
    await q(
      `INSERT INTO expansions (name, series, set_code, release_date, total_cards, official_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (set_code) DO UPDATE SET name=EXCLUDED.name, series=EXCLUDED.series, release_date=EXCLUDED.release_date, total_cards=EXCLUDED.total_cards, official_url=EXCLUDED.official_url`,
      [s.name, s.series || null, s.set_code, s.release_date || null, s.total_cards || null, s.official_url || null]
    );
  }

  const expRes = await q("SELECT id, set_code FROM expansions");
  const expMap = new Map(expRes.rows.map(r => [r.set_code, r.id]));

  for (const c of cards) {
    const expId = expMap.get(c.set_code);
    if (!expId) continue;
    await q(
      `INSERT INTO cards (name, expansion_id, card_number, rarity, card_type, subtype, hp, retreat_cost, weakness, resistance, illustrator, image_url, legal_standard, legal_expanded, is_basic_energy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (expansion_id, card_number) DO UPDATE SET name=EXCLUDED.name, rarity=EXCLUDED.rarity, card_type=EXCLUDED.card_type, subtype=EXCLUDED.subtype, hp=EXCLUDED.hp, retreat_cost=EXCLUDED.retreat_cost, weakness=EXCLUDED.weakness, resistance=EXCLUDED.resistance, illustrator=EXCLUDED.illustrator, image_url=EXCLUDED.image_url, legal_standard=EXCLUDED.legal_standard, legal_expanded=EXCLUDED.legal_expanded, is_basic_energy=EXCLUDED.is_basic_energy`,
      [c.name, expId, c.card_number || null, c.rarity || null, c.card_type || null, c.subtype || null, c.hp || null, c.retreat_cost || null, c.weakness || null, c.resistance || null, c.illustrator || null, c.image_url || null, c.legal_standard ? true : false, c.legal_expanded ? true : false, c.is_basic_energy ? true : false]
    );
  }

  console.log("Import complete.");
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
