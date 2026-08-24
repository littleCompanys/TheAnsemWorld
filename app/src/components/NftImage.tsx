import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BullAvatar } from "./BullAvatar";
import { MPL_CORE_PROGRAM_ID } from "../lib/program";
import { readAssetUri } from "../lib/useAnsem";

/**
 * Real per-piece art.
 *
 * The old path rendered every card with BullAvatar, which hashed the
 * asset key into one of only three local images - so the whole
 * collection showed the same handful of pictures regardless of what
 * each NFT's metadata actually pointed at. NftImage instead reads the
 * asset's on-chain metadata URI, fetches that JSON, and shows its
 * `image` field (the real IPFS art). It only falls back to BullAvatar
 * while the fetch is in flight or if it fails, so nothing ever renders
 * blank.
 *
 * Pass `uri` when the caller already has it (useOwnedNfts provides it)
 * to skip an RPC round-trip; otherwise the asset account is read once
 * and cached.
 */

// Shared across every card so the same asset / metadata document is
// only ever fetched once per page load, no matter how many cards point
// at it. `null` is a cached negative result (resolved, but no image).
const uriCache = new Map<string, string | null>();
const imageCache = new Map<string, string | null>();

async function resolveUri(
  connection: ReturnType<typeof useConnection>["connection"],
  id: string,
  provided?: string | null
): Promise<string | null> {
  if (provided) return provided;
  if (uriCache.has(id)) return uriCache.get(id) ?? null;
  try {
    const info = await connection.getAccountInfo(new PublicKey(id));
    // Only Core assets carry this layout; guard on the owning program so
    // a stray account can't be misread into a bogus URI.
    const uri =
      info && info.owner.equals(MPL_CORE_PROGRAM_ID)
        ? readAssetUri(info.data as Buffer) || null
        : null;
    uriCache.set(id, uri);
    return uri;
  } catch {
    uriCache.set(id, null);
    return null;
  }
}

async function resolveImage(uri: string): Promise<string | null> {
  if (imageCache.has(uri)) return imageCache.get(uri) ?? null;
  try {
    const res = await fetch(uri);
    if (!res.ok) {
      imageCache.set(uri, null);
      return null;
    }
    const json = await res.json();
    const image = typeof json?.image === "string" ? json.image : null;
    imageCache.set(uri, image);
    return image;
  } catch {
    imageCache.set(uri, null);
    return null;
  }
}

export function NftImage({
  asset,
  uri,
  glow = false,
  alt = "Ansem World piece",
}: {
  asset: PublicKey | string;
  uri?: string | null;
  glow?: boolean;
  alt?: string;
}) {
  const { connection } = useConnection();
  const id = typeof asset === "string" ? asset : asset.toBase58();

  // Seed the initial src from cache when possible so a re-render (or a
  // second card for the same piece) shows the art immediately.
  const [src, setSrc] = useState<string | null>(() => {
    const u = uri ?? (uriCache.has(id) ? uriCache.get(id) : undefined);
    return u ? imageCache.get(u) ?? null : null;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      const metaUri = await resolveUri(connection, id, uri);
      if (cancelled || !metaUri) return;
      const image = await resolveImage(metaUri);
      if (!cancelled && image) setSrc(image);
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, id, uri]);

  if (!src || failed) return <BullAvatar seed={id} glow={glow} />;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <img
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          borderRadius: 6,
        }}
      />
      {glow && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 6,
            boxShadow: "0 0 0 2px #3dffa0, 0 0 18px 4px #3dffa066",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
