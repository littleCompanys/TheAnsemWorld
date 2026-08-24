# Mainnet rehearsal — runbook

A throwaway program on the real cluster. Everything here is deleted at
step 8, which is the point: on a real instance the tier table, the
treasury address, the base URI and the collection metadata all freeze
the moment `initialize_protocol` runs, and test mints become real pieces
out of the 3,333. A rehearsal you cannot discard is not a rehearsal.

Test token: **BURNCOIN** `LV2VLhS53iannY2aas16Ke9yvxyKpAfMo4L2MUreYh5`
— classic SPL, 6 decimals, 1,000,000,000 supply, no mint or freeze
authority. The same shape $ANSEMW will have, down to the supply, so both
the burn paths and the stake thresholds behave identically.

Revenue and royalties both go to the authority wallet for this run.

Run every block from the repo root, in order, and read the output before
moving on.

---

## 0 — Terminal setup

Once per terminal window. The RPC comes from your own `solana config`,
so the API key never lands in a file or in shell history.

```bash
export W=$HOME/.config/solana/ansem-dev.json && export ANCHOR_WALLET=$W && export MAINNET_RPC_URL=$(solana config get | awk '/RPC URL/{print $3}') && export ANSEMW_MINT=LV2VLhS53iannY2aas16Ke9yvxyKpAfMo4L2MUreYh5 && export BASE_URI=https://secret-herring-7tg9l.lighthouseweb3.xyz/ipfs/bafybeib2kh3ztgx4prmx45uvvvino7j7r6hzcjsokqydb2ws7dhmyhkzn4/
```

Confirm it picked up the right wallet — it must read `2gwXCG…`, not
`w37L…`, which is a different wallet with almost no SOL:

```bash
echo "wallet: $(solana address -k $W)" && echo "saldo : $(solana balance)" && echo "rpc   : ${MAINNET_RPC_URL%%\?*}"
```

## 1 — Build and give it an address

The keypair is disposable and dies with the program at step 8. A closed
program id can never be redeployed on that cluster, which is exactly why
the real launch gets a fresh one.

```bash
solana-keygen new --no-bip39-passphrase --force -o target/deploy/ansem_world_v4-keypair.json
```

The program has to know its own address: a mismatch between the id
baked into the binary and where it is installed makes it refuse to run.

```bash
NEW=$(solana address -k target/deploy/ansem_world_v4-keypair.json) && sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$NEW\")/" programs/ansem-world-v4/src/lib.rs && sed -i "s/^ansem_world_v4 = .*/ansem_world_v4 = \"$NEW\"/" Anchor.toml && echo "program id: $NEW"
```

```bash
anchor build
```

## 2 — Deploy

Takes a few minutes — the binary is ~668 KB and goes up in hundreds of
transactions. The 4.65 SOL is a rent deposit, not a fee, and comes back
in full at step 8.

Buy the tokens in Phantom while this runs. Nothing before step 6 needs
them: `launch-setup` only records BURNCOIN's address, it never checks a
balance.

```bash
anchor deploy --provider.cluster "$MAINNET_RPC_URL" --provider.wallet $W
```

If it fails partway the SOL is not lost — it sits in a buffer account:

```bash
solana program show --buffers --keypair $W
```

```bash
solana program close --buffers --keypair $W --bypass-warning
```

## 3 — Buy the test tokens (Phantom)

Switch Phantom to **Mainnet** and select the `2gwXCG…` account. Paste
each address into the swap search — neither shows up in the default
list. Raise slippage to 3% if BURNCOIN complains; it is thin, and 0.15
SOL moves it about 2%.

| Token | Address | Amount |
| --- | --- | --- |
| BURNCOIN | `LV2VLhS53iannY2aas16Ke9yvxyKpAfMo4L2MUreYh5` | 0.15 SOL |
| ANSEM | `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump` | 0.05 SOL |

```bash
spl-token accounts --owner $(solana address -k $W)
```

## 4 — Create the protocol, with minting shut

Creates the collection, the config, the vaults and the fuse feed, then
hands the collection's authority to the program — after which nothing,
including you, can mint a piece outside these rules.

Check the `piece #1 uri` line against where your metadata actually
lives, and that it ends `minting CLOSED`.

```bash
npm run launch:setup:mainnet
```

```bash
npm run admin:mainnet
```

## 5 — Point a preview at it

Production keeps its own environment scope and is not touched.

```bash
cd app && npm run sync-idl && npx vercel deploy --yes ; cd ..
```

In the Vercel dashboard set `RPC_ENDPOINT` for the **Preview** scope
only to your Helius URL, then redeploy the preview. Without it the site
looks for the program on the wrong cluster and reports the protocol as
missing.

## 6 — Open minting

```bash
npm run mint:live:mainnet
```

## 7 — Exercise it

This one proves the chain, not the caller, picks each piece's art — the
worst bug we found, and unfixable had it shipped, since nothing here can
rewrite an asset's metadata once Core has written it.

```bash
npm run check:metadata:mainnet
```

Then through the preview, with Phantom: mint two or three pieces and
check the art follows the counter; activate; upgrade tier 1 to 5; fuse
two pieces; stake and unstake; transfer a piece to a second wallet and
run sync_owner; burn a piece from the wallet and run reap_burned.

Then fund a round and claim it. This is the only path neither devnet nor
the test suite ever covered: the real $ANSEM is a 401-byte Token-2022
mint carrying metadata extensions, while every stand-in so far was 82
bytes with none.

```bash
AMOUNT=10 npm run admin:fund:mainnet
```

```bash
npm run check:royalty:mainnet
```

Expect the collection to show up unnamed on Magic Eden and Tensor — its
URI is still `https://example.com/collection.json`, hardcoded. Fine for
a rehearsal, and the reason to fix it before the real launch: it freezes
at `claim_collection_authority` and nothing in this program rewrites it.

## 8 — Tear it down

Unstake everything first. Locked tokens live in a vault owned by this
program, and a program that stops existing takes them with it.

```bash
solana program close $(solana address -k target/deploy/ansem_world_v4-keypair.json) --recipient $(solana address -k $W) --bypass-warning
```

```bash
solana balance
```

The Core collection stays on chain — collections cannot be closed. It
costs nothing and belongs to no one now, but it will be there.

## 9 — The real launch

Create $ANSEMW on the launchpad, then repeat steps 1 and 4 with a fresh
keypair, the real mint, and final values for the tier table, the base
URI and the collection metadata. None of those can be changed later.

Point production at the live program:

```bash
cd app && npm run sync-idl && cd .. && git add -A && git commit -m "mainnet: point the app at the live program" && git push origin main
```

```bash
cd app && npx vercel deploy --prod --yes ; cd ..
```

Move the upgrade authority to a multisig **before** opening the mint.
Until then a single key can rewrite every rule in this program, and that
is the first thing anyone evaluating the project will check.

```bash
solana program set-upgrade-authority $(solana address -k target/deploy/ansem_world_v4-keypair.json) --new-upgrade-authority <SQUADS_VAULT>
```

```bash
npm run mint:live:mainnet
```

## If something goes wrong mid-rehearsal

```bash
npm run mint:stop:mainnet
```

Nothing here is worth rescuing. Close the program, take the SOL back,
and start over.
