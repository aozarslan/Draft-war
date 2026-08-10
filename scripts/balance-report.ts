import { CATEGORIES } from "../src/lib/game/categories";
import { CHARACTERS, buildPool, POOLS } from "../src/lib/game/characters";

console.log("cat".padEnd(15), "n".padStart(4), "min".padStart(5), "p25".padStart(5), "med".padStart(5), "p75".padStart(5), "max".padStart(5), "  top 3");
for (const cat of CATEGORIES) {
  const pool = buildPool(cat.id, POOLS[cat.id] ?? []);
  const p = pool.map(c => c.gamePower).sort((a,b)=>a-b);
  const q = (f:number)=>p[Math.floor(f*(p.length-1))];
  const top = [...pool].sort((a,b)=>b.gamePower-a.gamePower).slice(0,3).map(c=>`${c.name}(${c.gamePower})`).join(", ");
  console.log(cat.id.padEnd(15), String(pool.length).padStart(4), String(q(0)).padStart(5), String(q(.25)).padStart(5), String(q(.5)).padStart(5), String(q(.75)).padStart(5), String(q(1)).padStart(5), " ", top);
}
console.log("\nTOPLAM:", CHARACTERS.length);
const ids = new Set(CHARACTERS.map(c=>c.id));
console.log("benzersiz id:", ids.size === CHARACTERS.length ? "OK" : "ÇAKIŞMA VAR");
// dominance check within each category
for (const cat of CATEGORIES) {
  const pool = buildPool(cat.id, POOLS[cat.id] ?? []);
  const keys = cat.stats.map(s=>s.key);
  const dominators = pool.filter(c => pool.every(o => o.id===c.id || keys.every(k => c.stats[k] >= o.stats[k])));
  if (dominators.length) console.log(`  ⚠ ${cat.id}: her statta baskın ->`, dominators.map(d=>d.name).join(", "));
}
