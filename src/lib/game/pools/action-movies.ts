import type { PoolEntry } from "../types";

/**
 * ACTION MOVIES — stats in order: combat, speed, weapons, tactics, durability, special.
 *
 * The CHARACTER fights here, not the actor: `a` records who plays them and the
 * card shows both, so "Keanu Reeves" in the Hollywood category and "John Wick"
 * here are deliberately different entries with different numbers.
 *
 * `w` points at the character's own Wikipedia page where one exists and at the
 * film otherwise. Game ratings for DRAFT WAR, not an official ranking.
 */
export const ACTION_MOVIES: PoolEntry[] = [
  { n: "John Wick", w: "John Wick (character)", u: "John Wick", t: "The Baba Yaga", a: "Keanu Reeves", g: ["assassin", "revenge", "marksman", "melee"], s: [94, 88, 96, 84, 82, 94], ab: ["Gun Fu", "Pencil Work"] },
  { n: "Jason Bourne", w: "Jason Bourne (character)", u: "Bourne", t: "The erased asset", a: "Matt Damon", g: ["spy", "stealth", "tactical", "melee"], s: [92, 86, 82, 96, 82, 88], ab: ["Improvised Counter", "Countersurveillance"] },
  { n: "Ethan Hunt", u: "Mission: Impossible", t: "Your mission, should you choose", a: "Tom Cruise", g: ["spy", "mobility", "tactical"], s: [86, 90, 82, 94, 78, 92], ab: ["Impossible Climb", "Mask Swap"] },
  { n: "James Bond", u: "James Bond", v: "Craig era", t: "Licence to kill", a: "Daniel Craig", g: ["spy", "marksman", "tactical"], s: [86, 82, 90, 92, 80, 88], ab: ["Walther PPK", "Q Branch Gadget"] },
  { n: "Tyler Rake", w: "Extraction (2020 film)", u: "Extraction", t: "The one who goes in", a: "Chris Hemsworth", g: ["military", "survival", "melee", "brawler"], s: [90, 82, 88, 76, 92, 84], ab: ["Corridor Clear", "Take the Hit"] },
  { n: "John Rambo", w: "John Rambo", u: "Rambo", t: "They drew first blood", a: "Sylvester Stallone", g: ["military", "survival", "ranged", "veteran"], s: [88, 76, 92, 82, 94, 86], ab: ["Trap Line", "Bow Kill"] },
  { n: "Frank Martin", w: "The Transporter", u: "The Transporter", t: "Three rules", a: "Jason Statham", g: ["martial-arts", "mobility", "melee"], s: [86, 84, 72, 80, 78, 80], ab: ["Oil Slick Fight", "Precision Driving"] },
  { n: "Robert McCall", w: "The Equalizer (film)", u: "The Equalizer", t: "Twenty-nine seconds", a: "Denzel Washington", g: ["assassin", "tactical", "melee", "stealth"], s: [92, 76, 84, 96, 82, 90], ab: ["Hardware Store", "Clock Read"] },
  { n: "Bryan Mills", w: "Taken (film)", u: "Taken", t: "A particular set of skills", a: "Liam Neeson", g: ["spy", "revenge", "tactical", "marksman"], s: [82, 70, 82, 90, 76, 76], ab: ["Phone Trace", "Interrogation"] },
  { n: "Beatrix Kiddo", w: "The Bride (Kill Bill)", u: "Kill Bill", t: "The bride", a: "Uma Thurman", g: ["assassin", "revenge", "martial-arts", "melee"], s: [90, 84, 80, 78, 80, 88], ab: ["Hattori Hanzo Blade", "Five Point Palm"] },
  { n: "Rama", w: "The Raid (2011 film)", u: "The Raid", t: "Twenty floors up", a: "Iko Uwais", g: ["martial-arts", "military", "melee", "mobility"], s: [96, 92, 66, 74, 84, 90], ab: ["Silat Chain", "Stairwell Rush"] },
  { n: "Dutch Schaefer", w: "Predator (film)", u: "Predator", t: "Get to the chopper", a: "Arnold Schwarzenegger", g: ["military", "survival", "leader", "ranged"], s: [78, 64, 88, 82, 86, 76], ab: ["Mud Camouflage", "Suppressing Fire"] },
  { n: "John Matrix", w: "Commando (1985 film)", u: "Commando", t: "A one man army", a: "Arnold Schwarzenegger", g: ["military", "brawler", "ranged", "revenge"], s: [80, 62, 90, 70, 88, 74], ab: ["Armoury Dump", "Phone Booth Rip"] },
  { n: "Léon", w: "Léon: The Professional", u: "Léon", t: "The cleaner", a: "Jean Reno", g: ["assassin", "stealth", "marksman", "tactical"], s: [86, 78, 94, 92, 74, 90], ab: ["Silent Setup", "Room Sweep"] },
  { n: "Chev Chelios", w: "Crank (2006 film)", u: "Crank", t: "Keep the heart rate up", a: "Jason Statham", g: ["brawler", "mobility", "melee"], s: [82, 90, 72, 62, 76, 92], ab: ["Adrenaline Spike", "Redline"] },
  { n: "Snake Plissken", w: "Snake Plissken", u: "Escape from New York", t: "I thought you were dead", a: "Kurt Russell", g: ["survival", "stealth", "ranged", "revenge"], s: [78, 70, 84, 86, 78, 80], ab: ["Countdown Bluff", "Glider Entry"] },
  { n: "Ellen Ripley", u: "Alien", t: "Get away from her", a: "Sigourney Weaver", g: ["survival", "tactical", "ranged", "military"], s: [66, 66, 82, 92, 80, 84], ab: ["Power Loader", "Airlock Play"] },
  { n: "Sarah Connor", w: "Sarah Connor (Terminator)", u: "Terminator", t: "No fate but what we make", a: "Linda Hamilton", g: ["survival", "military", "ranged", "tactical"], s: [72, 70, 84, 86, 78, 76], ab: ["Prepper Cache", "Shotgun Reload"] },
  { n: "John McClane", u: "Die Hard", t: "Yippee-ki-yay", a: "Bruce Willis", g: ["survival", "tactical", "brawler", "marksman"], s: [78, 70, 84, 92, 90, 86], ab: ["Barefoot Escape", "Vent Crawl"] },
  { n: "Martin Riggs", w: "Martin Riggs", u: "Lethal Weapon", t: "The lethal one", a: "Mel Gibson", g: ["martial-arts", "marksman", "melee"], s: [84, 78, 84, 72, 78, 78], ab: ["Jujitsu Lock", "Trick Shot"] },
  { n: "Neo", w: "Neo (The Matrix)", u: "The Matrix", t: "The One", a: "Keanu Reeves", g: ["martial-arts", "mobility", "melee"], s: [92, 96, 78, 82, 88, 98], ab: ["Bullet Time", "Rewrite the Rules"] },
  { n: "Trinity", w: "Trinity (The Matrix)", u: "The Matrix", t: "Dodge this", a: "Carrie-Anne Moss", g: ["martial-arts", "mobility", "marksman", "stealth"], s: [82, 88, 84, 80, 70, 84], ab: ["Wire Kick", "Dual Pistols"] },
  { n: "Max Rockatansky", u: "Mad Max", v: "Fury Road", t: "The road warrior", a: "Tom Hardy", g: ["survival", "mobility", "brawler"], s: [78, 76, 78, 78, 86, 78], ab: ["Vehicle Fight", "Blood Bag"] },
  { n: "Imperator Furiosa", u: "Mad Max", v: "Fury Road", t: "Witness her", a: "Charlize Theron", g: ["survival", "military", "leader", "ranged"], s: [82, 76, 84, 86, 80, 80], ab: ["War Rig", "One Arm Shot"] },
  { n: "T-800", w: "Terminator (character)", u: "Terminator", t: "It absolutely will not stop", a: "Arnold Schwarzenegger", g: ["military", "survival", "ranged", "brawler"], s: [86, 68, 92, 78, 98, 88], ab: ["Endoskeleton", "Target Lock"] },
  { n: "Blade", w: "Blade (character)", u: "Blade", t: "The daywalker", a: "Wesley Snipes", g: ["martial-arts", "assassin", "melee", "revenge"], s: [88, 84, 82, 74, 84, 88], ab: ["Silver Blade", "Glaive Throw"] },
  { n: "Riddick", w: "Riddick (character)", u: "Riddick", t: "You are not afraid of the dark", a: "Vin Diesel", g: ["survival", "stealth", "brawler", "melee"], s: [86, 78, 74, 80, 86, 88], ab: ["Eyeshine", "Ambush Kill"] },
  { n: "Nikita", w: "La Femme Nikita (film)", u: "Nikita", t: "Made, not born", a: "Anne Parillaud", g: ["assassin", "spy", "stealth", "marksman"], s: [80, 80, 82, 80, 68, 80], ab: ["Cover Identity", "Kitchen Exit"] },
  { n: "Evelyn Salt", w: "Salt (2010 film)", u: "Salt", t: "Who is Salt", a: "Angelina Jolie", g: ["spy", "stealth", "mobility", "tactical"], s: [80, 84, 76, 86, 72, 82], ab: ["Improvised Chemistry", "Truck Leap"] },
  { n: "Lorraine Broughton", w: "Atomic Blonde", u: "Atomic Blonde", t: "Berlin, ice cold", a: "Charlize Theron", g: ["spy", "martial-arts", "melee", "stealth"], s: [88, 78, 76, 84, 80, 82], ab: ["Stairwell Fight", "Cable Choke"] },
];
