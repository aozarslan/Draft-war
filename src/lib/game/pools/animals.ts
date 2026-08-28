import type { PoolEntry } from "../types";

/**
 * ANIMALS — stats in order: mass, strength, speed, bite, defense, aggression.
 *
 * These are real animals and these numbers are NOT science. They are a game
 * rating invented so that a party game has interesting matchups; DRAFT WAR does
 * not claim to predict what would happen if two animals actually met.
 *
 * Balance intent: heavyweights win on power and defense, hunters win on speed
 * and their finisher, so a squad of five apex predators is not automatically
 * better than a mixed one.
 */
export const ANIMALS: PoolEntry[] = [
  { n: "African Bush Elephant", w: "African bush elephant", u: "Wild", t: "The largest land animal", g: ["herd", "survival"], s: [100, 98, 55, 45, 92, 55], ab: ["Tusk Charge", "Trample"],
    nick: "THE TOWER", va: "quadruped_large",
    i: { head: "TUSKS", back: "NONE", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.12 } },
  { n: "White Rhinoceros", w: "White rhinoceros", u: "Wild", t: "An armoured battering ram", g: ["herd", "survival"], s: [92, 92, 62, 40, 94, 70], ab: ["Horn Charge", "Thick Hide"],
    nick: "THE BATTERING RAM", va: "quadruped_large",
    i: { head: "HORNS", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.06 } },
  { n: "Hippopotamus", u: "Wild", t: "The river's temper", g: ["herd", "predator"], s: [90, 90, 58, 92, 88, 92], ab: ["Jaw Gape", "River Ambush"] },
  { n: "Polar Bear", w: "Polar bear", u: "Wild", t: "The largest land predator", g: ["predator", "survival"], s: [80, 90, 62, 88, 80, 82], ab: ["Paw Strike", "Cold Endurance"] },
  { n: "Grizzly Bear", w: "Grizzly bear", u: "Wild", t: "Do not run", g: ["predator", "survival", "brawler"], s: [78, 90, 66, 86, 80, 84], ab: ["Swipe", "Standing Reach"],
    nick: "THE MOUNTAIN", va: "quadruped_large",
    i: { head: "EARS", back: "MANE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.02 } },
  { n: "Tiger", u: "Wild", t: "The solitary hunter", g: ["predator", "big-cat", "mobility"], s: [66, 84, 82, 88, 66, 88], ab: ["Ambush Pounce", "Throat Bite"],
    nick: "THE AMBUSH", va: "quadruped_medium",
    i: { head: "EARS", back: "NONE", marking: "STRIPES", build: "NORMAL", prop: "NONE", scale: 1 } },
  { n: "Lion", u: "Wild", t: "The pride's edge", g: ["predator", "big-cat", "pack"], s: [64, 80, 80, 84, 66, 86], ab: ["Pride Tactics", "Mane Guard"],
    nick: "THE KING", va: "quadruped_medium",
    i: { head: "EARS", back: "MANE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.02 } },
  { n: "Western Gorilla", w: "Western gorilla", u: "Wild", t: "Silverback strength", g: ["pack", "brawler"], s: [62, 92, 62, 76, 74, 62], ab: ["Chest Display", "Grapple"],
    nick: "THE SILVERBACK", va: "humanoid_large",
    i: { head: "PLAIN", back: "MANE", marking: "PATCH", build: "TOWERING", prop: "NONE", scale: 1.02 } },
  { n: "Saltwater Crocodile", w: "Saltwater crocodile", u: "Wild", t: "The strongest bite", g: ["predator", "reptile", "survival"], s: [78, 88, 52, 100, 90, 88], ab: ["Death Roll", "Water Ambush"],
    nick: "THE ROLL", va: "quadruped_large",
    i: { head: "CREST", back: "SPINES", marking: "BANDS", build: "SQUAT", prop: "NONE", scale: 1 } },
  { n: "Komodo Dragon", w: "Komodo dragon", u: "Wild", t: "Patient and venomous", g: ["predator", "reptile"], s: [46, 66, 54, 84, 72, 78], ab: ["Venom Bite", "Track the Wounded"] },
  { n: "Green Anaconda", w: "Green anaconda", u: "Wild", t: "The constrictor", g: ["predator", "reptile", "stealth"], s: [58, 88, 40, 70, 66, 70], ab: ["Coil Crush", "Submerged Strike"] },
  { n: "African Buffalo", w: "African buffalo", u: "Wild", t: "Black death", g: ["herd", "survival", "brawler"], s: [74, 82, 70, 44, 82, 90], ab: ["Boss Horns", "Herd Charge"] },
  { n: "Moose", u: "Wild", t: "Antlers and attitude", g: ["herd", "survival"], s: [76, 80, 68, 38, 76, 74], ab: ["Antler Sweep", "Kick"] },
  { n: "American Bison", w: "American bison", u: "Wild", t: "A ton at full speed", g: ["herd", "brawler"], s: [82, 86, 72, 36, 84, 72], ab: ["Stampede", "Head Butt"] },
  { n: "Jaguar", u: "Wild", t: "Bite through the skull", g: ["predator", "big-cat", "stealth"], s: [56, 82, 78, 92, 62, 84], ab: ["Skull Bite", "Silent Stalk"] },
  { n: "Leopard", u: "Wild", t: "Strength in the trees", g: ["predator", "big-cat", "stealth", "mobility"], s: [48, 76, 84, 80, 58, 80], ab: ["Tree Drag", "Ambush"] },
  { n: "Spotted Hyena", w: "Spotted hyena", u: "Wild", t: "The clan takes it", g: ["pack", "predator"], s: [46, 70, 76, 90, 62, 86], ab: ["Bone Crush", "Clan Swarm"] },
  { n: "Wolf", u: "Wild", t: "The pack is the weapon", g: ["pack", "predator", "survival"], s: [40, 62, 80, 74, 56, 78], ab: ["Pack Flank", "Endurance Chase"],
    nick: "THE PACK", va: "quadruped_medium",
    i: { head: "EARS", back: "NONE", marking: "PATCH", build: "SLIGHT", prop: "NONE", scale: 0.94 } },
  { n: "Wild Boar", w: "Wild boar", u: "Wild", t: "Tusks first", g: ["survival", "brawler"], s: [50, 70, 74, 72, 72, 86], ab: ["Tusk Rip", "Charge"] },
  { n: "Common Ostrich", w: "Common ostrich", u: "Wild", t: "The kick that kills", g: ["herd", "mobility"], s: [46, 68, 92, 30, 52, 66], ab: ["Front Kick", "Sprint"] },
  { n: "Cheetah", u: "Wild", t: "The fastest land animal", g: ["predator", "big-cat", "mobility"], s: [38, 56, 100, 62, 40, 66], ab: ["Sprint Takedown", "Trip"],
    nick: "THE SPRINT", va: "quadruped_medium",
    i: { head: "EARS", back: "NONE", marking: "SPOTS", build: "SLIGHT", prop: "NONE", scale: 0.9 } },
  { n: "Orca", u: "Wild", t: "The ocean's apex", g: ["pack", "predator"], s: [94, 94, 84, 82, 84, 82], ab: ["Coordinated Hunt", "Tail Slam"] },
  { n: "Great White Shark", w: "Great white shark", u: "Wild", t: "The ambush from below", g: ["predator", "stealth"], s: [86, 88, 76, 96, 78, 84], ab: ["Breach Strike", "Serrated Bite"],
    nick: "THE BREACH", va: "aquatic",
    i: { head: "PLAIN", back: "FIN", marking: "PATCH", build: "HEAVY", prop: "NONE", scale: 1.1 } },
  { n: "Honey Badger", w: "Honey badger", u: "Wild", t: "Refuses to lose", g: ["survival", "brawler"], s: [22, 52, 68, 74, 84, 98], ab: ["Loose Skin", "Never Quit"],
    nick: "NEVER QUIT", va: "quadruped_small",
    i: { head: "EARS", back: "SPINES", marking: "PATCH", build: "SQUAT", prop: "NONE", scale: 0.8 } },
  { n: "Wolverine", u: "Wild", t: "Small, and completely unbothered", g: ["survival", "predator", "brawler"], s: [26, 62, 66, 78, 76, 94], ab: ["Bone Crunch", "Snow Ambush"] },
  { n: "Golden Eagle", w: "Golden eagle", u: "Wild", t: "The dive", g: ["predator", "mobility"], s: [24, 58, 96, 68, 40, 76], ab: ["Stoop Dive", "Talon Grip"],
    nick: "THE STOOP", va: "winged",
    i: { head: "CREST", back: "NONE", marking: "PATCH", build: "SLIGHT", prop: "NONE", scale: 0.94 } },
  { n: "Black Mamba", w: "Black mamba", u: "Wild", t: "Fast and final", g: ["predator", "reptile", "stealth", "mobility"], s: [16, 30, 94, 94, 26, 82], ab: ["Neurotoxin", "Repeat Strike"],
    nick: "THE STRIKE", va: "serpentine",
    i: { head: "CREST", back: "NONE", marking: "BANDS", build: "SLIGHT", prop: "NONE", scale: 0.9 } },
  { n: "Southern Cassowary", w: "Southern cassowary", u: "Wild", t: "The dagger claw", g: ["survival", "mobility"], s: [44, 68, 82, 40, 60, 88], ab: ["Dagger Kick", "Casque Guard"] },
  { n: "Muskox", u: "Wild", t: "The wall of horn", g: ["herd", "survival"], s: [70, 78, 60, 36, 88, 72], ab: ["Defensive Circle", "Head Clash"] },
  { n: "Southern Elephant Seal", w: "Southern elephant seal", u: "Wild", t: "Four tons of beachmaster", g: ["survival", "brawler"], s: [96, 84, 42, 74, 86, 80], ab: ["Body Slam", "Blubber Armour"] },
];
