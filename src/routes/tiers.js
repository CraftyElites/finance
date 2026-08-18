const express = require('express');
const router = express.Router();
const db = require('../db');

// Shared shape used by both this public route and the admin CRUD routes in
// admin.js, so the landing page, the admin dashboard, and application
// validation are all reading the exact same tier data — no more duplicated
// tier arrays hardcoded in HTML.
function normalizeTier(row) {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    slotFee: Number(row.slot_fee),
    features: typeof row.features === 'string' ? JSON.parse(row.features) : row.features,
    recommended: !!row.recommended,
    sortOrder: row.sort_order,
  };
}

// GET /api/tiers — public, read-only. Powers the "Pick Your Tier" cards on
// the landing page. Tiers themselves are only ever created/edited/deleted
// by an admin via /api/admin/tiers (see routes/admin.js).
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, amount, slot_fee, features, recommended, sort_order
       FROM tiers ORDER BY sort_order ASC, created_at ASC`
    );
    res.json({ tiers: rows.map(normalizeTier) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch tiers' });
  }
});

module.exports = router;
module.exports.normalizeTier = normalizeTier;