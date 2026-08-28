import type { PoolEntry } from "../types";

/**
 * FOOTBALL — stats in order: finishing, vision, pace, physical, technique,
 * composure.
 *
 * **These are invented people.** Global football keeps producing the same
 * handful of roles — the tiny playmaker who sees the pass nobody else does,
 * the towering finisher, the wall at the back — and those *roles* are what a
 * table argues about. So the roles are what this pool contains: original
 * characters built to read as an archetype, with no real athlete's name, face,
 * hair, kit, club, badge or celebration anywhere in them. `w: null` on every
 * entry keeps the Wikipedia enricher away from them for the same reason.
 *
 * Nationality words appear as *cultural* shorthand — "The Argentine Maestro"
 * names a style of football, the way "spaghetti western" names a style of
 * film. Palettes take a hint from national colours and stop there: no jersey
 * design, no crest, no sponsor.
 *
 * Every rating is a GAME RATING invented for DRAFT WAR. Nothing here describes
 * a real person, because there is no real person here to describe.
 */
export const FOOTBALL: PoolEntry[] = [
  {
    n: "The Argentine Maestro", w: null, u: "Original", t: "Sees the pass before it exists",
    g: ["playmaker", "technical", "midfielder"],
    s: [84, 98, 70, 42, 97, 92],
    ab: ["Impossible Angle", "Weight of Pass"],
    nick: "THE MAESTRO", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "PATCH", build: "SLIGHT", prop: "BALL", scale: 0.88 },
  },
  {
    n: "The Portuguese Machine", w: null, u: "Original", t: "Turns space into a weapon",
    g: ["striker", "physical", "speed", "aerial"],
    s: [96, 70, 90, 92, 82, 88],
    ab: ["Hang Time", "Second Effort"],
    nick: "THE MACHINE", va: "humanoid_large",
    i: { head: "PLAIN", back: "NONE", marking: "STRIPES", build: "TOWERING", prop: "BALL", scale: 1.02 },
  },
  {
    n: "The Brazilian Showman", w: null, u: "Original", t: "Beats you, then beats you again",
    g: ["flair", "technical", "speed", "playmaker"],
    s: [80, 88, 88, 58, 97, 66],
    ab: ["Elastico", "Draw the Foul"],
    nick: "THE SHOWMAN", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "SPOTS", build: "NORMAL", prop: "BALL", scale: 0.96 },
  },
  {
    n: "The French Phenom", w: null, u: "Original", t: "Gone before the defender turns",
    g: ["striker", "speed", "finisher"],
    s: [92, 72, 99, 66, 86, 82],
    ab: ["First Ten Yards", "Cut Inside"],
    nick: "THE PHENOM", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "STRIPES", build: "SLIGHT", prop: "BALL", scale: 0.94 },
  },
  {
    n: "The Northern Viking", w: null, u: "Original", t: "Arrives like weather",
    g: ["striker", "physical", "finisher", "aerial"],
    s: [95, 62, 84, 97, 70, 86],
    ab: ["Shoulder Charge", "Near Post Run"],
    nick: "THE VIKING", va: "humanoid_large",
    i: { head: "PLAIN", back: "MANE", marking: "PLAIN", build: "TOWERING", prop: "BALL", scale: 1.10 },
  },
  {
    n: "The Spanish Conductor", w: null, u: "Original", t: "Sets the tempo and never loses it",
    g: ["playmaker", "technical", "tactical", "midfielder"],
    s: [62, 96, 58, 44, 94, 95],
    ab: ["Half Turn", "Third Man Run"],
    nick: "THE CONDUCTOR", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "BANDS", build: "SQUAT", prop: "BALL", scale: 0.90 },
  },
  {
    n: "The German Engine", w: null, u: "Original", t: "Still running in the ninetieth minute",
    g: ["midfielder", "tactical", "physical"],
    s: [76, 92, 82, 82, 80, 90],
    ab: ["Counter Press", "Late Arrival"],
    nick: "THE ENGINE", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "BALL", scale: 1.00 },
  },
  {
    n: "The Italian Wall", w: null, u: "Original", t: "Reads the striker's mind, then his feet",
    g: ["defender", "defensive", "physical", "tactical"],
    s: [40, 82, 52, 95, 64, 94],
    ab: ["Anticipation", "Body Between"],
    nick: "THE WALL", va: "humanoid_large",
    i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "SHIELD", scale: 1.02 },
  },
  {
    n: "The South American Keeper", w: null, u: "Original", t: "The last argument",
    g: ["keeper", "defensive", "tactical"],
    s: [20, 80, 56, 88, 72, 97],
    ab: ["Spread the Frame", "Command the Box"],
    nick: "THE KEEPER", va: "humanoid_large",
    i: { head: "HELM", back: "NONE", marking: "PATCH", build: "HEAVY", prop: "SHIELD", scale: 0.98 },
  },
  {
    n: "The Continental Architect", w: null, u: "Original", t: "Builds the game from the back",
    g: ["playmaker", "tactical", "technical", "midfielder"],
    s: [58, 97, 64, 58, 92, 94],
    ab: ["Line Breaker", "Switch of Play"],
    nick: "THE ARCHITECT", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "PATCH", build: "NORMAL", prop: "BALL", scale: 0.98 },
  },
  // ---- Second ten -------------------------------------------------------
  //
  // Roles the first ten left uncovered: a winger, a holding midfielder, a
  // full-back, a target man, a sweeper-keeper, a poacher, a ball-playing
  // centre back, a second-striker, a set-piece specialist and a veteran.
  // Same six stats, same five axes, no new engine anything.
  {
    n: "The Atlantic Winger", w: null, u: "Original", t: "Hugs the touchline, then disappears inside",
    g: ["winger", "speed", "technical", "flair"],
    s: [74, 78, 95, 60, 90, 70],
    ab: ["Chalk on the Boots", "Whipped Cross"],
    nick: "THE WINGER", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "SPOTS", build: "SLIGHT", prop: "BALL", scale: 0.92 },
  },
  {
    n: "The Anchor", w: null, u: "Original", t: "Nothing comes through the middle",
    g: ["defensive", "tactical", "physical", "midfielder"],
    s: [44, 86, 58, 90, 70, 92],
    ab: ["Screen the Back Four", "Break It Up"],
    nick: "THE ANCHOR", va: "humanoid_medium",
    i: { head: "HELM", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "BALL", scale: 1.00 },
  },
  {
    n: "The Overlapping Fullback", w: null, u: "Original", t: "Somehow always up for the cross",
    g: ["defender", "speed", "physical", "winger"],
    s: [56, 78, 92, 82, 76, 80],
    ab: ["Overlap", "Recovery Sprint"],
    nick: "THE OVERLAP", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "BANDS", build: "NORMAL", prop: "BALL", scale: 0.98 },
  },
  {
    n: "The Target Man", w: null, u: "Original", t: "Everything goes through him first",
    g: ["striker", "physical", "aerial", "target"],
    s: [88, 66, 54, 96, 66, 82],
    ab: ["Hold It Up", "Flick On"],
    nick: "THE TARGET", va: "humanoid_large",
    i: { head: "PLAIN", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "BALL", scale: 1.06 },
  },
  {
    n: "The Sweeper Keeper", w: null, u: "Original", t: "Plays as an eleventh outfielder",
    g: ["keeper", "defensive", "technical", "tactical"],
    s: [24, 90, 66, 82, 84, 94],
    ab: ["Off the Line", "Start the Attack"],
    nick: "THE SWEEPER", va: "humanoid_large",
    i: { head: "HELM", back: "NONE", marking: "STRIPES", build: "TOWERING", prop: "SHIELD", scale: 1.00 },
  },
  {
    n: "The Six Yard Poacher", w: null, u: "Original", t: "Never touches the ball until it matters",
    g: ["striker", "finisher"],
    s: [97, 58, 76, 62, 74, 88],
    ab: ["Right Place", "One Touch"],
    nick: "THE POACHER", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "PATCH", build: "SQUAT", prop: "BALL", scale: 0.94 },
  },
  {
    n: "The Ball Playing Centre Back", w: null, u: "Original", t: "Defends by having the ball",
    g: ["defender", "defensive", "technical", "tactical"],
    s: [46, 90, 62, 88, 86, 90],
    ab: ["Step Into Midfield", "Diagonal"],
    nick: "THE LIBERO", va: "humanoid_large",
    i: { head: "PLAIN", back: "NONE", marking: "BANDS", build: "HEAVY", prop: "BALL", scale: 1.04 },
  },
  {
    n: "The Second Striker", w: null, u: "Original", t: "Lives in the space nobody marks",
    g: ["striker", "playmaker", "technical", "flair"],
    s: [86, 88, 80, 58, 88, 78],
    ab: ["Between the Lines", "Give and Go"],
    nick: "THE SHADOW", va: "humanoid_medium",
    i: { head: "PLAIN", back: "MANE", marking: "SPOTS", build: "SLIGHT", prop: "BALL", scale: 0.94 },
  },
  {
    n: "The Set Piece Specialist", w: null, u: "Original", t: "The wall never helps",
    g: ["technical", "midfielder", "tactical"],
    s: [82, 84, 56, 64, 96, 90],
    ab: ["Over the Wall", "Inswinger"],
    nick: "THE DEAD BALL", va: "humanoid_medium",
    i: { head: "PLAIN", back: "NONE", marking: "STRIPES", build: "NORMAL", prop: "BALL", scale: 1.02 },
  },
  {
    n: "The Veteran Captain", w: null, u: "Original", t: "Slower every year, later to be beaten",
    g: ["defender", "tactical", "defensive", "physical"],
    s: [52, 94, 48, 84, 74, 98],
    ab: ["Read the Room", "Last Ditch"],
    nick: "THE CAPTAIN", va: "humanoid_large",
    i: { head: "HELM", back: "MANE", marking: "PLAIN", build: "NORMAL", prop: "SHIELD", scale: 1.02 },
  },
];