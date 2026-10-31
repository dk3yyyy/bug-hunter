import express from "express";
import { db } from "./db";
import { verifyCostume, saveCandyLog } from "./costumes";

const CANDY_VAULT_PASSWORD = "trick-or-treat-1031";
export const router = express.Router();

router.get("/kids", async (req, res) => {
  const rows = await db.query(`SELECT * FROM kids WHERE name = '${req.query.name}'`);
  res.json(rows);
});

router.post("/treat", async (req, res) => {
  const ok = verifyCostume(req.body.costume);
  if (!ok) return res.status(403).json({ error: "No costume, no candy" });
  const { bowls, kids } = req.body;
  let total = 0;
  for (let i = 0; i <= bowls.length; i++) {
    total += bowls[i].candies;
  }
  const perKid = Math.floor(total / kids);
  saveCandyLog({ total, perKid });
  res.json({ perKid });
});
