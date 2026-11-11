import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  DeliveryError,
  commitRecoveredGuest,
  FamiliarClient,
  inputAmount,
  savings,
  type Delivery,
  type Listing,
  type PetAction,
  type PetState,
  type Quote,
} from "./near";
import { errorCopy, explorerLink, receiptFor } from "./receipts";
import { dens, itemIds, rules, validName } from "./rules";
import { Icon, type IconName } from "./Icon";
import { Pet } from "./Pet";
import { Town } from "./Town";
import { planUrl } from "./plan-url";
import {
  googleRecoveryAvailable,
  keepWithGoogle,
  recoverWithGoogle,
  RecoveryError,
  signInGoogle,
} from "./auth";

const client = new FamiliarClient();
const spots = [
  { id: "mill", name: "The mill", item: "flour", icon: "bread" },
  { id: "well", name: "The well", item: "water", icon: "spark" },
  { id: "orchard", name: "The orchard", item: "berries", icon: "leaf" },
] as const;
type Tab = "town" | "bag" | "market" | "nap" | "den";
type DenScore = {
  den: number;
  bread: string;
  week: string;
  weekly_bread: string;
};
const tabs: { id: Tab; name: string; icon: IconName }[] = [
  { id: "town", name: "Town", icon: "home" },
  { id: "bag", name: "Bag", icon: "bag" },
  { id: "market", name: "Market", icon: "shop" },
  { id: "nap", name: "Nap", icon: "moon" },
  { id: "den", name: "Den", icon: "leaf" },
];

