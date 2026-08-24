# Mainnet rehearsal — runbook

Throwaway program, real cluster. Everything here is discarded at step 8,
which is the point: on a real instance the tier table, the treasury, the
base URI and the collection metadata all freeze the moment
`initialize_protocol` runs, and test mints become real pieces.

Test token: **BURNCOIN** `LV2VLhS53iannY2aas16Ke9yvxyKpAfMo4L2MUreYh5`
— classic SPL, 6 decimals, 1,000,000,000 supply, no mint or freeze
authority. Same shape $ANSEMW will have, so the burn paths and the stake
tier thresholds behave identically.

Run every block from the repo root. Steps are ordered; read the output
before moving on.

---

## 0 — Set these once per terminal

```bash
export W=$HOME/.config/solana/ansem-dev.json      # mainnet wallet (2gwXCG…)
export ANCHOR_WALLET=$W
export ANSEMW_MINT=LV2VLhS53iannY2aas16Ke9yvxyKpAfMo4L2MUreYh5
export BASE_URI=https://secret-herring-7tg9l.lighthouseweb3.xyz/ipfs/bafybeib2kh3ztgx4prmx45uvvvino7j7r6hzcjsokqydb2ws7dhmyhkzn4/
# Optional, and worth exercising - both are permanent on a real launch:
# export TREASURY=<address that receives mint revenue>
# export ROYALTY_DEST=<address that receives the 5% secondary royalty>
```

## 1 — Pre-flight

Needs ~4.9 SOL at peak: 4.65 locks in the program account (returned at
step 8), the rest covers accounts, tokens and fees.

```bash
solana address -k $W && solana balance $(solana address -k $W) --url mainnet-beta
```

Buy the tokens in Phantom (swap SOL → BURNCOIN, and SOL → ANSEM). About
0.15 SOL of BURNCOIN covers every burn plus the top stake tier; 0.05 SOL
of $ANSEM is plenty to test funding and claiming, since the reward math
is proportional and the absolute amount does not matter.

$ANSEM is `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`.

Then confirm both arrived:

```bash
solana balance $(solana address -k $W) --url mainnet-beta && spl-token accounts --owner $(solana address -k $W) --url mainnet-beta
```

## 2 — Throwaway program id

The keypair is disposable; it dies with the program at step 8.

```bash
solana-keygen new --no-bip39-passphrase --force -o target/deploy/ansem_world_v4-keypair.json
```

```bash
NEW=$(solana address -k target/deploy/ansem_world_v4-keypair.json) && sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$NEW\")/" programs/ansem-world-v4/src/lib.rs && sed -i "s/^ansem_world_v4 = .*/ansem_world_v4 = \"$NEW\"/" Anchor.toml && echo "program id: $NEW" && grep -n declare_id programs/ansem-world-v4/src/lib.rs
```

```bash
anchor build
```

## 3 — Deploy

Locks ~4.65 SOL. `--provider.wallet` overrides Anchor.toml so no file
edit is needed.

```bash
anchor deploy --provider.cluster mainnet-beta --provider.wallet $W
```

## 4 — Create the protocol, with minting shut

Refuses to run without ANSEMW_MINT on mainnet, and never creates a
throwaway token there. Read the summary it prints — the `piece #1 uri`
line is the one to check against where your metadata actually lives.

```bash
npm run launch:setup:mainnet
```

```bash
npm run admin:mainnet
```

## 5 — Point a preview at it

Production keeps its own env scope and is not touched.

```bash
cd app && npm run sync-idl && npx vercel deploy --yes ; cd ..
```

In the Vercel dashboard set `RPC_ENDPOINT` (Preview scope only) to a
mainnet RPC, then redeploy the preview.

## 6 — Open minting

```bash
npm run mint:live:mainnet
```

## 7 — Exercise it

Proves the chain, not the caller, picks each piece's art:

```bash
npm run check:metadata:mainnet
```

Then, through the preview UI with your wallet:

- mint 2–3 pieces, check the art follows the counter
- activate (25,000 BURNCOIN)
- upgrade tier 1 → 5 (825,000)
- fuse two pieces (50,000 then 100,000)
- stake and unstake (2,500,000, returned in full)
- transfer a piece to a second wallet, then sync_owner
- burn a piece from the wallet, then reap_burned

Fund a reward round with real $ANSEM, then claim. This is the one path
neither devnet nor the test suite covered: the real $ANSEM is a 401-byte
Token-2022 mint carrying metadata extensions, while every stand-in so
far was 82 bytes with none.

```bash
AMOUNT=10 npm run admin:fund:mainnet
```

```bash
npm run check:royalty:mainnet
```

List a piece on Tensor and confirm the 5% royalty lands, and that the
collection renders with a name and image. That check matters because
the collection URI freezes at `claim_collection_authority` and nothing
in this program can rewrite it afterwards.

## 8 — Tear it down

Unstake everything first, or the tokens stay in a vault whose program is
about to stop existing.

```bash
solana program close $(solana address -k target/deploy/ansem_world_v4-keypair.json) --url mainnet-beta -k $W --recipient $(solana address -k $W) --bypass-warning
```

```bash
solana balance $(solana address -k $W) --url mainnet-beta
```

The Core collection stays on-chain — collections cannot be closed. It
costs nothing and belongs to no one now, but it will exist.

## 9 — The real launch

Create $ANSEMW on the launchpad, then repeat 2 → 4 with a fresh keypair,
the real mint, and final values for the tier table, treasury, base URI
and collection metadata. None of those can be changed afterwards.

Then sync the IDL into `main` so production points at the live program:

```bash
cd app && npm run sync-idl && cd .. && git add -A && git commit -m "mainnet: point the app at the live program" && git push origin main
```

```bash
cd app && npx vercel deploy --prod --yes ; cd ..
```

Move the upgrade authority to a multisig **before** opening the mint —
until then, one key can rewrite every rule in this program:

```bash
solana program set-upgrade-authority $(solana address -k target/deploy/ansem_world_v4-keypair.json) --new-upgrade-authority <SQUADS_VAULT> --url mainnet-beta -k $W
```

```bash
npm run mint:live:mainnet
```

## If something goes wrong mid-rehearsal

```bash
npm run mint:stop:mainnet
```

Nothing here is worth rescuing — close the program (step 8), take the
SOL back, and start over.
