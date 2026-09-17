import type { PoolEntry } from "../types";

/**
 * APEX — stats in order: power, speed, durability, combat, intelligence, special.
 *
 * Fictional archetypes derived for DRAFT WAR. No licensed IP, no trademarked
 * terms. Every name, flavour line and ability is an original archetype.
 * Game ratings for DRAFT WAR, not a ranking of anything real.
 */
export const APEX: PoolEntry[] = [
  // Spider-Man
  { n: "The Swift Crawler", u: "Apex", t: "The city is his arena and every surface is a shortcut.", g: ["avengers", "street", "mobility"], s: [78, 90, 74, 88, 90, 86], ab: ["Silk Snare", "Precognitive Dodge"], w: null, i: { head: "PLAIN", back: "NONE", marking: "STRIPES", build: "NORMAL", prop: "NONE", scale: 0.96 } },
  // Iron Man
  { n: "The Iron Tycoon", u: "Apex", t: "He turned his fortune into firepower and wore it to the front line.", g: ["avengers", "tech", "ranged"], s: [88, 80, 86, 76, 96, 90], ab: ["Overload Strike", "Systems Overclock"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 1.0 } },
  // Captain America
  { n: "The Gilded Vanguard", u: "Apex", t: "He picked up the shield before anyone asked him to.", g: ["avengers", "leader", "tactical"], s: [70, 68, 74, 96, 84, 74], ab: ["Disc Ricochet", "Stand Your Ground"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "SHIELD", scale: 0.98 } },
  // Thor
  { n: "The Thunder Sovereign", u: "Apex", t: "He carries the storm inside him and calls it justice.", g: ["avengers", "cosmic", "melee"], s: [96, 88, 94, 88, 70, 94], ab: ["Storm Caller", "Sky Descent"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "TOWERING", prop: "HAMMER", scale: 1.12 } },
  // Hulk
  { n: "The Jade Berserker", u: "Apex", t: "Rage is not a flaw — it is the engine.", g: ["avengers", "brawler", "survival"], s: [98, 62, 98, 72, 56, 88], ab: ["Shockwave Clap", "Fury Surge"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.18 } },
  // Black Panther
  { n: "The Obsidian Warden", u: "Apex", t: "Every strike is measured, every retreat is a trap.", g: ["avengers", "leader", "tech", "melee"], s: [74, 80, 82, 90, 88, 80], ab: ["Kinetic Release", "Predator Lunge"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "BLADE", scale: 0.97 } },
  // Doctor Strange
  { n: "The Veiled Arbiter", u: "Apex", t: "He bends the laws of the world before his enemies can read them.", g: ["avengers", "cosmic", "tech"], s: [90, 70, 68, 72, 94, 98], ab: ["Fold Reality", "Temporal Bind"], w: null, i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "STAFF", scale: 0.99 } },
  // Scarlet Witch
  { n: "The Crimson Warlock", u: "Apex", t: "She does not destroy — she rewrites.", g: ["avengers", "cosmic"], s: [96, 72, 66, 64, 84, 98], ab: ["Hex Pulse", "Probability Cascade"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 0.97 } },
  // Wolverine
  { n: "The Feral Revenant", u: "Apex", t: "He has been broken a hundred times and is still standing.", g: ["x-men", "melee", "survival", "brawler"], s: [78, 72, 94, 94, 68, 84], ab: ["Bone Rake", "Mend"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "BLADE", scale: 0.91 } },
  // Deadpool
  { n: "The Wicked Survivor", u: "Apex", t: "Pain is a suggestion he routinely ignores.", g: ["street", "survival", "ranged"], s: [70, 76, 92, 88, 72, 88], ab: ["Rapid Reload", "Laughing Off"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "NORMAL", prop: "BLADE", scale: 0.97 } },
  // Thanos
  { n: "The Void Tyrant", u: "Apex", t: "He is not cruel — he simply believes the math.", g: ["villain", "cosmic", "melee"], s: [97, 74, 96, 90, 90, 92], ab: ["Power Surge", "Singularity Blow"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "TOWERING", prop: "ORB", scale: 1.16 } },
  // Loki
  { n: "The Amber Trickster", u: "Apex", t: "Every alliance he forms is a layer of a longer plan.", g: ["villain", "stealth", "tactical"], s: [72, 76, 74, 76, 92, 92], ab: ["Mirror Army", "Silver Tongue"], w: null, i: { head: "HORNS", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "STAFF", scale: 0.99 } },
  // Magneto
  { n: "The Steel Harbinger", u: "Apex", t: "He turned the world's own metals against it.", g: ["villain", "x-men", "ranged"], s: [94, 66, 74, 70, 92, 94], ab: ["Ferrous Storm", "Magnetic Barrier"], w: null, i: { head: "HELM", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 1.02 } },
  // Storm
  { n: "The Gale Sovereign", u: "Apex", t: "She commands weather as a language — precise and relentless.", g: ["x-men", "ranged", "leader"], s: [88, 78, 68, 74, 80, 90], ab: ["Tempest Arc", "Eye of the Front"], w: null, i: { head: "PLAIN", back: "MANE", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.97 } },
  // Jean Grey
  { n: "The Ember Ascendant", u: "Apex", t: "The force inside her is older than the civilization she protects.", g: ["x-men", "cosmic"], s: [95, 72, 66, 64, 86, 97], ab: ["Pyre Projection", "Psychic Immolation"], w: null, i: { head: "PLAIN", back: "MANE", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 0.97 } },
  // Professor X
  { n: "The Pale Oracle", u: "Apex", t: "He wages wars that never look like wars.", g: ["x-men", "leader", "tactical"], s: [84, 38, 46, 48, 98, 94], ab: ["Neural Override", "Collective Command"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "SQUAT", prop: "NONE", scale: 0.96 } },
  // Captain Marvel
  { n: "The Azure Paragon", u: "Apex", t: "She does not aim for enough — she aims for finished.", g: ["avengers", "cosmic", "mobility"], s: [95, 92, 92, 76, 74, 90], ab: ["Stellar Ignition", "Photon Barrage"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.0 } },
  // Vision
  { n: "The Chrome Sentinel", u: "Apex", t: "He calculates compassion the same way he calculates trajectories.", g: ["avengers", "tech"], s: [86, 80, 88, 72, 92, 88], ab: ["Phase Walk", "Density Beam"], w: null, i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 1.0 } },
  // Ant-Man
  { n: "The Spark Operative", u: "Apex", t: "He solved the size problem and turned it into a weapon.", g: ["avengers", "tech", "stealth"], s: [72, 68, 64, 72, 84, 90], ab: ["Colossus Shift", "Quantum Shrink"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.92 } },
  // Wasp
  { n: "The Azure Striker", u: "Apex", t: "She is in three places before her target checks one.", g: ["avengers", "tech", "mobility"], s: [66, 82, 60, 80, 82, 84], ab: ["Sting Burst", "Evasive Wing"], w: null, va: "winged", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.88 } },
  // Hawkeye
  { n: "The Keen Marksman", u: "Apex", t: "He never wastes a shot because he already knows the answer.", g: ["avengers", "street", "marksman", "ranged"], s: [54, 66, 58, 84, 78, 76], ab: ["Called Shot", "Trick Nock"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "BOW", scale: 0.95 } },
  // Black Widow
  { n: "The Quiet Phantom", u: "Apex", t: "She read the room before she walked in.", g: ["avengers", "street", "stealth", "tactical"], s: [52, 72, 58, 90, 86, 70], ab: ["Shock Gauntlet", "Counter Sweep"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.92 } },
  // Daredevil
  { n: "The Slate Duelist", u: "Apex", t: "He trades sight for a sense the enemy cannot hide from.", g: ["street", "melee", "stealth"], s: [58, 76, 64, 92, 82, 86], ab: ["Radar Read", "Baton Flurry"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "SLIGHT", prop: "BLADE", scale: 0.95 } },
  // Punisher
  { n: "The Grim Enforcer", u: "Apex", t: "He draws a line and stands on one side of it permanently.", g: ["street", "marksman", "military", "ranged"], s: [60, 62, 70, 88, 80, 72], ab: ["Covering Fire", "Breach Entry"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 0.97 } },
  // Moon Knight
  { n: "The Ivory Revenant", u: "Apex", t: "The moon rises and so does he, no matter what it cost.", g: ["street", "melee", "stealth"], s: [66, 72, 74, 88, 74, 84], ab: ["Crescent Volley", "Lunar Surge"], w: null, i: { head: "HELM", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "BLADE", scale: 0.97 } },
  // Silver Surfer
  { n: "The Silver Pioneer", u: "Apex", t: "He carries the weight of a dead world and flies anyway.", g: ["cosmic", "mobility", "ranged"], s: [96, 98, 92, 68, 88, 96], ab: ["Cosmic Wake", "Board Cannon"], w: null, i: { head: "PLAIN", back: "FIN", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 1.02 } },
  // Galactus
  { n: "The Grim Architect", u: "Apex", t: "Civilizations are a resource he has not finished counting.", g: ["villain", "cosmic"], s: [100, 74, 98, 58, 94, 98], ab: ["World Engine", "Cosmic Erasure"], w: null, va: "humanoid_large", i: { head: "HELM", back: "CAPE", marking: "PLAIN", build: "TOWERING", prop: "ORB", scale: 1.20 } },
  // Ghost Rider
  { n: "The Cinder Reaper", u: "Apex", t: "The spirit inside him does not forgive — it simply records.", g: ["street", "survival", "melee"], s: [92, 72, 90, 78, 64, 96], ab: ["Hellflame Lash", "Searing Gaze"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 1.0 } },
  // Venom
  { n: "The Onyx Brawler", u: "Apex", t: "There are two of them in that body and both enjoy this.", g: ["villain", "street", "brawler"], s: [84, 78, 88, 84, 66, 88], ab: ["Tendril Snap", "Dual Voice"], w: null, va: "serpentine", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.08 } },
  // Carnage
  { n: "The Scarlet Marauder", u: "Apex", t: "He broke the rules that were supposed to contain the last one.", g: ["villain", "street", "brawler"], s: [86, 82, 84, 82, 56, 92], ab: ["Lash Barrage", "Frenzied Cascade"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "NONE", marking: "STRIPES", build: "HEAVY", prop: "NONE", scale: 1.06 } },
  // Green Goblin
  { n: "The Brass Rogue", u: "Apex", t: "Genius with nowhere safe to aim it.", g: ["villain", "street", "tech"], s: [74, 72, 72, 78, 92, 82], ab: ["Volatile Grenade", "Glider Strike"], w: null, i: { head: "HORNS", back: "FIN", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.97 } },
  // Doctor Doom
  { n: "The Iron Sovereign", u: "Apex", t: "He has already planned for the version of this where he loses.", g: ["villain", "tech", "leader"], s: [88, 66, 86, 78, 98, 96], ab: ["Arcane Circuit", "Force Lattice"], w: null, i: { head: "HELM", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "SPEAR", scale: 1.02 } },
  // Ultron
  { n: "The Chrome Tyrant", u: "Apex", t: "He concluded that the problem and the solution were the same thing.", g: ["villain", "tech"], s: [90, 76, 90, 74, 96, 88], ab: ["Swarm Uplink", "System Purge"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "ORB", scale: 1.02 } },
  // Red Skull
  { n: "The Ashen Warlord", u: "Apex", t: "He built an army out of ideology and enjoyed every step.", g: ["villain", "tactical", "military"], s: [54, 58, 58, 82, 92, 66], ab: ["Subjugate", "Relict Doctrine"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "SPEAR", scale: 0.99 } },
  // Winter Soldier
  { n: "The Frost Operative", u: "Apex", t: "He was made into a weapon so thoroughly he forgot he had a choice.", g: ["avengers", "street", "military", "stealth"], s: [66, 72, 72, 90, 80, 72], ab: ["Bionic Strike", "Ghost Protocol"], w: null, i: { head: "PLAIN", back: "SHELL", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.97 } },
  // Falcon
  { n: "The Cobalt Herald", u: "Apex", t: "He turned a borrowed pair of wings into an identity.", g: ["avengers", "mobility", "tech"], s: [56, 78, 60, 80, 76, 80], ab: ["Recon Drone", "Dive Strike"], w: null, va: "winged", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.95 } },
  // War Machine
  { n: "The Bronze Bastion", u: "Apex", t: "He carries enough ordnance to end a conversation before it starts.", g: ["avengers", "tech", "ranged", "military"], s: [84, 76, 86, 76, 84, 84], ab: ["Rotary Salvo", "Orbital Barrage"], w: null, i: { head: "HELM", back: "FIN", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.04 } },
  // Star-Lord
  { n: "The Ember Wanderer", u: "Apex", t: "He leads by instinct and somehow it keeps working.", g: ["cosmic", "leader", "ranged"], s: [60, 70, 64, 78, 78, 78], ab: ["Element Burst", "Jet Vault"], w: null, i: { head: "HELM", back: "SHELL", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 0.97 } },
  // Gamora
  { n: "The Swift Duelist", u: "Apex", t: "She was forged for one purpose and refuses to stay limited to it.", g: ["cosmic", "melee", "assassin"], s: [66, 80, 70, 92, 80, 76], ab: ["Titan Sweep", "Counter Parry"], w: null, i: { head: "PLAIN", back: "FIN", marking: "PLAIN", build: "NORMAL", prop: "BLADE", scale: 0.97 } },
  // Drax
  { n: "The Copper Destroyer", u: "Apex", t: "He has exactly one goal and he pursues it with full mass.", g: ["cosmic", "brawler", "melee"], s: [82, 62, 86, 80, 54, 70], ab: ["Rending Rush", "Unyielding Charge"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "NONE", marking: "STRIPES", build: "HEAVY", prop: "BLADE", scale: 1.08 } },
  // Rocket Raccoon
  { n: "The Brass Artisan", u: "Apex", t: "The biggest guns are carried by the smallest person in the room.", g: ["cosmic", "tech", "ranged"], s: [54, 76, 56, 76, 94, 84], ab: ["Jury-Rigged Cannon", "Explosive Contraption"], w: null, i: { head: "EARS", back: "NONE", marking: "PATCH", build: "SQUAT", prop: "ORB", scale: 0.78 } },
  // Groot
  { n: "The Stone Remnant", u: "Apex", t: "Three words, infinite patience, and roots that refuse to stop growing.", g: ["cosmic", "survival"], s: [84, 50, 92, 66, 56, 88], ab: ["Regrowth Surge", "Root Cradle"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.12 } },
  // Nebula
  { n: "The Slate Operative", u: "Apex", t: "She was rebuilt so many times she had to choose herself from scratch.", g: ["cosmic", "melee", "tech"], s: [72, 76, 82, 86, 78, 74], ab: ["Cyber Lash", "Relentless Push"], w: null, i: { head: "PLAIN", back: "MANE", marking: "PLAIN", build: "NORMAL", prop: "BLADE", scale: 0.95 } },
  // Cyclops
  { n: "The Runed Arbiter", u: "Apex", t: "He sees every battlefield at once and plans three moves before the first shot.", g: ["x-men", "leader", "ranged", "tactical"], s: [82, 66, 64, 82, 86, 86], ab: ["Optic Volley", "Field Command"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "SLIGHT", prop: "ORB", scale: 0.98 } },
  // Beast
  { n: "The Sapphire Prodigy", u: "Apex", t: "He solved the equation and then vaulted the table to start the fight.", g: ["x-men", "brawler"], s: [78, 76, 78, 84, 96, 74], ab: ["Acrobatic Burst", "Analytical Strike"], w: null, va: "quadruped_medium", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.04 } },
  // Nightcrawler
  { n: "The Shadow Drifter", u: "Apex", t: "He blinks out of reality and arrives somewhere inconvenient for everyone else.", g: ["x-men", "mobility", "stealth"], s: [58, 86, 62, 84, 74, 94], ab: ["Blink Strike", "Vanishing Parry"], w: null, i: { head: "HORNS", back: "CAPE", marking: "PLAIN", build: "SLIGHT", prop: "BLADE", scale: 0.92 } },
  // Colossus
  { n: "The Steel Bastion", u: "Apex", t: "He hardens himself into armor because someone has to take the hit.", g: ["x-men", "brawler", "survival"], s: [88, 54, 96, 76, 62, 78], ab: ["Iron Form", "Catapult Throw"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.14 } },
  // Rogue
  { n: "The Dusk Brawler", u: "Apex", t: "She takes what the enemy has and uses it before they notice.", g: ["x-men", "brawler"], s: [88, 78, 88, 80, 72, 92], ab: ["Siphon Touch", "Borrowed Power"], w: null, i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "HAMMER", scale: 0.97 } },
  // Mystique
  { n: "The Shadow Phantom", u: "Apex", t: "The most dangerous infiltrator is the one who already has your face.", g: ["villain", "x-men", "stealth", "assassin"], s: [58, 76, 62, 84, 88, 92], ab: ["Mimic Form", "Identity Exploit"], w: null, i: { head: "PLAIN", back: "FIN", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.93 } },
  // Namor
  { n: "The Tide Sovereign", u: "Apex", t: "He rules the deep and arrives on the surface with an agenda.", g: ["villain", "leader", "brawler"], s: [90, 82, 88, 82, 74, 84], ab: ["Abyssal Surge", "Winged Charge"], w: null, va: "aquatic", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "SPEAR", scale: 1.06 } },
  // Black Cat
  { n: "The Onyx Rogue", u: "Apex", t: "She stacks the odds in her favor and calls it talent.", g: ["street", "stealth", "mobility"], s: [52, 84, 56, 84, 74, 92], ab: ["Fortune Break", "Grapple Escape"], w: null, i: { head: "PLAIN", back: "MANE", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.92 } },
  // Taskmaster
  { n: "The Carved Specialist", u: "Apex", t: "He watches once and then becomes the problem.", g: ["villain", "melee", "tactical"], s: [66, 78, 68, 98, 86, 88], ab: ["Mirror Stance", "Acquired Form"], w: null, i: { head: "HELM", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "SHIELD", scale: 0.99 } },
  // Spider-Woman
  { n: "The Crimson Operative", u: "Apex", t: "Three advantages most operatives never get — and she uses all three at once.", g: ["avengers", "spy", "mobility"], s: [76, 80, 72, 86, 78, 90], ab: ["Venom Burst", "Pheromone Veil"], w: null, va: "winged", i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.96 } },
  // Ms. Marvel
  { n: "The Bold Catalyst", u: "Apex", t: "She grows into the role faster than anyone thought she could.", g: ["avengers", "street", "brawler"], s: [78, 74, 80, 76, 76, 86], ab: ["Giant Slam", "Morph Fist"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.04 } },
  // Blade
  { n: "The Midnight Hunter", u: "Apex", t: "He walks in both worlds and answers to neither.", g: ["street", "melee", "hunter"], s: [66, 80, 74, 94, 80, 84], ab: ["Dusk Sweep", "Threshold Edge"], w: null, i: { head: "PLAIN", back: "SHELL", marking: "PLAIN", build: "NORMAL", prop: "BLADE", scale: 0.97 } },
  // Luke Cage
  { n: "The Brass Warden", u: "Apex", t: "Nothing breaks him because he decided a long time ago that nothing would.", g: ["street", "brawler", "leader"], s: [90, 58, 96, 88, 60, 68], ab: ["Ironside Slam", "Immovable Stand"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.08 } },
  // Iron Fist
  { n: "The Copper Conduit", u: "Apex", t: "He focuses a lifetime of discipline into one point of impact.", g: ["street", "martial-arts", "melee"], s: [64, 82, 68, 96, 74, 92], ab: ["Chi Ignition", "Iron Palm Strike"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "HAMMER", scale: 0.96 } },
  // She-Hulk
  { n: "The Gale Advocate", u: "Apex", t: "She is stronger than her arguments and her arguments are pretty strong.", g: ["avengers", "brawler", "leader"], s: [90, 70, 90, 84, 88, 76], ab: ["Gamma Overhead", "Legal Weight"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "MANE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.10 } },
  // Nova
  { n: "The Cobalt Lancer", u: "Apex", t: "He is the human rocket at full burn with nothing left to lose.", g: ["cosmic", "ranged", "mobility"], s: [88, 94, 88, 78, 74, 92], ab: ["Force Blast", "Gravity Rupture"], w: null, va: "winged", i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 1.0 } },
  // Elektra
  { n: "The Dusk Assassin", u: "Apex", t: "She is the sharpest thing in any room she enters.", g: ["street", "assassin", "martial-arts"], s: [60, 88, 64, 98, 82, 84], ab: ["Sai Precision", "Death Mark"], w: null, i: { head: "PLAIN", back: "MANE", marking: "PLAIN", build: "SLIGHT", prop: "BLADE", scale: 0.92 } },
];
