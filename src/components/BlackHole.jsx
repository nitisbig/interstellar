/**
 * Gargantua — the black hole, assembled entirely from layered, moving DOM.
 *
 * Back-to-front:
 *   bh-glow      soft warm aura (audio-reactive scale/opacity)
 *   bh-halo      the lensed Einstein ring (reads as the disk wrapping over top)
 *   bh-disk-back flattened, spinning accretion plane behind the core
 *   bh-core      the black event horizon sphere
 *   bh-photon    thin ultra-bright photon ring hugging the horizon
 *   bh-disk-front near rim of the disk, clipped and crossing in front
 *
 * Each disk is a circular conic-gradient that spins (.bh-spin); the parent
 * squashes it into an ellipse so the spin reads as orbital motion in a plane.
 */
export default function BlackHole() {
  return (
    <div className="blackhole" aria-hidden="true">
      <div className="bh-glow" />
      <div className="bh-halo" />

      <div className="bh-disk bh-disk-back">
        <div className="bh-spin" />
      </div>

      <div className="bh-core" />
      <div className="bh-photon" />

      <div className="bh-disk bh-disk-front">
        <div className="bh-spin" />
      </div>
    </div>
  );
}
