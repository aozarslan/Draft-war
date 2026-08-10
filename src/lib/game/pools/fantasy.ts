import type { PoolEntry } from "../types";

/**
 * FANTASY — stats in order: power, speed, durability, combat, magic, special.
 *
 * Balance intent: magic users hit hardest but fold under pressure, warriors
 * grind, and the monsters sit at the top of durability. Game ratings for
 * DRAFT WAR, not an official ranking.
 */
export const FANTASY: PoolEntry[] = [
  { n: "Gandalf", u: "The Lord of the Rings", t: "You shall not pass", g: ["fellowship", "mage", "leader", "tactical"], s: [88, 62, 74, 78, 96, 94], ab: ["Staff Light", "Word of Command"] },
  { n: "Aragorn", u: "The Lord of the Rings", t: "The king returns", g: ["fellowship", "royal", "melee", "leader"], s: [70, 76, 76, 94, 30, 78], ab: ["Andúril", "Rally the Host"] },
  { n: "Legolas", u: "The Lord of the Rings", t: "Elven eyes", g: ["fellowship", "marksman", "mobility", "ranged"], s: [62, 92, 62, 88, 34, 84], ab: ["Impossible Shot", "Shield Surf"] },
  { n: "Gimli", u: "The Lord of the Rings", t: "And my axe", g: ["fellowship", "brawler", "melee", "survival"], s: [78, 54, 88, 86, 20, 68], ab: ["Axe Cleave", "Dwarven Endurance"] },
  { n: "Sauron", u: "The Lord of the Rings", t: "The dark lord", g: ["monster", "mage", "royal"], s: [96, 66, 94, 88, 98, 96], ab: ["The One Ring", "Mace Sweep"] },
  { n: "Saruman", u: "The Lord of the Rings", t: "The white hand", g: ["mage", "leader"], s: [82, 56, 66, 62, 92, 86], ab: ["Voice of Saruman", "Storm Call"] },
  { n: "Galadriel", u: "The Lord of the Rings", t: "Lady of Lothlórien", g: ["mage", "royal"], s: [86, 62, 62, 52, 96, 92], ab: ["Mirror Sight", "Light of Eärendil"] },
  { n: "Witch-king of Angmar", w: "Witch-king of Angmar", u: "The Lord of the Rings", t: "No man can kill me", g: ["monster", "mage", "melee"], s: [88, 72, 90, 88, 84, 90], ab: ["Morgul Blade", "Fell Beast"] },
  { n: "Balrog", u: "The Lord of the Rings", t: "A demon of the ancient world", g: ["monster", "dragon"], s: [96, 66, 96, 82, 80, 92], ab: ["Flame Whip", "Shadow and Flame"] },
  { n: "Smaug", u: "The Hobbit", t: "The last great fire drake", g: ["monster", "dragon"], s: [98, 82, 96, 76, 74, 96], ab: ["Dragon Fire", "Scaled Hide"] },
  { n: "Elrond", u: "The Lord of the Rings", t: "Lord of Rivendell", g: ["mage", "royal", "melee"], s: [76, 74, 72, 86, 84, 78], ab: ["Elven Blade", "Flood the Ford"] },
  { n: "Éowyn", u: "The Lord of the Rings", t: "I am no man", g: ["royal", "melee"], s: [64, 74, 68, 84, 20, 88], ab: ["Shieldmaiden", "Slay the Nazgûl"] },
  { n: "Jon Snow", w: "Jon Snow (character)", u: "A Song of Ice and Fire", t: "The bastard of Winterfell", g: ["royal", "melee", "leader", "survival"], s: [66, 74, 74, 86, 18, 74], ab: ["Longclaw", "Hold the Wall"] },
  { n: "Arya Stark", u: "A Song of Ice and Fire", t: "A girl has no name", g: ["stealth", "assassin", "mobility"], s: [46, 88, 52, 86, 30, 92], ab: ["Faceless Disguise", "Needle"] },
  { n: "Daenerys Targaryen", u: "A Song of Ice and Fire", t: "Mother of dragons", g: ["royal", "dragon", "leader"], s: [82, 52, 62, 38, 72, 94], ab: ["Dracarys", "Unburnt"] },
  { n: "Gregor Clegane", u: "A Song of Ice and Fire", t: "The Mountain", g: ["monster", "brawler", "melee"], s: [92, 44, 92, 84, 10, 70], ab: ["Greatsword", "Unstoppable"] },
  { n: "Brienne of Tarth", u: "A Song of Ice and Fire", t: "Sworn sword", g: ["melee", "survival"], s: [76, 66, 82, 90, 12, 70], ab: ["Oathkeeper", "Guard Stance"] },
  { n: "Geralt of Rivia", u: "The Witcher", t: "The white wolf", g: ["monster", "melee", "mage", "survival"], s: [78, 84, 82, 94, 66, 88], ab: ["Igni Sign", "Silver Sword"] },
  { n: "Yennefer of Vengerberg", w: "Yennefer of Vengerberg", u: "The Witcher", t: "Chaos on a leash", g: ["mage"], s: [86, 62, 58, 48, 94, 90], ab: ["Portal", "Chaos Bolt"] },
  { n: "Ciri", u: "The Witcher", t: "The lady of space and time", g: ["mage", "mobility", "melee", "royal"], s: [84, 92, 68, 84, 82, 96], ab: ["Blink", "Elder Blood"] },
  { n: "Merlin", u: "Arthurian legend", t: "The first wizard", g: ["mage", "tactical"], s: [84, 48, 58, 46, 96, 92], ab: ["Prophecy", "Binding Spell"] },
  { n: "Conan the Barbarian", w: "Conan the Barbarian", u: "Conan", t: "Steel and will", g: ["melee", "brawler", "survival"], s: [86, 76, 84, 92, 14, 76], ab: ["Atlantean Sword", "Rage"] },
  { n: "Beowulf", u: "Beowulf", t: "The hero of the Geats", g: ["melee", "brawler", "royal"], s: [84, 68, 86, 88, 16, 74], ab: ["Bare Handed", "Hero's Grip"] },
  { n: "Morgan le Fay", w: "Morgan le Fay", u: "Arthurian legend", t: "The enchantress", g: ["mage", "royal"], s: [80, 58, 58, 46, 92, 90], ab: ["Glamour", "Curse"] },
];
