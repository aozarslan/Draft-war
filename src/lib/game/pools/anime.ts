import type { PoolEntry } from "../types";

/**
 * ANIME — stats in order: power, speed, durability, combat, intelligence, special.
 *
 * Balance intent: shonen escalation is compressed on purpose. The top of the
 * scale (Goku, Saitama, Gojo) sits in the low-to-mid 90s rather than running
 * away with the game, and the tacticians (Levi, Killua, Edward) stay
 * competitive through combat and intelligence. Game ratings for DRAFT WAR,
 * not an official ranking.
 */
export const ANIME: PoolEntry[] = [
  { n: "Goku", u: "Dragon Ball", t: "The saiyan who keeps climbing", g: ["martial-arts", "melee", "brawler"], s: [98, 96, 92, 96, 62, 94], ab: ["Kamehameha", "Ultra Instinct"] },
  { n: "Vegeta", u: "Dragon Ball", t: "The prince of all saiyans", g: ["martial-arts", "melee", "villain"], s: [95, 92, 90, 94, 76, 90], ab: ["Final Flash", "Pride Surge"] },
  { n: "Frieza", u: "Dragon Ball", t: "The emperor", g: ["villain"], s: [92, 92, 86, 82, 86, 90], ab: ["Death Beam", "Golden Form"] },
  { n: "Naruto Uzumaki", u: "Naruto", t: "Believe it", g: ["ninja", "brawler", "leader"], s: [92, 88, 88, 84, 62, 94], ab: ["Rasengan", "Shadow Clones"] },
  { n: "Sasuke Uchiha", u: "Naruto", t: "The last Uchiha", g: ["ninja", "swordsman", "villain"], s: [90, 90, 80, 90, 86, 94], ab: ["Chidori", "Sharingan"] },
  { n: "Madara Uchiha", u: "Naruto", t: "The legend of the warring states", g: ["ninja", "villain", "swordsman"], s: [94, 90, 88, 94, 90, 96], ab: ["Susanoo", "Perfect Sharingan"] },
  { n: "Kakashi Hatake", u: "Naruto", t: "The copy ninja", g: ["ninja", "tactical", "stealth"], s: [76, 82, 70, 88, 92, 84], ab: ["Copy Wheel Eye", "Lightning Blade"] },
  { n: "Monkey D. Luffy", u: "One Piece", t: "The future pirate king", g: ["pirate", "brawler", "leader"], s: [92, 86, 94, 86, 52, 94], ab: ["Gear Fourth", "Rubber Body"] },
  { n: "Roronoa Zoro", u: "One Piece", t: "Three swords", g: ["pirate", "swordsman", "melee"], s: [86, 80, 88, 94, 52, 86], ab: ["Three Sword Style", "Iron Body"] },
  { n: "Ichigo Kurosaki", u: "Bleach", t: "Substitute soul reaper", g: ["swordsman", "melee"], s: [88, 88, 82, 86, 58, 90], ab: ["Getsuga Tenshou", "Bankai"] },
  { n: "Eren Yeager", u: "Attack on Titan", t: "The one who moves forward", g: ["villain", "brawler"], s: [86, 64, 88, 70, 78, 88], ab: ["Titan Shift", "Hardening"] },
  { n: "Levi Ackerman", u: "Attack on Titan", t: "Humanity's strongest soldier", g: ["swordsman", "mobility", "tactical"], s: [58, 94, 64, 96, 86, 82], ab: ["ODM Gear", "Blade Spin"] },
  { n: "Saitama", w: "Saitama (One-Punch Man)", u: "One-Punch Man", t: "One punch", g: ["brawler", "melee"], s: [100, 94, 96, 70, 50, 92], ab: ["Serious Punch", "Consecutive Normal Punches"] },
  { n: "Tanjiro Kamado", u: "Demon Slayer", t: "The kind blade", g: ["swordsman", "hunter", "melee"], s: [70, 80, 72, 84, 80, 82], ab: ["Water Breathing", "Sun Breathing"] },
  { n: "Satoru Gojo", w: "Satoru Gojo", u: "Jujutsu Kaisen", t: "The strongest sorcerer", g: ["hunter", "tactical"], s: [96, 94, 86, 86, 92, 98], ab: ["Limitless", "Hollow Purple"] },
  { n: "Killua Zoldyck", u: "Hunter × Hunter", t: "The assassin child", g: ["hunter", "assassin", "mobility", "stealth"], s: [74, 92, 66, 88, 90, 86], ab: ["Godspeed", "Lightning Palm"] },
  { n: "Gon Freecss", u: "Hunter × Hunter", t: "The boy who never quits", g: ["hunter", "brawler", "melee"], s: [78, 78, 76, 80, 64, 86], ab: ["Jajanken", "Adaptation"] },
  { n: "Hisoka Morow", w: "List of Hunter × Hunter characters", u: "Hunter × Hunter", t: "The magician", g: ["hunter", "villain", "tactical"], s: [76, 84, 72, 90, 92, 90], ab: ["Bungee Gum", "Texture Surprise"] },
  { n: "Edward Elric", u: "Fullmetal Alchemist", t: "The fullmetal alchemist", g: ["tactical", "melee"], s: [70, 76, 72, 82, 94, 86], ab: ["Transmutation", "Automail Blade"] },
  { n: "Guts", w: "Guts (Berserk)", u: "Berserk", t: "The black swordsman", g: ["swordsman", "brawler", "melee"], s: [90, 76, 94, 96, 78, 88], ab: ["Dragonslayer", "Berserker Armour"] },
  { n: "All Might", u: "My Hero Academia", t: "I am here", g: ["brawler", "leader", "melee"], s: [94, 88, 88, 84, 74, 88], ab: ["Detroit Smash", "One For All"] },
  { n: "Shoto Todoroki", u: "My Hero Academia", t: "Ice and fire", g: ["hunter", "ranged"], s: [82, 74, 72, 72, 80, 86], ab: ["Flashfreeze", "Heat Wave"] },
];
