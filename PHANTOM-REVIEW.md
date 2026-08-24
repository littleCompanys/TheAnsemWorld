# Phantom / Blowfish review submission

Send to **review@phantom.com**, copy **review@blowfish.xyz**.
Subject: `dApp review request — theansemworld.xyz (Solana mainnet NFT mint)`

Attach: screenshots of the block dialog.

---

Hello,

theansemworld.xyz is being blocked with "Request Blocked — dApp May Be
Malicious" when users try to mint. We would like to request a review.

**Project:** The Ansem World
**Domain:** https://theansemworld.xyz
**Network:** Solana mainnet-beta
**Program ID:** 8877byAeJpCUWQhBWXQ5YrBPSrBa9761koygiFP1ijtP
**Collection:** EVA39AYzdg5YCL3b5n1Xc9HmpS2VUBDpJQS1LoDG9zMi (Metaplex Core)
**Source:** https://github.com/littleCompanys/TheAnsemWorld (public)
**Contact:** yanncomida1@gmail.com

## What the app does

An NFT collection of 3,333 Metaplex Core assets. A holder activates a
piece by burning a token, and an active piece earns rewards from a
shared pool. The only transaction a new user signs is the mint.

## What the mint transaction contains

Three instructions for a single piece:

1. `ComputeBudget` — SetComputeUnitLimit
2. `ComputeBudget` — SetComputeUnitPrice
3. `8877by…` — `mint_nft`

`mint_nft` internally CPIs to the System Program (to pay the mint price
and fund rent) and to Metaplex Core (to create the asset).

Programs involved, and why:

| Program ID | Purpose |
| --- | --- |
| `ComputeBudget111111111111111111111111111111` | unit limit and priority fee |
| `8877byAeJpCUWQhBWXQ5YrBPSrBa9761koygiFP1ijtP` | our program: mint_nft |
| `11111111111111111111111111111111` | System — price transfer, account rent (CPI) |
| `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | Metaplex Core — creates the NFT (CPI) |

## Where the SOL goes, per piece

| Amount | Destination | Reason |
| --- | --- | --- |
| 0.050000000 | `config.treasury`, fixed at initialization | mint price |
| 0.003866400 | the new asset account | rent (Metaplex Core) |
| 0.002275920 | the new Position PDA | rent (our program) |
| ~0.000006 | validator | fee + priority |

Total ≈ 0.0562 SOL. The destination address is stored on-chain at
initialization and cannot be changed by any instruction — there is no
setter for it.

## What the transaction does NOT do

Verified against simulation logs on mainnet:

- no `approve`, `delegate`, `setAuthority`, `revoke` or `closeAccount`
- no SPL token transfers of any kind
- no access to assets the wallet already holds
- no transfer to any address other than the two above
- wallet connect requests connection only — no `signMessage`, no
  automatic signature request

## Simulation results (mainnet)

| Pieces | Instructions | Signers | Size | `err` | Units consumed |
| --- | --- | --- | --- | --- | --- |
| 1 | 3 | 2 | 526 / 1232 bytes | `null` | 35,662 |
| 2 | 4 | 3 | 674 / 1232 bytes | `null` | 74,024 |

Every mint simulates cleanly.

## Signers

Two for a single-piece mint: the user's wallet, and a freshly generated
keypair for the asset itself. The second is required by Metaplex Core,
which uses the asset account's address as the NFT's permanent on-chain
address, so that account must sign its own creation. Minting N pieces in
one transaction adds one such keypair per piece. There is no backend
signer and no third-party signer. The collection authority is a PDA of
our own program and signs via `invoke_signed`.

## Example successful transactions

```
2treBTmYnRGHB3h4jAGJJSfyjJQTnoLyek9RJwQy1tvLKG6qBXFpCp3QP7k4zjbTjk9jGWzcArqDk3okzGsPZP9z
2qjmHJeYK4DnztY3ZAkKJUFjcGXodp7jse3dLYdVyQJReUahQ4UWxzHPAYyJ5KFmVT5Ntk8UNrJJDGqV71UFjZUN
4DzKH1ERk5mzV3tK5B3BW3YGSUtycwWEagXmMNs7ptxJq5GSBdNcySeojWeTQW2LfksZr78ZJgtb1jSnGRqY8PZh
4LhYQh97gUmzcKLgccjFdn2T6BRCSqPFX1HKbF8JUJ51fgZCqKzAFM7AUbD1jPdcYkwbrcuzE8t6NiCcajG2GXmK
```

All confirmed, all `err: null`.

Happy to provide anything else that helps.

---

## Before sending — decide two things

**1. The program ID.** The one above is a rehearsal deployment that will
be closed and replaced once the project's own token launches. The code
is identical. Either send now and follow up with the final id, or wait
for the real deployment and send once. Review takes days, so sending now
usually wins — but do not close the rehearsal program while the review
is open: the site would show "Protocol not initialized" to whoever opens
it, which is worse than any delay.

**2. A voucher.** Reports on Phantom's own discussions say a public
vouch from someone known in the Solana community moves this faster than
anything else in the submission. If you have that contact, use it.

## Also worth doing

- Open Graph tags, so the link renders as a real project when shared and
  when a reviewer opens it
- Keep minting live and accumulating clean transactions; reputation is
  partly volume of legitimate use
