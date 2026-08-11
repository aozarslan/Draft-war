"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  buyItem,
  equipItem,
  fetchShop,
  getAccount,
  type ShopItem,
  type ShopPayload,
} from "@/lib/client/account";
import { formatCoins } from "@/lib/game/progression";
import {
  bannerGradient,
  getItem,
  ITEM_KINDS,
  RARITY_STYLE,
  type ItemKind,
  type ItemRarity,
} from "@/lib/game/items";
import { Avatar } from "@/components/ProfileBadge";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";
import { play } from "@/lib/client/sound";

type Filter = "ALL" | ItemKind;

/**
 * The shop.
 *
 * Every price on screen came from the server with the discount already applied,
 * and the buy request sends nothing but an item id — so the card is a display
 * of the transaction, never its terms. A guest can browse the whole thing;
 * they just have no wallet to spend from.
 */
export function ShopClient() {
  const [shop, setShop] = useState<ShopPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    setShop(await fetchShop());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy(item: ShopItem) {
    if (!getAccount()) {
      setFlash({ kind: "bad", text: "Claim a name first — coins need somewhere to live." });
      return;
    }
    setBusy(item.itemId);
    setFlash(null);
    try {
      const result = await buyItem(item.itemId);
      play("sold");
      setFlash({
        kind: "ok",
        text: `${result.name} is yours — ${formatCoins(result.paid)} coins spent, ${formatCoins(result.balance)} left.`,
      });
      await load();
    } catch (err) {
      setFlash({ kind: "bad", text: err instanceof Error ? err.message : "That did not go through." });
    } finally {
      setBusy(null);
    }
  }

  async function wear(itemId: string) {
    setBusy(itemId);
    try {
      await equipItem(itemId);
      play("bid");
      setFlash({ kind: "ok", text: "Equipped." });
    } catch (err) {
      setFlash({ kind: "bad", text: err instanceof Error ? err.message : "Could not equip that." });
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return <LoadingScreen label="Opening the shop…" />;
  if (!shop) {
    return (
      <EmptyState
        icon="🛒"
        title="The shop is closed."
        hint="Something went wrong loading it. Try again in a moment."
      />
    );
  }

  const owned = new Set(shop.owned);
  const featured = shop.items.filter((i) => i.featured);
  const rest = shop.items.filter(
    (i) => !i.featured && (filter === "ALL" || i.kind === filter),
  );

  return (
    <div className="space-y-4">
      <Panel accent="#fbbf24">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="text-3xl">🛒</span>
          <div className="min-w-0 flex-1">
            <h1 className="headline text-2xl">Shop</h1>
            <p className="text-[11px] text-white/45">
              Cosmetics only. Nothing here changes a stat, a credit or a bid.
            </p>
          </div>
          {getAccount() ? (
            <span className="shrink-0 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-center">
              <span className="block text-lg font-black tabular-nums leading-none text-amber-200">
                {formatCoins(shop.balance)}
              </span>
              <span className="block text-[9px] font-bold uppercase tracking-wider text-white/40">
                🪙 coins
              </span>
            </span>
          ) : (
            <Link href="/profile" className="btn btn-primary !min-h-9 shrink-0 !text-[11px]">
              Sign in
            </Link>
          )}
        </div>
      </Panel>

      {flash ? (
        <p
          className={`rounded-xl border px-3 py-2 text-center text-xs font-bold ${
            flash.kind === "ok"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : "border-rose-400/30 bg-rose-400/10 text-rose-200"
          }`}
        >
          {flash.text}
        </p>
      ) : null}

      {/* ---- Today's rotation ---- */}
      {shop.rotation && featured.length > 0 ? (
        <Panel accent="#f0abfc">
          <SectionTitle right={<Countdown to={shop.rotation.endsAt} />}>
            Featured · {shop.rotation.discount}% off
          </SectionTitle>
          <div className="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-2">
            {featured.map((item) => (
              <ShopCard
                key={item.itemId}
                item={item}
                owned={owned.has(item.itemId)}
                busy={busy === item.itemId}
                affordable={shop.balance >= item.price}
                onBuy={() => buy(item)}
                onWear={() => wear(item.itemId)}
              />
            ))}
          </div>
          <p className="px-4 pb-4 text-[10px] text-white/25">
            The featured set changes every 24 hours and is the same for everybody.
            Refreshing will not reroll it.
          </p>
        </Panel>
      ) : null}

      {/* ---- Everything else ---- */}
      <Panel>
        <SectionTitle right={<span className="text-[10px] text-white/35">{rest.length} items</span>}>
          Catalog
        </SectionTitle>

        <div className="no-scrollbar flex gap-1 overflow-x-auto px-4 pb-3">
          {[{ id: "ALL" as const, label: "All", icon: "✦" }, ...ITEM_KINDS].map((k) => (
            <button
              key={k.id}
              onClick={() => setFilter(k.id as Filter)}
              aria-pressed={filter === k.id}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition ${
                filter === k.id ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {k.icon} {k.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-2">
          {rest.map((item) => (
            <ShopCard
              key={item.itemId}
              item={item}
              owned={owned.has(item.itemId)}
              busy={busy === item.itemId}
              affordable={shop.balance >= item.price}
              onBuy={() => buy(item)}
              onWear={() => wear(item.itemId)}
            />
          ))}
        </div>
      </Panel>

      <div className="flex gap-2">
        <Link href="/profile" className="btn flex-1">
          Locker
        </Link>
        <Link href="/#play" className="btn btn-primary flex-1">
          Earn more
        </Link>
      </div>
    </div>
  );
}

function ShopCard({
  item,
  owned,
  busy,
  affordable,
  onBuy,
  onWear,
}: {
  item: ShopItem;
  owned: boolean;
  busy: boolean;
  affordable: boolean;
  onBuy: () => void;
  onWear: () => void;
}) {
  const rarity = RARITY_STYLE[item.rarity as ItemRarity] ?? RARITY_STYLE.COMMON;
  const catalog = getItem(item.itemId);
  const discounted = item.price < item.listPrice;

  return (
    <div
      className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
      style={{ borderColor: `${rarity.colour}33`, background: `${rarity.colour}0a` }}
    >
      <Preview id={item.itemId} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-black">{item.name}</p>
        <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: rarity.colour }}>
          {rarity.label} · {catalog?.kind.toLowerCase() ?? item.kind.toLowerCase()}
        </p>
      </div>

      {owned ? (
        <button
          onClick={onWear}
          disabled={busy}
          className="btn !min-h-8 shrink-0 !px-2.5 !text-[10px]"
        >
          {busy ? "…" : "Wear"}
        </button>
      ) : (
        <button
          onClick={onBuy}
          disabled={busy || !affordable}
          className="btn btn-primary !min-h-8 shrink-0 !px-2.5 !text-[10px] tabular-nums disabled:opacity-40"
          title={affordable ? undefined : "Not enough coins yet"}
        >
          {busy ? "…" : `🪙 ${formatCoins(item.price)}`}
          {discounted ? (
            <>
              {" "}
              <span className="text-white/45 line-through">{formatCoins(item.listPrice)}</span>
            </>
          ) : null}
        </button>
      )}
    </div>
  );
}

/** Shows the item as it will actually look, not as a name in a list. */
function Preview({ id }: { id: string }) {
  const item = getItem(id);
  if (!item) return <Avatar avatar={null} size={34} />;

  if (item.kind === "AVATAR") return <Avatar avatar={item.id} size={34} />;
  if (item.kind === "FRAME") return <Avatar avatar="avatar-target" frame={item.id} size={34} />;
  if (item.kind === "BANNER") {
    return (
      <span
        className="h-[34px] w-[34px] shrink-0 rounded-xl border border-white/10"
        style={{ background: bannerGradient(item.id) }}
      />
    );
  }
  return (
    <span
      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl border border-white/10 text-sm"
      style={{ color: String(item.payload.colour) }}
    >
      🏷
    </span>
  );
}

/** Time left on the rotation, which the server decides and this only reports. */
function Countdown({ to }: { to: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(to).getTime() - Date.now()));

  useEffect(() => {
    const id = setInterval(
      () => setLeft(Math.max(0, new Date(to).getTime() - Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [to]);

  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);

  return (
    <span className="text-[10px] font-bold tabular-nums text-white/35">
      {hours}h {String(minutes).padStart(2, "0")}m {String(seconds).padStart(2, "0")}s left
    </span>
  );
}
