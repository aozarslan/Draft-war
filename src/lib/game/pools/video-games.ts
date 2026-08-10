import type { PoolEntry } from "../types";

/**
 * VIDEO GAMES — stats in order: power, speed, durability, combat, skill, special.
 *
 * Balance intent: mascots trade raw numbers for utility, shooters trade
 * durability for skill, and the god-tier entries (Kratos, Sephiroth) pay for it
 * with low skill or low speed. Game ratings for DRAFT WAR, not an official
 * ranking.
 */
export const VIDEO_GAMES: PoolEntry[] = [
  { n: "Mario", u: "Super Mario", t: "It's-a me", g: ["nintendo", "mobility", "brawler"], s: [76, 80, 84, 76, 82, 90], ab: ["Power-Up", "Stomp"] },
  { n: "Link", w: "Link (The Legend of Zelda)", u: "The Legend of Zelda", t: "The hero of time", g: ["nintendo", "rpg", "melee", "tactical"], s: [78, 78, 78, 90, 90, 88], ab: ["Master Sword", "Shield Parry"] },
  { n: "Samus Aran", u: "Metroid", t: "The bounty hunter", g: ["nintendo", "shooter", "ranged"], s: [88, 76, 88, 74, 88, 90], ab: ["Charge Beam", "Morph Ball"] },
  { n: "Master Chief", w: "Master Chief (Halo)", u: "Halo", t: "Spartan-117", g: ["shooter", "military", "ranged", "tactical"], s: [84, 78, 92, 84, 90, 82], ab: ["Energy Shield", "Assault Rifle"] },
  { n: "Kratos", u: "God of War", t: "The ghost of Sparta", g: ["rpg", "brawler", "melee"], s: [98, 76, 96, 94, 62, 92], ab: ["Blades of Chaos", "Spartan Rage"] },
  { n: "Lara Croft", u: "Tomb Raider", t: "The tomb raider", g: ["shooter", "mobility", "ranged", "survival"], s: [58, 84, 66, 78, 92, 78], ab: ["Dual Pistols", "Climb and Drop"] },
  { n: "Solid Snake", u: "Metal Gear", t: "Tactical espionage", g: ["stealth", "shooter", "tactical", "military"], s: [62, 74, 70, 88, 96, 84], ab: ["Cardboard Box", "CQC"] },
  { n: "Sonic the Hedgehog", w: "Sonic the Hedgehog (character)", u: "Sonic", t: "Gotta go fast", g: ["mobility"], s: [70, 100, 64, 64, 76, 88], ab: ["Spin Dash", "Ring Save"] },
  { n: "Pikachu", u: "Pokémon", t: "Small and electric", g: ["nintendo", "ranged", "mobility"], s: [76, 88, 50, 60, 74, 88], ab: ["Thunderbolt", "Quick Attack"] },
  { n: "Doomguy", w: "Doomguy", u: "Doom", t: "Rip and tear", g: ["shooter", "brawler", "ranged", "survival"], s: [94, 82, 92, 90, 84, 90], ab: ["Super Shotgun", "Glory Kill"] },
  { n: "Ryu", w: "Ryu (Street Fighter)", u: "Street Fighter", t: "The wandering warrior", g: ["fighter", "martial-arts", "melee"], s: [82, 80, 82, 96, 92, 86], ab: ["Hadouken", "Shoryuken"] },
  { n: "Scorpion", w: "Scorpion (Mortal Kombat)", u: "Mortal Kombat", t: "Get over here", g: ["fighter", "melee", "revenge"], s: [86, 84, 82, 92, 82, 92], ab: ["Spear Pull", "Hellfire"] },
  { n: "Sub-Zero", w: "Sub-Zero (Mortal Kombat)", u: "Mortal Kombat", t: "Ice in the veins", g: ["fighter", "melee", "tactical"], s: [84, 80, 84, 92, 84, 90], ab: ["Ice Clone", "Freeze"] },
  { n: "Cloud Strife", u: "Final Fantasy", t: "The ex-SOLDIER", g: ["rpg", "melee", "swordsman"], s: [86, 78, 82, 90, 84, 88], ab: ["Buster Sword", "Limit Break"] },
  { n: "Sephiroth", w: "Sephiroth (Final Fantasy)", u: "Final Fantasy", t: "The one-winged angel", g: ["rpg", "villain", "melee"], s: [94, 90, 86, 96, 88, 96], ab: ["Masamune", "Supernova"] },
  { n: "Bowser", u: "Super Mario", t: "The koopa king", g: ["nintendo", "villain", "brawler"], s: [92, 56, 94, 74, 58, 84], ab: ["Fire Breath", "Ground Pound"] },
  { n: "Donkey Kong", u: "Donkey Kong", t: "The big ape", g: ["nintendo", "brawler", "melee"], s: [90, 66, 86, 74, 62, 78], ab: ["Giant Punch", "Barrel Throw"] },
  { n: "Ezio Auditore", w: "Ezio Auditore da Firenze", u: "Assassin's Creed", t: "Nothing is true", g: ["stealth", "assassin", "mobility", "melee"], s: [66, 84, 70, 90, 92, 84], ab: ["Hidden Blade", "Leap of Faith"] },
  { n: "Nathan Drake", u: "Uncharted", t: "The lucky one", g: ["shooter", "mobility", "survival"], s: [60, 80, 72, 80, 88, 80], ab: ["Improvised Escape", "Cover Fire"] },
  { n: "Arthur Morgan", u: "Red Dead Redemption", t: "The outlaw with a code", g: ["shooter", "marksman", "survival", "ranged"], s: [72, 72, 82, 84, 92, 82], ab: ["Dead Eye", "Lasso"] },
  { n: "Aloy", u: "Horizon Zero Dawn", t: "The machine hunter", g: ["rpg", "marksman", "tactical", "ranged"], s: [64, 82, 70, 82, 94, 86], ab: ["Focus Scan", "Tripwire Trap"] },
  { n: "Dante", w: "Dante (Devil May Cry)", u: "Devil May Cry", t: "Stylish and immortal", g: ["fighter", "melee", "brawler"], s: [92, 88, 92, 94, 86, 94], ab: ["Devil Trigger", "Rebellion"] },
];
