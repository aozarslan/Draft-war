import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = {
  title: "Rules · DRAFT WAR",
  description: "How to play DRAFT WAR in under a minute.",
};

const STEPS = [
  { n: 1, icon: "🎯", title: "Choose a category", body: "The host picks one, everyone votes, or the game draws one at random. Mix categories for a crossover." },
  { n: 2, icon: "🔗", title: "Join the room", body: "One link, up to four players. No account, no install — a nickname is enough." },
  { n: 3, icon: "💰", title: "Everyone gets 40 credits", body: "That is your entire budget for the whole draft. Spend it badly and you finish the game with a bench." },
  { n: 4, icon: "🔨", title: "Characters go to auction", body: "One at a time, 30 seconds each. Every bid puts the full 30 seconds back, so a bidding war never gets sniped." },
  { n: 5, icon: "🛡", title: "Build a team of five", body: "You must keep one credit for every slot you still need, so the game will never let you strand yourself." },
  { n: 6, icon: "🗺", title: "Vote for a battlefield", body: "Each map boosts different kinds of fighter. Pick the one your squad was built for." },
  { n: 7, icon: "🎲", title: "An event card is drawn", body: "It bends the rules for this battle only — melee bonus, tech blackout, doubled map effects." },
  { n: 8, icon: "⚔️", title: "The battle plays out", body: "A round-by-round simulation using your stats, synergies, the map and the event. The favourite usually wins. Usually." },
  { n: 9, icon: "🏆", title: "Points and a season table", body: "1st takes 3 points, 2nd takes 2, 3rd takes 1. Play again and the room keeps score." },
];

export default function RulesPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <header className="mb-6">
          <h1 className="headline text-[clamp(2rem,8vw,3.5rem)] neon-text">How to play</h1>
          <p className="mt-1 text-sm text-white/50">
            Nine steps, about one minute. Build your team, break the bank, win the war.
          </p>
        </header>

        <ol className="space-y-3">
          {STEPS.map((s) => (
            <li key={s.n} className="glass flex gap-4 rounded-2xl p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/5 text-xl">
                {s.icon}
              </span>
              <div>
                <h2 className="headline text-lg">
                  <span className="text-white/30">{s.n}.</span> {s.title}
                </h2>
                <p className="mt-1 text-sm text-white/55">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <section className="glass mt-6 rounded-2xl p-5">
          <h2 className="headline text-xl">The two rules that decide games</h2>
          <p className="mt-2 text-sm text-white/60">
            <strong className="text-white">The reserve rule.</strong> You must keep
            1 credit for every roster slot you still need. With 10 credits and 2
            slots left, your ceiling is 9 — the MAX button always shows exactly
            what that is.
          </p>
          <p className="mt-2 text-sm text-white/60">
            <strong className="text-white">The pass rule.</strong> You may pass —
            unless the characters left exactly match the slots left, in which case
            somebody has to buy. With four players and twenty characters, nothing
            ever goes unsold.
          </p>
        </section>

        <section className="glass mt-4 rounded-2xl p-5">
          <h2 className="headline text-xl">About the ratings</h2>
          <p className="mt-2 text-sm text-white/60">
            Every number in DRAFT WAR is a <strong className="text-white">game
            rating</strong> invented for this game and balanced for fun. It is not
            an official ranking from any rights holder, and for the real people in
            the Hollywood category and the real animals in the Animals category it
            is not a measurement or a prediction of anything.
          </p>
          <p className="mt-2 text-sm text-white/60">
            Character descriptions and images come from Wikipedia and Wikimedia,
            with the licence and author shown wherever Wikimedia reports one.
            DRAFT WAR is not affiliated with Wikipedia.
          </p>
        </section>

        <div className="mt-6 flex gap-2">
          <Link href="/#play" className="btn btn-primary flex-1">Start a game</Link>
          <Link href="/categories" className="btn flex-1">See the categories</Link>
        </div>
      </main>
    </>
  );
}