export function App() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [petId, setPetId] = useState("");
  const [pets, setPets] = useState<string[]>([]);
  const [pet, setPet] = useState<PetState | null>(null);
  const [inventory, setInventory] = useState<string[]>(itemIds.map(() => "0"));
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [bram, setBram] = useState({
    tooltip:
      "A little flour, a little patience. There is bread enough to go around.",
    source: "script",
    balance: "0",
  });
  const [dream, setDream] = useState<string | null>(null);
  const [claim, setClaim] = useState("0");
  const [tab, setTab] = useState<Tab>("town");
  const [destination, setDestination] = useState("home");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<(Delivery & { time: string }) | null>(
    null,
  );
  const [xray, setXray] = useState(false);
  const [amount, setAmount] = useState("0.01");
  const [price, setPrice] = useState("0.04");
  const [sound, setSound] = useState(false);
  const [accessory, setAccessory] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [readsAvailable, setReadsAvailable] = useState(true);
  const [denScores, setDenScores] = useState<DenScore[]>([]);
  const [denFees, setDenFees] = useState<string[]>([]);
  const [denWeek, setDenWeek] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryName, setRecoveryName] = useState("");
  const [googleKept, setGoogleKept] = useState(false);
  const googleAvailable = googleRecoveryAvailable(
    location.origin,
    import.meta.env.VITE_NEAR_AUTH_CLIENT_ID || undefined,
  );
  const audio = useRef<AudioContext | null>(null);
  const receiptNode = useRef<HTMLElement>(null);
  const panelNode = useRef<HTMLElement>(null);

  const refresh = useCallback(async (chosen?: string) => {
    const owned = await client.owned();
    const ids = owned.map((p) => p.token_id);
    setPets(ids);
    const id = chosen && ids.includes(chosen) ? chosen : (ids[0] ?? "");
    setPetId(id);
    if (!id) {
      setPet(null);
      return;
    }
    const state = await client.view<PetState>(id, "get_state");
    if (!state)
      throw new Error(
        "Your pet’s home could not be read. Try refreshing the town.",
      );
    setPet(state);
    const results = await Promise.allSettled([
      client.view<string[]>(state.items, "mt_batch_balance_of", {
        account_id: id,
        token_ids: [...itemIds],
      }),
      client.view<{
        quotes: Quote[];
        balance: string;
        week: string;
        weekly_fees: string[];
      }>(state.market, "get_npc"),
      client.view<Listing[]>(state.market, "get_listings"),
      client.view<string>(state.pool, "get_account_staked_balance", {
        account_id: id,
      }),
      client.view<string>(state.market, "get_claim", { account_id: id }),
      client.view<DenScore[]>(client.root, "get_dens"),
    ]);
    setReadsAvailable(
      results
        .slice(0, 3)
        .every((r) => r.status === "fulfilled" && r.value !== undefined),
    );
    if (results[0].status === "fulfilled" && results[0].value)
      setInventory(results[0].value);
    if (results[1].status === "fulfilled" && results[1].value) {
      const market = results[1].value;
      setQuotes(market.quotes);
      setBram((b) => ({ ...b, balance: market.balance }));
      setDenFees(market.weekly_fees);
      setDenWeek(market.week);
    }
    if (results[2].status === "fulfilled" && results[2].value)
      setListings(results[2].value);
    setDream(
      results[3].status === "fulfilled" ? (results[3].value ?? null) : null,
    );
    if (results[4].status === "fulfilled") setClaim(results[4].value ?? "0");
    if (results[5].status === "fulfilled") setDenScores(results[5].value ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const live = await client.health();
        if (cancelled) return;
        setReady(live);
        const stored = localStorage.getItem("familiar.guest.v1");
        if (stored) {
          client.restore();
          if (live && client.guest?.root === client.root) await refresh();
        }
      } catch (e) {
        if (!cancelled) {
          setReady(false);
          if (e instanceof Error && e.message.includes("saved guest"))
            setError(e.message);
        }
      }
    }
    void check();
    const timer = setInterval(() => {
      void client
        .health()
        .then((live) => {
          if (!cancelled) setReady(live);
        })
        .catch(() => {
          if (!cancelled) setReady(false);
        });
    }, 30_000);
    const npcUrl = import.meta.env.VITE_NPC_URL ?? "/npc-api";
    void fetch(`${npcUrl}/v1/npc/bram`, { signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !cancelled)
          setBram((b) => ({
            ...b,
            tooltip:
              typeof data.tooltip === "string"
                ? data.tooltip.slice(0, 140)
                : b.tooltip,
            source: data.source === "llm" ? "llm" : "script",
          }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  function cue(kind: string) {
    if (!sound) return;
    try {
      audio.current ??= new AudioContext();
      const context = audio.current;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(
        kind === "feed" ? 440 : kind === "forage" ? 660 : 880,
        context.currentTime,
      );
      gain.gain.setValueAtTime(0.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.14);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.15);
    } catch {
      /* Sound is optional; a blocked audio device does not interrupt play. */
    }
  }
  async function deliver(
    label: string,
    action: () => Promise<Delivery>,
    chosen?: string,
  ) {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      const result = await action();
      setReceipt({
        ...result,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
      try {
        await refresh(chosen ?? petId);
      } catch {
        setReadsAvailable(false);
        setError(
          "The action confirmed, but the town’s records could not refresh. Check again before your next errand.",
        );
      }
      setXray(false);
      cue(result.receiptSentenceKey);
      setTimeout(
        () =>
          receiptNode.current?.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
            block: "nearest",
          }),
        50,
      );
    } catch (e) {
      setError(
        e instanceof DeliveryError
          ? e.code === "OFFLINE" || e.code === "DELIVERY_UNKNOWN"
            ? e.message
            : errorCopy(e.code)
          : e instanceof Error
            ? e.message
            : "The Post Office could not confirm delivery.",
      );
      try {
        await refresh(chosen ?? petId);
      } catch {
        setReadsAvailable(false);
        /* Keep the last confirmed state while the RPC is unavailable. */
      }
    } finally {
      setBusy("");
    }
  }
  function act(action: PetAction, place = "home") {
    setDestination(place);
    return deliver("Your pet is on its way…", () => client.act(petId, action));
  }
  function adopt(e: FormEvent) {
    e.preventDefault();
    if (!validName(name)) {
      setError(
        "Choose 2–24 lowercase letters or numbers, joined with single hyphens or underscores. That name may be reserved.",
      );
      return;
    }
    setDestination("home");
    void deliver(
      "Making a little home…",
      () => client.adopt(name),
      `${name}.${client.root}`,
    );
  }
  async function checkTown() {
    setRefreshing(true);
    setError("");
    try {
      const live = await client.health();
      setReady(live);
      if (live && client.guest) await refresh(petId);
    } catch {
      setReady(false);
      setError(
        "The town could not be reached. Your saved guest pass is still in this browser.",
      );
    } finally {
      setRefreshing(false);
    }
  }
  const paused =
    !ready || !readsAvailable || Boolean(busy) || Boolean(pet?.pending);
  const ownedBread = BigInt(inventory[3] ?? "0");
  const afterErrand = pet?.recent.some((e) => e.event === "errand") ?? false;
  const selectedListing = listings.find((l) => l.token_id === petId);
  const receiptCopy = receipt ? receiptFor(receipt.receiptSentenceKey) : null;

  async function google(recovering: boolean) {
    if (busy || !ready || !googleAvailable) return;
    if (recovering && !validName(recoveryName)) {
      setError("Enter your pet’s short name to find its home.");
      return;
    }
    setError("");
    setBusy("Checking your Google pass…");
    try {
      const session = await signInGoogle(client.rpcUrl);
      const guest = await client.ensureGuest();
      if (!guest.accountId || !guest.root) throw new Error("Guest unavailable");
      const current = {
        secret: guest.secret,
        accountId: guest.accountId,
        root: guest.root,
      };
      let hash: string;
      if (recovering) {
        const recovered = await recoverWithGoogle(
          recoveryName,
          current,
          client.provider,
          session,
        );
        client.guest = commitRecoveredGuest(
          localStorage,
          current,
          recovered.guest,
        );
        hash = recovered.hash;
        setPet(null);
        setPetId("");
        setPets([]);
        setRecoveryOpen(false);
      } else {
        hash = (await keepWithGoogle(current, client.provider, session)).hash;
      }
      setGoogleKept(true);
      setReceipt({
        hash,
        receiptSentenceKey: recovering ? "recover_google" : "keep_google",
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
      cue("receipt");
      try {
        await refresh();
      } catch {
        setReadsAvailable(false);
      }
    } catch (error) {
      setError(
        error instanceof RecoveryError
          ? error.message
          : error instanceof DeliveryError
            ? errorCopy(error.code)
            : "Google did not finish. Keep this browser’s data; your original guest pass still works.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={`app-shell${pet ? " has-pet" : ""}`}>
      <a className="skip-link" href="#play">
        Skip to play
      </a>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Familiar home">
          <img src="/pet.svg" width="30" height="30" alt="" /> familiar
          <span className="wordmark-dot">.</span>
        </a>
        <div className="header-controls">
          <span className={`post-status ${ready ? "is-ready" : ""}`}>
            <span />
            {ready
              ? "Harbor open"
              : ready === null
                ? "Opening the harbor"
                : "Post Office resting"}
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={() => setSound((v) => !v)}
            aria-label={sound ? "Turn sound off" : "Turn sound on"}
            aria-pressed={sound}
          >
            <Icon name={sound ? "sound" : "mute"} />
          </button>
        </div>
      </header>
      <main id="play">
        <div className="town-column">
          <section className="welcome" aria-labelledby="town-title">
            {pet ? (
              <>
                <div className="companion-portrait">
                  <Pet
                    sleeping={pet.sleeping}
                    accessory={accessory}
                    className="header-pet"
                  />
                </div>
                <div>
                  <h1 id="town-title">
                    {petId.split(".")[0]}
                    <span className="name-period">.</span>
                  </h1>
                  <p>
                    {pet.sleeping
                      ? "Dreaming of something lovely."
                      : pet.mood >= 60
                        ? "A good day for a little adventure."
                        : pet.mood >= 20
                          ? "Could use a snack and some company."
                          : "A little sleepy. Never a lost cause."}
                  </p>
                </div>
              </>
            ) : (
              <div>
                <h1 id="town-title">
                  Littleharbor<span className="name-period">.</span>
                </h1>
                <p><a href={planUrl}>Explore the First Light design book</a></p>
              </div>
            )}
            {pet && (
              <div className="pet-stats">
                <span>
                  <Icon name="heart" size={16} />
                  <strong>
                    {pet.mood}/{rules.MOOD_MAX}
                  </strong>{" "}
                  mood
                </span>
                <span
                  className="energy"
                  aria-label={`${pet.energy} of ${rules.ENERGY_MAX} errands available`}
                >
                  {Array.from({ length: rules.ENERGY_MAX }, (_, i) => (
                    <i key={i} className={i < pet.energy ? "full" : ""} />
                  ))}
                  <span>errands</span>
                </span>
                <span>Level {pet.level}</span>
                {pet.streak > 0 && (
                  <span>
                    {pet.streak} day{pet.streak === 1 ? "" : "s"} together
                  </span>
                )}
              </div>
            )}
          </section>
          <div className="harbor-view">
            <Town destination={destination} sleeping={pet?.sleeping ?? false} />
            <div className="town-caption">
              <span>
                <span className="sun-dot" /> Golden hour in Littleharbor
              </span>
              <span>Take your time.</span>
            </div>
          </div>
        </div>
        <div className="play-column">
          {!pet ? (
            <section className="adoption narrow" aria-label="Adopt a companion">
              <div className="adoption-preview">
                <Pet />
              </div>
              <div className="adoption-heading">
                <h2>Name your companion.</h2>
                <p>Pick a name to give them a home in Littleharbor.</p>
              </div>
              <form onSubmit={adopt} className="adopt-form">
                <label htmlFor="pet-name">Your companion’s name</label>
                <div className="name-input">
                  <input
                    id="pet-name"
                    value={name}
                    onChange={(e) => setName(e.target.value.toLowerCase())}
                    minLength={2}
                    maxLength={24}
                    required
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="e.g. mochi"
                    aria-describedby="name-help"
                  />
                  <button
                    type="submit"
                    className="primary"
                    disabled={!ready || Boolean(busy) || !name}
                  >
                    {busy ? "Making a home…" : "Adopt"}
                    <Icon name="arrow" size={18} />
                  </button>
                </div>
                <p id="name-help" className="fine">
                  No sign-up. Just you and a small new friend.
                </p>
              </form>
              <button
                type="button"
                className="text-button"
                aria-expanded={recoveryOpen}
                onClick={() => setRecoveryOpen(!recoveryOpen)}
                disabled={Boolean(busy)}
              >
                Coming back? Find your companion
              </button>
              {recoveryOpen && (
                <form
                  className="recovery-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void google(true);
                  }}
                >
                  <label htmlFor="recovery-name">Your pet’s short name</label>
                  <input
                    id="recovery-name"
                    value={recoveryName}
                    onChange={(event) =>
                      setRecoveryName(event.target.value.toLowerCase())
                    }
                    minLength={2}
                    maxLength={24}
                    required
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="e.g. mochi"
                  />
                  <button
                    type="submit"
                    className="secondary"
                    disabled={!ready || Boolean(busy) || !googleAvailable}
                  >
                    Continue with Google
                  </button>
                  <p className="fine">
                    {googleAvailable
                      ? "Use the Google account you kept your pass with. Your previous guest pass stays on this device."
                      : "Google recovery is not connected in this town yet. Keep your existing browser data."}
                  </p>
                </form>
              )}
            </section>
          ) : (
            <>
              <nav className="play-nav narrow" aria-label="Places in town">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={tab === t.id}
                    className={tab === t.id ? "selected" : ""}
                    onClick={() => {
                      setTab(t.id);
                      if (matchMedia("(max-width: 999px)").matches)
                        requestAnimationFrame(() =>
                          panelNode.current?.scrollIntoView({
                            block: "start",
                            behavior: matchMedia(
                              "(prefers-reduced-motion: reduce)",
                            ).matches
                              ? "instant"
                              : "smooth",
                          }),
                        );
                    }}
                  >
                    <Icon name={t.icon} />
                    <span>{t.name}</span>
                  </button>
                ))}
              </nav>
              <section
                ref={panelNode}
                className="play-panel narrow"
                aria-label={tabs.find((t) => t.id === tab)?.name}
              >
                {pets.length > 1 && (
                  <label className="pet-select">
                    Companion
                    <select
                      value={petId}
                      onChange={(e) => void refresh(e.target.value)}
                    >
                      {pets.map((id) => (
                        <option key={id} value={id}>
                          {id.split(".")[0]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {tab === "town" && (
                  <>
                    <div className="panel-heading">
                      <div>
                        <h2>A little care, a little adventure.</h2>
                        <p>Good company. Useful errands. Maybe bread.</p>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Refresh town"
                        disabled={refreshing || Boolean(busy)}
                        onClick={() => void checkTown()}
                      >
                        <Icon name="refresh" />
                      </button>
                    </div>
                    <button
                      className="care-button"
                      disabled={paused || pet.sleeping}
                      onClick={() => void act({ kind: "feed" })}
                    >
                      <span className="care-icon">
                        <Icon name="heart" size={24} />
                      </span>
                      <span>
                        <strong>Share a snack</strong>
                        <small>A little care goes a long way.</small>
                      </span>
                      <Icon name="arrow" />
                    </button>
                    <div className="errands-heading">
                      <h3>Out for an errand</h3>
                      <span>1 energy each</span>
                    </div>
                    <div className="errand-list">
                      {spots.map((spot) => (
                        <button
                          key={spot.id}
                          disabled={paused || pet.sleeping || pet.energy < 1}
                          onClick={() =>
                            void act({ kind: "forage", spot: spot.id }, spot.id)
                          }
                        >
                          <Icon name={spot.icon} />
                          <span>
                            <strong>{spot.name}</strong>
                            <small>Bring home {spot.item}</small>
                          </span>
                          <Icon name="arrow" size={16} />
                        </button>
                      ))}
                    </div>
                    <button
                      className="craft-button"
                      disabled={
                        paused ||
                        pet.sleeping ||
                        pet.level < 4 ||
                        BigInt(inventory[0] ?? "0") < 1n ||
                        BigInt(inventory[1] ?? "0") < 1n
                      }
                      onClick={() => void act({ kind: "craft" }, "craft")}
                    >
                      <Icon name="bread" />
                      <span>
                        <strong>Bake a loaf</strong>
                        <small>
                          {pet.level < 4
                            ? "Opens at level 4"
                            : "1 flour + 1 water → 1 bread"}
                        </small>
                      </span>
                      <span>{ownedBread.toString()} baked</span>
                    </button>
                    <p className="fine">
                      An errand returns every eight hours. Your companion is
                      never in a hurry.
                    </p>
                  </>
                )}
                {tab === "bag" && (
                  <>
                    <div className="panel-heading">
                      <div>
                        <h2>A pocketful of possibility</h2>
                        <p>Everything here belongs to {petId.split(".")[0]}.</p>
                      </div>
                      <Icon name="bag" size={28} />
                    </div>
                    <div className="inventory-list">
                      {itemIds.map((item, i) => (
                        <div className="inventory-row" key={item}>
                          <Icon
                            name={
                              item === "bread" || item === "flour"
                                ? "bread"
                                : item === "berries"
                                  ? "leaf"
                                  : "spark"
                            }
                          />
                          <span>{item}</span>
                          <strong>{inventory[i] ?? "0"}</strong>
                          {["hat", "scarf"].includes(item) &&
                            BigInt(inventory[i] ?? "0") > 0n && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  setAccessory(accessory === item ? "" : item)
                                }
                              >
                                {accessory === item ? "Take off" : "Wear"}
                              </button>
                            )}
                        </div>
                      ))}
                    </div>
                    <p className="fine">
                      A new home won’t empty these pockets. Supplies go with
                      your companion.
                    </p>
                  </>
                )}
                {tab === "market" && (
                  <>
                    <div className="panel-heading">
                      <div>
                        <h2>Bram’s little stall</h2>
                        <p>A baker with a mind of his own.</p>
                      </div>
                      <Icon name="shop" size={28} />
                    </div>
                    <blockquote className="bram-quote">
                      “{bram.tooltip}”
                      <cite>
                        Bram ·{" "}
                        {bram.source === "llm"
                          ? "AI-written note"
                          : "scripted note"}
                      </cite>
                    </blockquote>
                    {BigInt(bram.balance) === 0n && (
                      <p className="notice">
                        Bram is short of savings. Your supplies are safe; his
                        buying desk will reopen when he’s funded.
                      </p>
                    )}
                    <div className="market-table">
                      <div className="market-table-head">
                        <span>Supplies</span>
                        <span>Sell one</span>
                        <span>Buy one</span>
                      </div>
                      {quotes.map((q) => (
                        <div className="market-row" key={q.item}>
                          <span>
                            <strong>{q.item}</strong>
                            <small>{q.stock ?? "0"} in Bram’s pantry</small>
                          </span>
                          <button
                            aria-label={`Sell one ${q.item} for ${savings(q.bid)} testnet NEAR`}
                            disabled={
                              paused ||
                              pet.level < 3 ||
                              BigInt(bram.balance) < BigInt(q.bid) ||
                              BigInt(
                                inventory[
                                  itemIds.indexOf(
                                    q.item as (typeof itemIds)[number],
                                  )
                                ] ?? "0",
                              ) < 1n
                            }
                            onClick={() =>
                              void act(
                                {
                                  kind: "sell_to_npc",
                                  item: q.item,
                                  quantity: "1",
                                },
                                "market",
                              )
                            }
                          >
                            {savings(q.bid)}
                          </button>
                          <button
                            aria-label={`Buy one ${q.item} for ${savings(q.ask)} testnet NEAR`}
                            disabled={
                              paused ||
                              pet.level < 5 ||
                              BigInt(q.stock ?? "0") < 1n ||
                              BigInt(pet.spendable) < BigInt(q.ask)
                            }
                            onClick={() =>
                              void act(
                                {
                                  kind: "buy_from_npc",
                                  item: q.item,
                                  quantity: "1",
                                  amount: q.ask,
                                },
                                "market",
                              )
                            }
                          >
                            {savings(q.ask)}
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="fine">
                      Testnet NEAR, play money. Sell at level 3; buy at level 5.
                      A 2% fee goes to a den.
                    </p>
                    {BigInt(claim) > 0n && (
                      <button
                        className="secondary full-width"
                        disabled={paused}
                        onClick={() =>
                          void act({ kind: "claim_market" }, "market")
                        }
                      >
                        Collect {savings(claim)} in market earnings
                      </button>
                    )}
                    <div className="resale">
                      <h3>Find a new home</h3>
                      <p>
                        A new caretaker receives the account, supplies and
                        savings together.
                      </p>
                      {selectedListing ? (
                        <>
                          <p>
                            Listed for {savings(selectedListing.price)} testnet
                            NEAR.
                          </p>
                          <button
                            className="secondary"
                            disabled={paused}
                            onClick={() =>
                              void deliver("Taking down the notice…", () =>
                                client.call(
                                  `market.${client.root}`,
                                  "cancel_listing",
                                  {
                                    token_id: petId,
                                  },
                                ),
                              )
                            }
                          >
                            Take down notice
                          </button>
                        </>
                      ) : (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void deliver("Posting an adoption notice…", () =>
                              client.list(petId, price),
                            );
                          }}
                        >
                          <label htmlFor="sale-price">
                            Adoption price · testnet NEAR
                          </label>
                          <div className="inline-form">
                            <input
                              id="sale-price"
                              inputMode="decimal"
                              value={price}
                              onChange={(e) => setPrice(e.target.value)}
                              required
                            />
                            <button className="secondary" disabled={paused}>
                              Post notice
                            </button>
                          </div>
                        </form>
                      )}
                      <h3>Companions seeking a home</h3>
                      {listings.filter(
                        (l) => l.seller !== client.guest?.accountId,
                      ).length === 0 ? (
                        <p className="fine">
                          No adoption notices today. A quiet town is a happy
                          town.
                        </p>
                      ) : (
                        listings
                          .filter((l) => l.seller !== client.guest?.accountId)
                          .map((l) => (
                            <div className="listing" key={l.token_id}>
                              <span>
                                <strong>{l.token_id.split(".")[0]}</strong>
                                <small>{savings(l.price)} testnet NEAR</small>
                              </span>
                              <button
                                className="secondary"
                                disabled={paused}
                                onClick={() =>
                                  void deliver(
                                    "Welcoming a new companion…",
                                    () => client.buyPet(l.token_id, l.price),
                                    l.token_id,
                                  )
                                }
                              >
                                Welcome
                              </button>
                            </div>
                          ))
                      )}
                    </div>
                  </>
                )}
                {tab === "nap" && (
                  <>
                    <div className="panel-heading">
                      <div>
                        <h2>A nap with a little dream</h2>
                        <p>Rest is part of the adventure.</p>
                      </div>
                      <Icon name="moon" size={28} />
                    </div>
                    <div className="nap-scene">
                      <Pet sleeping={pet.sleeping} accessory={accessory} />
                      <div>
                        <span>Dream savings</span>
                        <strong>
                          {dream === null ? "Unavailable" : savings(dream)}
                        </strong>
                        <small>testnet NEAR · pool balance</small>
                      </div>
                    </div>
                    <p className="notice">
                      Your pet keeps a reserve for its home. Available for a nap
                      or the market: {savings(pet.spendable)} testnet NEAR.
                    </p>
                    {pet.unstaking_epoch ? (
                      <>
                        <p>
                          Waiting for the pool to release{" "}
                          {savings(pet.unstaking_amount)}. Withdrawal becomes
                          available at epoch {pet.unstaking_epoch}; the pool
                          confirms readiness.
                        </p>
                        <button
                          className="primary full-width"
                          disabled={paused}
                          onClick={() =>
                            void act({ kind: "withdraw" }, "sleep")
                          }
                        >
                          Collect released savings
                          <Icon name="arrow" />
                        </button>
                      </>
                    ) : pet.sleeping ? (
                      <button
                        className="primary full-width"
                        disabled={paused}
                        onClick={() => void act({ kind: "wake" }, "home")}
                      >
                        Time to wake up
                        <Icon name="arrow" />
                      </button>
                    ) : (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          try {
                            void act(
                              {
                                kind: "sleep",
                                amount: inputAmount(amount).toString(),
                              },
                              "sleep",
                            );
                          } catch (e) {
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Choose a valid amount.",
                            );
                          }
                        }}
                      >
                        <label htmlFor="nap-amount">
                          Set aside for a nap · testnet NEAR
                        </label>
                        <div className="inline-form">
                          <input
                            id="nap-amount"
                            inputMode="decimal"
                            required
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                          <button
                            className="primary"
                            disabled={paused || pet.level < 2}
                          >
                            {pet.level < 2 ? "Opens at level 2" : "Tuck in"}
                            <Icon name="moon" size={18} />
                          </button>
                        </div>
                      </form>
                    )}
                    <p className="fine">
                      Staking rewards come from a real testnet pool. Unstaking
                      takes four epochs. These are play funds, with no promised
                      return.
                    </p>
                  </>
                )}
                {tab === "den" && (
                  <>
                    <div className="panel-heading">
                      <div>
                        <h2>A place to belong</h2>
                        <p>Four little corners of the same town.</p>
                      </div>
                      <Icon name="leaf" size={28} />
                    </div>
                    {pet.den ? (
                      <div className="den-welcome">
                        <Icon name="leaf" size={40} />
                        <h3>At home in {dens[pet.den - 1]}</h3>
                        <p>Your pet’s market fees help this den’s treasury.</p>
                      </div>
                    ) : (
                      <div className="den-list">
                        {dens.map((den, i) => (
                          <button
                            key={den}
                            disabled={paused || pet.level < 6}
                            onClick={() =>
                              void act({ kind: "join_den", den: i + 1 }, "den")
                            }
                          >
                            <span className={`den-mark den-${i}`} />
                            <strong>{den}</strong>
                            <span>
                              {pet.level < 6 ? "Level 6" : "Join den"}
                            </span>
                            <Icon name="arrow" size={16} />
                          </button>
                        ))}
                      </div>
                    )}
                    {denScores.length > 0 && (
                      <div className="den-scores">
                        <h3>This week in the dens</h3>
                        <div className="den-score-heading">
                          <span>Den</span>
                          <span>Bread baked</span>
                          <span>Fees earned</span>
                        </div>
                        {denWeek &&
                        denScores.every((score) => score.week === denWeek) ? (
                          denScores.map((score) => (
                            <div key={score.den} className="den-score">
                              <strong>{dens[score.den - 1]}</strong>
                              <span>{score.weekly_bread}</span>
                              <span>
                                {savings(denFees[score.den - 1] ?? "0")}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="fine">
                            Weekly records changed while you were looking.
                            Refresh the town.
                          </p>
                        )}
                        <p className="fine">
                          Bread and fees earned since Monday, 00:00 UTC. Scores
                          reset each week; treasury savings stay put. Fees are
                          in testnet NEAR.
                        </p>
                      </div>
                    )}
                    <p className="fine">
                      No entry fee. No stakes or pots. Just a shared treasury,
                      and bread to be proud of.
                    </p>
                  </>
                )}
              </section>
            </>
          )}
          <div
            className="feedback narrow"
            aria-live="polite"
            aria-atomic="true"
          >
            {!readsAvailable && (
              <p className="offline-message">
                Some town records could not be read. Play is paused until they
                refresh.
                <button
                  className="text-button"
                  onClick={() => void checkTown()}
                  disabled={refreshing}
                >
                  Refresh records
                </button>
              </p>
            )}
            {busy && (
              <p className="pending-message">
                <span className="pending-dot" />
                {busy} Waiting for confirmation.
              </p>
            )}
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            {ready === false && (
              <p className="offline-message">
                The Post Office is resting. Your pet and saved progress are
                safe.
                <button
                  className="text-button"
                  onClick={() => void checkTown()}
                  disabled={refreshing}
                >
                  {refreshing ? "Checking…" : "Check again"}
                </button>
              </p>
            )}
          </div>
          {receipt && receiptCopy && (
            <section
              ref={receiptNode}
              className="receipt narrow"
              aria-labelledby="receipt-title"
            >
              <div className="receipt-top">
                <span>FAMILIAR · LITTLEHARBOR</span>
                <span>{receipt.time}</span>
              </div>
              <h2 id="receipt-title">
                <Icon name="check" size={20} /> A small thing, made real.
              </h2>
              <p className="receipt-sentence">{receiptCopy.sentence}</p>
              <p>{receiptCopy.detail}</p>
              <div className="receipt-bottom">
                <span>TESTNET · CONFIRMED</span>
                <button
                  type="button"
                  aria-expanded={xray}
                  className="xray-toggle"
                  onClick={() => setXray((v) => !v)}
                >
                  <Icon name="eye" size={16} />
                  X-ray {xray ? "off" : "on"}
                </button>
              </div>
              {xray && (
                <div className="xray">
                  <dl>
                    <dt>Pet account</dt>
                    <dd>{petId || "See transaction"}</dd>
                    <dt>Action</dt>
                    <dd>{receipt.receiptSentenceKey}</dd>
                    <dt>Transaction</dt>
                    <dd>{receipt.hash}</dd>
                  </dl>
                  {explorerLink(receipt.hash) && (
                    <a
                      href={explorerLink(receipt.hash)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Read the public record
                      <Icon name="link" size={16} />
                    </a>
                  )}
                </div>
              )}
            </section>
          )}
          {afterErrand && (
            <aside className="retention narrow">
              <Icon name="heart" size={18} />
              <p>
                Your guest pass lives in this browser. Keep its data to come
                back to your companion.
                <span>
                  {googleKept
                    ? "Your Google pass is confirmed. Your original browser pass still works."
                    : googleAvailable
                      ? "Keep a Google pass so you can return on another device. Uses a little of your player’s testnet funds."
                      : "Google recovery is not connected in this town yet."}
                </span>
                <button
                  type="button"
                  className="text-button"
                  disabled={paused || !googleAvailable || googleKept}
                  onClick={() => void google(false)}
                >
                  {googleKept ? "Kept with Google" : "Keep with Google"}
                </button>
              </p>
            </aside>
          )}
        </div>
      </main>
      <footer className="site-footer">
        <a href={planUrl}>First Light design book</a>
        <a
          href="https://kenney.nl/assets/tiny-town"
          target="_blank"
          rel="noreferrer"
        >
          Town art by Kenney
        </a>
      </footer>
    </div>
  );
}
