import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createV1,
  createCollection as createCollectionWithPlugins,
  transferV1,
  ruleSet,
  MPL_CORE_PROGRAM_ID,
} from "@metaplex-foundation/mpl-core";
import {
  mplTokenMetadata,
  createMetadataAccountV3,
  findMetadataPda,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createSignerFromKeypair,
  signerIdentity,
  generateSigner,
  publicKey as umiPublicKey,
  type Umi,
  type Signer,
} from "@metaplex-foundation/umi";

/// Local validators have no forks to protect against, so "processed"
/// confirms are safe there and save ~13s a transaction. Public devnet
/// RPCs are the opposite case: they rate-limit and drop blockhashes,
/// and a "processed" confirm expires mid-run.
const commitmentFor = (endpoint: string) =>
  endpoint.includes("127.0.0.1") || endpoint.includes("localhost")
    ? ("processed" as const)
    : ("confirmed" as const);

/// Bridges the Anchor/web3.js world (Keypair, PublicKey) to Umi,
/// which is what the Metaplex Core client speaks.
export const makeUmi = (endpoint: string, payer: Keypair): Umi => {
  const umi = createUmi(endpoint, { commitment: commitmentFor(endpoint) })
    .use(mplTokenMetadata());
  const kp = umi.eddsa.createKeypairFromSecretKey(payer.secretKey);
  return umi.use(signerIdentity(createSignerFromKeypair(umi, kp)));
};

/// Confirm options for every send in this file, matched to the cluster
/// the run is pointed at.
const FAST = {
  confirm: {
    commitment: commitmentFor(
      process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899"
    ),
  },
};

/// `anchor test` hands control over the instant the validator
/// answers RPC. At that point genesis balances already read back
/// fine, but the bank has not advanced far enough to actually
/// process a transaction, and the first send dies with "found no
/// record of a prior credit". Waiting for the chain to produce a
/// few slots is what makes the suite reliable from a cold start.
export const waitForChain = async (umi: Umi, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const balance = await umi.rpc.getBalance(umi.identity.publicKey);
    const slot = await umi.rpc.getSlot();
    if (balance.basisPoints > BigInt(0) && slot > 2) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("validator never became ready");
};

export const toWeb3 = (key: { toString(): string }) =>
  new PublicKey(key.toString());

export const umiSignerFor = (umi: Umi, kp: Keypair): Signer =>
  createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(kp.secretKey));

/// Creates a real Core collection and returns its address.
/// Basis points of every secondary sale owed to the project.
export const ROYALTY_BASIS_POINTS = 500; // 5%

/// Creates the Core collection, with the royalty plugin attached.
///
/// The plugin lives on the collection rather than on each asset: Core
/// assets inherit their collection's plugins, so this costs one account
/// instead of ten thousand, and every piece minted later is covered
/// without touching the mint path.
///
/// This is a one-shot decision. claim_collection_authority hands the
/// collection's update authority to the config PDA, and the program has
/// no instruction to add or change a plugin afterwards - so a collection
/// created without royalties can never earn them.
///
/// ruleSet is "None" deliberately. ProgramDenyList would let Core reject
/// transfers through marketplaces that skip royalties, but the list would
/// be frozen the moment the authority moves: unable to add a new bad
/// actor, unable to clear a program that later becomes legitimate. A
/// permanently stale blocklist is a liability, not enforcement.
export const createCollection = async (
  umi: Umi,
  royaltyDestination?: PublicKey,
  basisPoints = ROYALTY_BASIS_POINTS
) => {
  const collection = generateSigner(umi);
  const payee = royaltyDestination
    ? umiPublicKey(royaltyDestination.toBase58())
    : umi.identity.publicKey;

  await createCollectionWithPlugins(umi, {
    collection,
    name: "Ansem World",
    uri: "https://example.com/collection.json",
    plugins: [
      {
        type: "Royalties",
        basisPoints,
        creators: [{ address: payee, percentage: 100 }],
        ruleSet: ruleSet("None"),
      },
    ],
  }).sendAndConfirm(umi, FAST);
  return collection;
};

/// Mints a real Core Asset into `owner`, inside `collection`.
export const mintAsset = async (
  umi: Umi,
  collection: { publicKey: any },
  owner: PublicKey,
  name = "Ansem World",
  uri = "https://example.com/asset.json"
) => {
  const asset = generateSigner(umi);
  await createV1(umi, {
    asset,
    collection: collection.publicKey,
    name,
    uri,
    owner: umiPublicKey(owner.toBase58()),
  }).sendAndConfirm(umi, FAST);
  return asset;
};

/// Transfers a Core Asset, which is what a secondary sale looks
/// like on chain.
export const transferAsset = async (
  umi: Umi,
  asset: { publicKey: any },
  collection: { publicKey: any },
  from: Signer,
  to: PublicKey
) => {
  await transferV1(umi, {
    asset: asset.publicKey,
    collection: collection.publicKey,
    authority: from,
    newOwner: umiPublicKey(to.toBase58()),
  }).sendAndConfirm(umi, FAST);
};

/// Attaches a Metaplex Token Metadata account to an SPL Token mint that
/// was created bare (`createMint` from @solana/spl-token only runs
/// InitializeMint - name/symbol/image are a separate account the wallet
/// UI looks up by convention, not something the mint itself carries).
///
/// Devnet/local test mints only: mainnet tokens come from pump.fun,
/// which already attaches this account as part of its own launch flow -
/// calling this against a mint you don't hold mint authority over would
/// just fail.
export const attachTokenMetadata = async (
  umi: Umi,
  mint: PublicKey,
  name: string,
  symbol: string,
  uri: string
) => {
  const mintPk = umiPublicKey(mint.toBase58());
  const metadata = findMetadataPda(umi, { mint: mintPk });
  await createMetadataAccountV3(umi, {
    metadata,
    mint: mintPk,
    mintAuthority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity,
    data: {
      name,
      symbol,
      uri,
      sellerFeeBasisPoints: 0,
      creators: null,
      collection: null,
      uses: null,
    },
    isMutable: true,
    collectionDetails: null,
  }).sendAndConfirm(umi, FAST);
};

export { MPL_CORE_PROGRAM_ID };
