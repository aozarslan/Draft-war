import type { PoolEntry } from "../types";

/**
 * HOLLYWOOD — stats in order: strength, speed, combat, weapons, tactics, stamina.
 *
 * THESE ARE REAL PEOPLE. The numbers describe the kind of action role each
 * performer is publicly known for — a martial-arts lead scores high on combat,
 * a gun-fu lead high on weapons — and nothing else. They are a game score for
 * DRAFT WAR, not a judgement about anybody and not a claim about real ability.
 *
 * Balance intent: the band is deliberately human, roughly 45-92. Nobody in this
 * category gets a superhero number; that is what keeps a Hollywood game about
 * matchups instead of one obvious pick.
 */
export const HOLLYWOOD: PoolEntry[] = [
  { n: "Tom Cruise", u: "Hollywood", t: "Does his own stunts", g: ["veteran", "gunplay", "mobility", "tactical"], s: [70, 88, 78, 84, 88, 92], ab: ["Stunt Run", "Halo Jump"] },
  { n: "Jason Statham", u: "Hollywood", t: "The reliable brawler", g: ["martial-arts", "gunplay", "melee"], s: [78, 84, 90, 86, 82, 86], ab: ["Close Quarters", "Improvised Weapon"] },
  { n: "Dwayne Johnson", u: "Hollywood", t: "The people's action star", g: ["muscle", "wrestler", "brawler"], s: [94, 70, 78, 72, 76, 84], ab: ["Power Slam", "Crowd Presence"] },
  { n: "Chris Hemsworth", u: "Hollywood", t: "Blockbuster heavyweight", g: ["muscle", "melee"], s: [86, 72, 74, 72, 72, 80], ab: ["Hammer Swing", "Big Screen Charge"] },
  { n: "Henry Cavill", u: "Hollywood", t: "The reload", g: ["muscle", "gunplay", "melee"], s: [86, 74, 80, 86, 78, 80], ab: ["Arm Reload", "Sword Form"] },
  { n: "Keanu Reeves", u: "Hollywood", t: "Gun-fu incarnate", g: ["gunplay", "martial-arts", "marksman"], s: [70, 82, 88, 94, 84, 84], ab: ["Tactical Reload", "Judo Gunplay"] },
  { n: "Donnie Yen", u: "Hollywood", t: "Wing Chun on film", g: ["martial-arts", "melee", "veteran"], s: [74, 90, 95, 70, 82, 86], ab: ["Chain Punch", "Blade Form"] },
  { n: "Jet Li", u: "Hollywood", t: "Wushu champion turned star", g: ["martial-arts", "melee", "veteran", "mobility"], s: [66, 90, 92, 64, 78, 80], ab: ["Wushu Flow", "Weapon Forms"] },
  { n: "Jackie Chan", u: "Hollywood", t: "The environment is the weapon", g: ["martial-arts", "veteran", "mobility", "environment"], s: [70, 86, 90, 62, 86, 88], ab: ["Prop Fighting", "Acrobatic Escape"] },
  { n: "Scott Adkins", u: "Hollywood", t: "The martial arts machine", g: ["martial-arts", "melee", "mobility"], s: [80, 90, 93, 70, 74, 88], ab: ["Spinning Kick", "Fight Choreography"] },
  { n: "Jean-Claude Van Damme", u: "Hollywood", t: "The muscles from Brussels", g: ["martial-arts", "veteran", "melee"], s: [76, 82, 86, 62, 68, 76], ab: ["Split Kick", "Kickboxing"] },
  { n: "Wesley Snipes", u: "Hollywood", t: "Blade sharp", g: ["martial-arts", "melee", "gunplay"], s: [74, 84, 86, 80, 76, 80], ab: ["Blade Work", "Vertical Takedown"] },
  { n: "Arnold Schwarzenegger", u: "Hollywood", t: "The original heavyweight", g: ["muscle", "veteran", "gunplay", "ranged"], s: [95, 58, 74, 90, 78, 82], ab: ["Minigun", "One Liner"] },
  { n: "Sylvester Stallone", u: "Hollywood", t: "The one who keeps going", g: ["muscle", "veteran", "survival", "gunplay"], s: [90, 60, 80, 86, 76, 92], ab: ["Last Round", "Survival Instinct"] },
  { n: "Bruce Willis", u: "Hollywood", t: "Yippee-ki-yay", g: ["veteran", "gunplay", "survival", "tactical"], s: [72, 58, 68, 84, 86, 82], ab: ["Barefoot Escape", "Improvised Plan"] },
  { n: "Liam Neeson", u: "Hollywood", t: "A very particular set of skills", g: ["veteran", "gunplay", "tactical"], s: [70, 56, 74, 82, 90, 72], ab: ["Interrogation", "Cold Pursuit"] },
  { n: "John Cena", u: "Hollywood", t: "From the ring to the screen", g: ["wrestler", "muscle", "brawler"], s: [92, 66, 78, 70, 70, 86], ab: ["Attitude Adjustment", "Never Give Up"] },
  { n: "Dave Bautista", u: "Hollywood", t: "The heavy with timing", g: ["wrestler", "muscle", "brawler"], s: [93, 64, 80, 70, 74, 82], ab: ["Bomb Drop", "Deadpan Counter"] },
  { n: "Michael B. Jordan", u: "Hollywood", t: "In fighting shape", g: ["muscle", "melee", "brawler"], s: [80, 78, 82, 60, 74, 84], ab: ["Boxing Combination", "Southpaw"] },
  { n: "Idris Elba", u: "Hollywood", t: "The commanding presence", g: ["veteran", "gunplay", "tactical", "leader"], s: [78, 66, 70, 78, 86, 76], ab: ["Command Voice", "Cold Read"] },
  { n: "Tony Jaa", u: "Hollywood", t: "Muay Thai on camera", g: ["martial-arts", "melee", "mobility"], s: [74, 90, 92, 56, 68, 84], ab: ["Flying Knee", "Elbow Strike"] },
  { n: "Iko Uwais", u: "Hollywood", t: "Silat, at speed", g: ["martial-arts", "melee", "mobility"], s: [74, 92, 95, 66, 72, 88], ab: ["Silat Flow", "Corridor Fight"] },
  { n: "Michelle Yeoh", u: "Hollywood", t: "Wire work and gravitas", g: ["martial-arts", "veteran", "melee", "tactical"], s: [60, 82, 88, 66, 88, 78], ab: ["Wire Form", "Blade Dance"] },
  { n: "Charlize Theron", u: "Hollywood", t: "Bruising and precise", g: ["martial-arts", "melee", "gunplay"], s: [70, 84, 88, 80, 84, 84], ab: ["Stairwell Fight", "Cable Choke"] },
  { n: "Gal Gadot", u: "Hollywood", t: "Blockbuster poise", g: ["melee", "veteran"], s: [66, 74, 70, 68, 72, 72], ab: ["Shield Guard", "Charge"] },
  { n: "Uma Thurman", u: "Hollywood", t: "The blade movie lead", g: ["martial-arts", "melee", "revenge"], s: [60, 78, 82, 74, 80, 76], ab: ["Katana Form", "Roaring Rampage"] },
  { n: "Milla Jovovich", u: "Hollywood", t: "Franchise survivor", g: ["gunplay", "mobility", "survival"], s: [60, 80, 78, 84, 74, 80], ab: ["Dual Wield", "Clear the Room"] },
  { n: "Sigourney Weaver", u: "Hollywood", t: "The original final girl", g: ["veteran", "survival", "tactical", "ranged"], s: [62, 56, 60, 80, 90, 74], ab: ["Loader Suit", "Hold the Line"] },
  { n: "Vin Diesel", u: "Hollywood", t: "Family, and horsepower", g: ["muscle", "brawler", "leader"], s: [90, 66, 74, 72, 72, 80], ab: ["Ram Charge", "Crew Call"] },
  { n: "Mark Wahlberg", u: "Hollywood", t: "The blue-collar lead", g: ["muscle", "gunplay", "military"], s: [78, 70, 74, 80, 74, 78], ab: ["Marksman Training", "Grit"] },
  { n: "Matt Damon", u: "Hollywood", t: "The thinking operative", g: ["gunplay", "tactical", "stealth"], s: [68, 78, 82, 76, 90, 82], ab: ["Improvised Counter", "Tradecraft"] },
  { n: "Daniel Craig", u: "Hollywood", t: "The blunt instrument", g: ["gunplay", "tactical", "veteran"], s: [80, 74, 82, 88, 88, 84], ab: ["Parkour Chase", "Sidearm"] },
  { n: "Tom Hardy", u: "Hollywood", t: "The intense one", g: ["muscle", "brawler", "melee"], s: [84, 70, 80, 68, 78, 82], ab: ["Clinch Work", "Mask Menace"] },
  { n: "Hugh Jackman", u: "Hollywood", t: "Two decades of claws", g: ["muscle", "melee", "veteran"], s: [82, 72, 78, 64, 74, 84], ab: ["Berserker Take", "Stage Stamina"] },
  { n: "Chris Evans", u: "Hollywood", t: "The shield carrier", g: ["muscle", "melee", "leader"], s: [80, 74, 78, 68, 78, 80], ab: ["Shield Form", "Squad Lead"] },
  { n: "Ryan Reynolds", u: "Hollywood", t: "Quips and choreography", g: ["gunplay", "melee", "mobility"], s: [66, 76, 74, 76, 74, 74], ab: ["Motormouth", "Dual Katana"] },
  { n: "Chuck Norris", u: "Hollywood", t: "The legend himself", g: ["martial-arts", "veteran", "melee"], s: [76, 70, 86, 72, 72, 76], ab: ["Roundhouse", "Tournament Pedigree"] },
  { n: "Sammo Hung", u: "Hollywood", t: "Heavy and impossibly fast", g: ["martial-arts", "veteran", "brawler"], s: [84, 78, 90, 60, 80, 74], ab: ["Ground Control", "Choreography Mind"] },
  { n: "Maggie Q", u: "Hollywood", t: "Trained on set", g: ["martial-arts", "gunplay", "stealth"], s: [56, 80, 80, 78, 78, 76], ab: ["Wire Kick", "Infiltrate"] },
  { n: "Zoe Saldana", u: "Hollywood", t: "The franchise fighter", g: ["melee", "mobility", "gunplay"], s: [60, 78, 76, 72, 74, 76], ab: ["Blade Spin", "Zero G Move"] },
];
