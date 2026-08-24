# The Ansem World

A Solana NFT protocol where each piece is a Metaplex Core asset that earns
$ANSEM while it is awake. Tiers, fuse bonuses and the vault all live on the
NFT, so everything travels with it when it is sold.

## How it works

**Pieces.** Every NFT has a Position account holding its tier, its earning
weight and its vault. The vault belongs to the token, not to a wallet: sell
the piece and its balance goes with it.

**Waking a piece.** Activation burns $ANSEMW and adds the piece's weight to
the global pool. A sale puts it back to sleep — the new holder burns again to
wake it, and the tier survives untouched.

**Rewards.** Funding a round spreads $ANSEM across all active weight through
a single accumulator, so paying out never loops over every NFT. A piece's
share is its weight over the total.

**Tiers.** Five rungs, priced from a cumulative table. Climbing one step at a
time costs exactly what jumping straight to the top does.

**Fuse.** One piece absorbs another. The weights add, a bonus applies (+20%
for two parts, +30% for three), and the absorbed NFT is burned for good —
the collection can only shrink. Its vault moves across rather than being
stranded. Three parts is the ceiling.

**Reforge.** An absorbed part freezes at the tier it carried when it went in.
Reforging raises it, priced off the same table, so fusing early never costs
more than fusing late.

## Running it locally

You need [Rust](https://rustup.rs), the
[Solana CLI](https://solana.com/docs/intro/installation) and
[Anchor](https://www.anchor-lang.com/docs/installation).

Three terminals.

**1 — validator.** Metaplex Core has to be loaded explicitly; a bare
`solana-test-validator` gives you a cluster without it and the seed dies on
the first Core call.

```bash
npm run validator
```

**2 — program and data:**

```bash
anchor deploy && npm run seed
```

To seed a wallet other than the CLI keypair (a browser wallet, say):

```bash
TARGET_WALLET=<your address> npm run seed
```

**3 — the site:**

```bash
cd app && npm run dev
```

Point your wallet at `http://127.0.0.1:8899` — and note that a browser
wallet uses its own keypair, so it needs its own airdrop unless you imported
the CLI key into it.

## Commands

| Command | What it does |
| --- | --- |
| `npm run validator` | Local cluster with Metaplex Core loaded |
| `anchor deploy` | Push the program to the running cluster |
| `npm run seed` | Mints, collection, protocol, pieces, a funded round |
| `npm run dev` (in `app/`) | The site; syncs the IDL first |
| `anchor test` | Full suite — starts its own validator |
| `npm run check:fuse` | Fuses two pieces and reads the feed back |
| `npm run check:ui` | Same, through the IDL copy the browser bundles |
| `npm run check:mint` | The batch mint the Mint page builds |

## Admin commands

Run against the protocol authority (the wallet in `ANCHOR_WALLET`). Every
command below targets the local validator; append `:devnet` to any of them to
run against devnet instead (e.g. `npm run mint:live:devnet`).

| Command | What it does |
| --- | --- |
| `npm run admin` | Prints the protocol state (paused, price, supply, costs, authority) |
| `npm run mint:live` | Opens minting |
| `npm run mint:stop` | Closes minting |
| `PRICE=0.25 npm run admin:price` | Sets the mint price, in SOL |
| `SUPPLY=3333 npm run admin:supply` | Lowers the hard supply cap |
| `COST=30000 npm run admin:activation` | Sets the activation cost, in whole $ANSEMW |
| `AMOUNT=5000 npm run admin:fund` | Funds the reward pool with $ANSEM |
| `NEW=<pubkey> CONFIRM=yes npm run admin:authority` | Transfers protocol authority to a new key |

`admin:authority` is irreversible and refuses to run without `CONFIRM=yes`.
All of these are driven by `scripts/admin.ts` via the `ADMIN_ACTION` env var.

Type errors in the frontend:

```bash
cd app && npx tsc -p tsconfig.app.json --noEmit
```

`npx tsc --noEmit` on its own checks nothing here — `app/tsconfig.json` is a
references-only file with `"files": []`.

## When to reset

Changing a field on an `#[account]` struct changes the account's size, and
accounts already on the ledger keep the old layout. Deploying over them is
not enough — restart from step 1. Adding or removing an instruction only
needs `anchor build && anchor deploy`, plus restarting the dev server so it
picks up the regenerated IDL.

## Layout

```
programs/ansem-world-v4/    the Anchor program
  src/state.rs              accounts: config, positions, reward state, feed
  src/instructions/         one file per instruction
app/                        React + Vite frontend
  src/idl/                  IDL copy the bundle imports, synced on dev
scripts/                    seed and end-to-end checks
tests/                      the Anchor suite
```

## Live on devnet

| | |
| --- | --- |
| Program | `9Ku7jCnxjyJuUiyXscjKk5ueMPpWQnUTwpLKZfzErq2E` |
| Collection | `AXBoysyK7KLn7GF9RhV81S9XWcoFwwkLeQyWYoSzkHDc` |
| $ANSEM | `55BgXe5an7iMgNvGTKSSW9djhyMS8fw9KQFcmKHBXj1G` |
| $ANSEMW | `AQi5Cscm36MpgAWXec9cmBpetDzz24mQJX2k6YvdN94X` |

Devnet SOL is free and worth nothing. Point your wallet at devnet, get some
from [faucet.solana.com](https://faucet.solana.com), and mint.

To deploy and seed it yourself:

```bash
anchor deploy --provider.cluster devnet
npm run seed:devnet
```

The seed picks its commitment level from the endpoint. Public devnet RPCs
rate-limit hard, and the `processed` level that makes a local run fast is
exactly what makes a devnet run expire mid-flight.

Mainnet would additionally need the metadata off GitHub and onto Arweave,
and the upgrade authority moved to a multisig.
