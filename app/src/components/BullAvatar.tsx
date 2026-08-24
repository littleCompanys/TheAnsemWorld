/**
 * Real NFT art: cycles through ansem1.png / ansem2.png / ansem3.png.
 *
 * BullAvatar — used on cards across the site.
 *   seed: any stable string (asset pubkey). Hashed to pick a variant
 *         deterministically, so the same piece always shows the same image.
 *   glow: adds a green ring when the piece is active.
 *
 * HeroBull / LogoMark remain SVG (they are brand elements, not NFT art).
 */

const ART_VARIANTS = 3;

const hash = (str: string) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
};

/** Pick a variant index (0-based) from any string seed. */
export function seedToVariant(seed: string): number {
  return hash(seed) % ART_VARIANTS;
}

/** Absolute URL to the art image for a given 0-based variant index. */
export function variantSrc(index: number): string {
  return `/nft/images/ansem${index + 1}.png`;
}

export function BullAvatar({
  seed,
  glow = false,
}: {
  seed: string;
  glow?: boolean;
}) {
  const src = variantSrc(seedToVariant(seed));
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <img
        src={src}
        alt="Ansem World piece"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: 6 }}
      />
      {glow && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 6,
          boxShadow: "0 0 0 2px #3dffa0, 0 0 18px 4px #3dffa066",
          pointerEvents: "none",
        }} />
      )}
    </div>
  );
}

export function HeroBull() {
  return (
    <svg className="bull" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 60C10 40 8 20 8 20s28 4 40 26" stroke="#3dffa0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M180 60C190 40 192 20 192 20s-28 4-40 26" stroke="#3dffa0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M45 60 C45 30 75 15 100 15 C125 15 155 30 155 60 C155 100 140 130 130 150 C122 165 110 175 100 175 C90 175 78 165 70 150 C60 130 45 100 45 60Z" stroke="#3dffa0" strokeWidth="3" />
      <circle cx="76" cy="80" r="6" fill="#3dffa0" />
      <circle cx="124" cy="80" r="6" fill="#3dffa0" />
      <path d="M85 118c4 6 26 6 30 0" stroke="#3dffa0" strokeWidth="3" strokeLinecap="round" />
      <circle cx="100" cy="128" r="9" stroke="#3dffa0" strokeWidth="2.5" />
      <path d="M70 60c8-4 16-4 30 0M100 60c14-4 22-4 30 0" stroke="#3dffa0" strokeWidth="2" />
    </svg>
  );
}

export function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 10C4 6 2 5 2 5s2 6 5 8" stroke="#3dffa0" strokeWidth="2" strokeLinecap="round" />
      <path d="M26 10C28 6 30 5 30 5s-2 6-5 8" stroke="#3dffa0" strokeWidth="2" strokeLinecap="round" />
      <rect x="9" y="10" width="14" height="13" rx="1.5" stroke="#3dffa0" strokeWidth="2" />
      <circle cx="13" cy="16" r="1.4" fill="#3dffa0" />
      <circle cx="19" cy="16" r="1.4" fill="#3dffa0" />
      <path d="M12 20h8" stroke="#3dffa0" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
