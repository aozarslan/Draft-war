import type { PoolEntry } from "../types";

/**
 * VIGIL — stats in order: power, speed, durability, combat, intelligence, special.
 *
 * Fictional archetypes derived for DRAFT WAR. No licensed IP, no trademarked
 * terms. Every name, flavour line and ability is an original archetype.
 * Game ratings for DRAFT WAR, not a ranking of anything real.
 */
export const VIGIL: PoolEntry[] = [
  // Superman
  { n: "The Ivory Paragon", u: "Vigil", t: "He could end every fight in seconds and holds back because restraint is the harder lesson.", g: ["justice-league", "cosmic", "leader"], s: [100, 100, 100, 84, 80, 94], ab: ["Thermal Ray", "Pressure Wave"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.14 } },
  // Batman
  { n: "The Midnight Sentinel", u: "Vigil", t: "No powers. No shortcuts. He trained until nothing surprised him.", g: ["justice-league", "bat-family", "tactical", "stealth"], s: [55, 70, 60, 95, 98, 88], ab: ["Shadow Pounce", "Iron Resolve"], w: null, i: { head: "HELM", back: "CAPE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 0.97 } },
  // Wonder Woman
  { n: "The Bronze Champion", u: "Vigil", t: "She carries a civilization's ideals into a world that has never lived up to them.", g: ["justice-league", "melee", "leader"], s: [92, 86, 92, 96, 84, 88], ab: ["Lasso Bind", "Bracer Counter"], w: null, va: "humanoid_large", i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "TOWERING", prop: "SPEAR", scale: 1.12 } },
  // The Flash
  { n: "The Scarlet Catalyst", u: "Vigil", t: "By the time he decides to move, the fight is already over.", g: ["justice-league", "mobility"], s: [82, 100, 70, 74, 84, 96], ab: ["Velocity Strike", "Infinite Loop"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.93 } },
  // Green Lantern
  { n: "The Jade Conduit", u: "Vigil", t: "His only limit is the shape of his imagination.", g: ["justice-league", "cosmic", "ranged"], s: [92, 82, 84, 70, 82, 96], ab: ["Construct Barrage", "Will Barrier"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 1.0 } },
  // Aquaman
  { n: "The Tide Warden", u: "Vigil", t: "Seven seas of territory, one trident, and no patience for disrespect.", g: ["justice-league", "leader", "melee"], s: [90, 76, 92, 86, 78, 82], ab: ["Trident Lunge", "Tidal Summon"], w: null, va: "aquatic", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "SPEAR", scale: 1.10 } },
  // Cyborg
  { n: "The Chrome Vanguard", u: "Vigil", t: "He is the bridge between flesh and machine and he built it himself.", g: ["justice-league", "titans", "tech", "ranged"], s: [84, 74, 88, 76, 92, 86], ab: ["Sonic Cannon", "System Override"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.04 } },
  // Shazam
  { n: "The Thunder Herald", u: "Vigil", t: "One word turns a child into a force of nature.", g: ["justice-league", "cosmic"], s: [94, 88, 92, 70, 66, 92], ab: ["Lightning Decree", "Champion's Might"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.12 } },
  // Green Arrow
  { n: "The Slate Marksman", u: "Vigil", t: "He stripped away everything except the bow and found that was enough.", g: ["justice-league", "marksman", "ranged", "tactical"], s: [52, 68, 58, 86, 84, 76], ab: ["Specialty Nock", "Overwatch Shot"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "BOW", scale: 0.95 } },
  // Supergirl
  { n: "The Azure Ascendant", u: "Vigil", t: "She carries the whole last culture of her world in one set of memories.", g: ["justice-league", "cosmic", "mobility"], s: [96, 94, 94, 72, 76, 88], ab: ["Solar Flare", "Aerial Charge"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "TOWERING", prop: "ORB", scale: 1.12 } },
  // Raven
  { n: "The Void Wraith", u: "Vigil", t: "She keeps the darkness inside her because the alternative is worse.", g: ["titans", "cosmic"], s: [92, 68, 66, 60, 84, 96], ab: ["Soul Projection", "Dark Rift"], w: null, i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 0.96 } },
  // Zatanna
  { n: "The Runed Conjurer", u: "Vigil", t: "She speaks the words backwards and the world obeys.", g: ["justice-league", "cosmic"], s: [86, 64, 60, 58, 90, 98], ab: ["Inverted Verse", "Reality Banish"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "STAFF", scale: 0.97 } },
  // Darkseid
  { n: "The Obsidian Tyrant", u: "Vigil", t: "He is not conquering — he is solving an equation and the answer is subjugation.", g: ["villain", "cosmic", "leader"], s: [99, 76, 98, 84, 92, 96], ab: ["Disintegration Ray", "Warp Crash"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.18 } },
  // Joker
  { n: "The Hollow Trickster", u: "Vigil", t: "He has no plan because he does not need one to be the most dangerous thing in the room.", g: ["villain", "tactical"], s: [46, 58, 52, 70, 94, 90], ab: ["Toxin Dose", "Chaotic Variable"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "SLIGHT", prop: "STAFF", scale: 0.92 } },
  // Harley Quinn
  { n: "The Spark Brawler", u: "Vigil", t: "She is more dangerous than she looks, which is already saying something.", g: ["villain", "brawler", "mobility"], s: [56, 76, 62, 82, 78, 84], ab: ["Mallet Overhead", "Wild Tumble"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "HAMMER", scale: 0.95 } },
  // Deathstroke
  { n: "The Steel Assassin", u: "Vigil", t: "He fights with half a brain because he only needs half.", g: ["villain", "assassin", "tactical", "melee"], s: [72, 80, 78, 96, 92, 82], ab: ["Combat Foresight", "Blade and Barrel"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "BLADE", scale: 1.0 } },
  // Nightwing
  { n: "The Shadow Striker", u: "Vigil", t: "He left the shadow and became something all his own.", g: ["bat-family", "titans", "mobility", "melee"], s: [58, 82, 66, 92, 88, 80], ab: ["Escrima Flurry", "Aerial Takedown"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "NORMAL", prop: "BLADE", scale: 0.96 } },
  // Black Adam
  { n: "The Onyx Champion", u: "Vigil", t: "He carried the power for thousands of years and never called it a gift.", g: ["villain", "cosmic"], s: [96, 88, 94, 78, 76, 92], ab: ["Thunder Arc", "Judgment Dive"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "TOWERING", prop: "HAMMER", scale: 1.14 } },
  // Martian Manhunter
  { n: "The Ashen Wanderer", u: "Vigil", t: "He is the last of his kind, and he made peace with that so he could protect everyone else.", g: ["justice-league", "cosmic"], s: [94, 84, 92, 78, 94, 96], ab: ["Phase Shift", "Psi Sweep"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.08 } },
  // Catwoman
  { n: "The Dusk Rogue", u: "Vigil", t: "She decides what belongs to her and then walks through every lock between.", g: ["bat-family", "stealth", "mobility"], s: [46, 80, 56, 84, 84, 82], ab: ["Whip Snap", "Vanish Step"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "SLIGHT", prop: "BLADE", scale: 0.91 } },
  // Batgirl
  { n: "The Keen Operative", u: "Vigil", t: "She solved the case before putting on the suit.", g: ["bat-family", "tactical", "melee"], s: [50, 76, 58, 86, 92, 78], ab: ["Grapnel Shot", "Data Intercept"], w: null, i: { head: "HELM", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.94 } },
  // Red Hood
  { n: "The Crimson Enforcer", u: "Vigil", t: "He came back and decided the old rules were insufficient.", g: ["bat-family", "marksman", "ranged"], s: [58, 74, 70, 88, 82, 78], ab: ["Twin Sidearms", "No Quarter"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.97 } },
  // Robin
  { n: "The Swift Outlier", u: "Vigil", t: "He is underestimated exactly once per fight.", g: ["bat-family", "titans", "mobility"], s: [46, 76, 54, 82, 84, 74], ab: ["Staff Spin", "Feint Strike"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.89 } },
  // Lex Luthor
  { n: "The Gilded Broker", u: "Vigil", t: "He is not the most powerful person in the room — he just owns it.", g: ["villain", "tech", "tactical"], s: [76, 58, 80, 62, 99, 88], ab: ["Warsuit Deploy", "Tactical Edge"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "ORB", scale: 1.02 } },
  // Bane
  { n: "The Gale Enforcer", u: "Vigil", t: "He broke the thing that was supposed to be unbreakable and moved on.", g: ["villain", "brawler", "melee"], s: [86, 62, 88, 88, 86, 78], ab: ["Serum Surge", "Spine Slam"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "SHELL", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.14 } },
  // Poison Ivy
  { n: "The Stone Curator", u: "Vigil", t: "She grew a kingdom that the city keeps trying to pave over.", g: ["villain"], s: [80, 56, 62, 58, 88, 92], ab: ["Vine Ensnare", "Toxin Bloom"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.96 } },
  // Killer Croc
  { n: "The Feral Raider", u: "Vigil", t: "The sewers are his and he makes sure every visitor understands that.", g: ["villain", "brawler", "survival"], s: [84, 62, 90, 74, 48, 72], ab: ["Savage Crush", "Armored Hide"], w: null, va: "quadruped_large", i: { head: "CREST", back: "SPINES", marking: "STRIPES", build: "TOWERING", prop: "NONE", scale: 1.14 } },
  // Mr. Freeze
  { n: "The Frost Warden", u: "Vigil", t: "He froze his grief and built a weapon out of the cold.", g: ["villain", "tech", "ranged"], s: [78, 50, 80, 60, 92, 88], ab: ["Cryo Beam", "Ice Fortification"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "SPEAR", scale: 1.0 } },
  // Scarecrow
  { n: "The Pale Phantom", u: "Vigil", t: "He found the crack in every mind and learned to widen it.", g: ["villain", "stealth"], s: [48, 60, 52, 62, 92, 94], ab: ["Dread Toxin", "Waking Terror"], w: null, i: { head: "PLAIN", back: "MANE", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.90 } },
  // Ra's al Ghul
  { n: "The Jade Warlord", u: "Vigil", t: "He has had centuries to decide what the world owes and who will collect.", g: ["villain", "leader", "melee", "tactical"], s: [62, 70, 68, 92, 94, 84], ab: ["Immortal Blade", "Legion Decree"], w: null, i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "BLADE", scale: 0.99 } },
  // Doomsday
  { n: "The Void Berserker", u: "Vigil", t: "He cannot be killed the same way twice, and there are only so many ways.", g: ["villain", "brawler", "survival"], s: [99, 70, 99, 66, 34, 90], ab: ["Adaptation Spike", "Bone Cascade"], w: null, va: "humanoid_large", i: { head: "HORNS", back: "MANE", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.20 } },
  // Brainiac
  { n: "The Hollow Architect", u: "Vigil", t: "He catalogues worlds so he can be the only one left who remembers them.", g: ["villain", "tech", "cosmic"], s: [88, 66, 88, 60, 100, 94], ab: ["Shrink Protocol", "Drone Network"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 1.02 } },
  // Reverse-Flash
  { n: "The Amber Revenant", u: "Vigil", t: "He ran backward through time to make things worse.", g: ["villain", "mobility"], s: [82, 98, 68, 76, 90, 94], ab: ["Negative Surge", "Temporal Sabotage"], w: null, i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.93 } },
  // Sinestro
  { n: "The Crimson Tyrant", u: "Vigil", t: "He preaches order through fear because he thinks the math works out.", g: ["villain", "cosmic", "ranged"], s: [92, 80, 82, 74, 88, 94], ab: ["Dread Construct", "Fear Lattice"], w: null, i: { head: "PLAIN", back: "MANE", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 1.0 } },
  // Hawkman
  { n: "The Amber Cavalier", u: "Vigil", t: "Every life he has lived made him harder and every life added another grudge to settle.", g: ["justice-league", "melee", "mobility"], s: [82, 78, 84, 88, 74, 78], ab: ["Heavy Mace Strike", "Dive Assault"], w: null, va: "winged", i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "HAMMER", scale: 1.06 } },
  // Hawkgirl
  { n: "The Ivory Cavalier", u: "Vigil", t: "Wings and a mace — she needs nothing else and proved it repeatedly.", g: ["justice-league", "melee", "mobility"], s: [78, 82, 78, 86, 74, 78], ab: ["Mace Overhead", "Wing Gust"], w: null, va: "winged", i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "HAMMER", scale: 1.0 } },
  // Starfire
  { n: "The Ember Harbinger", u: "Vigil", t: "She arrived from the stars and chose to stay because of the people, not the planet.", g: ["titans", "cosmic", "ranged"], s: [88, 84, 84, 74, 70, 86], ab: ["Solar Burst", "Solar Charge"], w: null, va: "winged", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 1.0 } },
  // Beast Boy
  { n: "The Verdant Shapeshifter", u: "Vigil", t: "He has been every animal and remembers how all of them feel.", g: ["titans", "mobility"], s: [72, 80, 70, 72, 68, 92], ab: ["Beast Form", "Stampede Rush"], w: null, i: { head: "EARS", back: "FIN", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.95 } },
  // Cyborg Superman
  { n: "The Ashen Revenant", u: "Vigil", t: "He rebuilt himself from the wreckage and called what remained justice.", g: ["villain", "tech", "cosmic"], s: [92, 80, 94, 70, 92, 88], ab: ["Self-Repair Protocol", "Solar Discharge"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "TOWERING", prop: "SHIELD", scale: 1.14 } },
  // Steel
  { n: "The Iron Artificer", u: "Vigil", t: "He built the armor because the city needed something real to believe in.", g: ["justice-league", "tech", "melee"], s: [80, 62, 88, 78, 92, 74], ab: ["Hammer Toss", "Plating Seal"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "HAMMER", scale: 1.04 } },
  // Blue Beetle
  { n: "The Sapphire Sentinel", u: "Vigil", t: "The scarab chose him and he is still figuring out if he had a say.", g: ["justice-league", "tech", "ranged"], s: [82, 76, 82, 70, 82, 90], ab: ["Carapace Cannon", "Adaptive Plating"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "SHIELD", scale: 0.99 } },
  // Booster Gold
  { n: "The Gilded Wanderer", u: "Vigil", t: "He came from the future and nobody believes him, which suits him fine.", g: ["justice-league", "tech"], s: [72, 76, 78, 66, 78, 84], ab: ["Force Bubble", "Future Read"], w: null, i: { head: "HELM", back: "MANE", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.98 } },
  // John Constantine
  { n: "The Veiled Broker", u: "Vigil", t: "He walks the line between sacred and profane and owes favors to both sides.", g: ["tactical"], s: [70, 52, 50, 56, 96, 96], ab: ["Demon Bargain", "Binding Ward"], w: null, i: { head: "PLAIN", back: "SHELL", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.96 } },
  // Swamp Thing
  { n: "The Verdant Remnant", u: "Vigil", t: "The forest does not ask permission to reclaim what was taken.", g: ["survival"], s: [90, 48, 96, 66, 80, 92], ab: ["Root Eruption", "Regrowth Cycle"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "FIN", marking: "PLAIN", build: "TOWERING", prop: "NONE", scale: 1.16 } },
  // Etrigan
  { n: "The Cinder Tyrant", u: "Vigil", t: "He was bound to a man who hates him and the feeling is mutual.", g: ["villain", "brawler"], s: [90, 70, 88, 78, 76, 92], ab: ["Hellfire Breath", "Demon Ascent"], w: null, va: "humanoid_large", i: { head: "HORNS", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.08 } },
  // Deadman
  { n: "The Quiet Vagrant", u: "Vigil", t: "He is everywhere and nowhere, and he cannot leave until the job is done.", g: ["stealth"], s: [60, 76, 90, 54, 80, 96], ab: ["Possession Shift", "Intangible Pass"], w: null, i: { head: "PLAIN", back: "FIN", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.94 } },
  // Wonder Girl
  { n: "The Bronze Striker", u: "Vigil", t: "She does not yet know how strong she will become, which makes her unpredictable.", g: ["titans", "melee"], s: [84, 78, 82, 84, 72, 76], ab: ["Lasso Strike", "Amazon Rush"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "SPEAR", scale: 1.06 } },
  // Firestorm
  { n: "The Flame Conduit", u: "Vigil", t: "Two minds in one body and they only agree on one thing: the blast.", g: ["justice-league", "cosmic", "ranged"], s: [90, 76, 78, 62, 88, 94], ab: ["Transmutation Burst", "Fusion Blast"], w: null, va: "winged", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 1.0 } },
  // Vixen
  { n: "The Storm Vanguard", u: "Vigil", t: "She calls on every animal that ever lived and fights like all of them at once.", g: ["justice-league", "melee", "mobility"], s: [76, 82, 74, 84, 76, 88], ab: ["Totem Strike", "Beast Mimicry"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "SPEAR", scale: 0.97 } },
  // Captain Cold
  { n: "The Frost Raider", u: "Vigil", t: "He lives by a code because chaos never paid as well.", g: ["villain", "ranged", "tactical"], s: [70, 60, 66, 66, 86, 86], ab: ["Cold Discharge", "Outlaw Code"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "STAFF", scale: 0.99 } },
  // Black Canary
  { n: "The Keen Duelist", u: "Vigil", t: "The cry ends fights — the hands are for when it does not.", g: ["justice-league", "martial-arts", "ranged"], s: [60, 82, 64, 96, 78, 88], ab: ["Sonic Cry", "Brawling Combo"], w: null, i: { head: "PLAIN", back: "FIN", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 0.95 } },
  // Plastic Man
  { n: "The Hollow Bastion", u: "Vigil", t: "He is impossible to hurt because there is nothing solid left to hit.", g: ["justice-league", "mobility", "brawler"], s: [64, 76, 96, 72, 76, 96], ab: ["Elastic Form", "Shape Lock"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "SQUAT", prop: "NONE", scale: 0.96 } },
  // Lobo
  { n: "The Iron Marauder", u: "Vigil", t: "He breaks everything placed in his path and calls what's left freedom.", g: ["villain", "cosmic", "brawler"], s: [96, 80, 96, 88, 52, 74], ab: ["Savage Fury", "Undying Rush"], w: null, va: "humanoid_large", i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "TOWERING", prop: "HAMMER", scale: 1.16 } },
  // Wally West
  { n: "The Scarlet Pioneer", u: "Vigil", t: "He runs until the world slows down and the answers everyone else missed become plain.", g: ["justice-league", "speed", "mobility"], s: [74, 100, 66, 78, 74, 96], ab: ["Force Drain", "Infinite Velocity"], w: null, i: { head: "PLAIN", back: "SHELL", marking: "PLAIN", build: "SLIGHT", prop: "NONE", scale: 0.93 } },
  // Kyle Rayner
  { n: "The Cobalt Artisan", u: "Vigil", t: "He is the most creative ring-wielder alive because creativity is all he started with.", g: ["justice-league", "cosmic", "ranged"], s: [86, 84, 80, 76, 84, 96], ab: ["Spectrum Form", "Hard Light Array"], w: null, i: { head: "PLAIN", back: "SHELL", marking: "PLAIN", build: "NORMAL", prop: "ORB", scale: 1.0 } },
  // Azrael
  { n: "The Runed Enforcer", u: "Vigil", t: "The system that built him was designed for war and it worked too well.", g: ["batman-family", "melee", "brawler"], s: [74, 78, 74, 96, 76, 84], ab: ["Conditioned Strike", "Flame Blade"], w: null, i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "BLADE", scale: 1.0 } },
  // The Atom
  { n: "The Copper Vagrant", u: "Vigil", t: "He shrinks to subatomic and punches at his full weight — the math is devastating.", g: ["justice-league", "tactical", "mobility"], s: [68, 80, 70, 80, 92, 90], ab: ["Density Punch", "Scale Shift"], w: null, i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "SLIGHT", prop: "ORB", scale: 0.89 } },
  // Animal Man
  { n: "The Feral Catalyst", u: "Vigil", t: "He pulls from the whole animal kingdom at once and the math is overwhelming.", g: ["justice-league", "brawler", "mobility"], s: [82, 86, 78, 82, 72, 88], ab: ["Animal Draw", "Wild Aura"], w: null, i: { head: "PLAIN", back: "SPINES", marking: "PATCH", build: "NORMAL", prop: "STAFF", scale: 0.99 } },
  // Black Lightning
  { n: "The Storm Enforcer", u: "Vigil", t: "He came back to his hometown and decided to fix it himself.", g: ["justice-league", "ranged", "leader"], s: [72, 78, 72, 82, 82, 90], ab: ["Arc Discharge", "Electromagnetic Guard"], w: null, i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "STAFF", scale: 0.99 } },
  // Mister Miracle
  { n: "The Wicked Escapist", u: "Vigil", t: "No trap built by gods or men has held him longer than he allowed.", g: ["new-gods", "tactical", "mobility"], s: [72, 88, 80, 86, 84, 96], ab: ["Phase Vault", "Unshackled"], w: null, i: { head: "PLAIN", back: "CAPE", marking: "PLAIN", build: "NORMAL", prop: "BOW", scale: 0.98 } },
];
