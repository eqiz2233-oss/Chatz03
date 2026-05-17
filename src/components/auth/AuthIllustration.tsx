/**
 * Decorative sunset/lake SVG for the right panel of the auth shell.
 *
 * Pure SVG so it scales crisply, themes via CSS vars, and weighs ~3 KB
 * inlined — no extra HTTP request, no PNG to swap when colors change.
 *
 * Composition (back → front):
 *   • Sky gradient (warm dusk over Chatz-purple horizon)
 *   • Sun glow + disc
 *   • Three mountain layers (back / mid / front) for depth
 *   • Water band with reflected sun + horizontal shimmer lines
 *   • Bare-tree silhouettes in the foreground (left + right clusters)
 *   • A subtle leaping orca silhouette to give the scene a focal moment
 *
 * The image is colorful but calm — meant to sit *next* to a login form,
 * not compete with it.
 */
export function AuthIllustration() {
  return (
    <svg
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      role="img"
      aria-label="Sunset over a mountain lake"
    >
      <defs>
        {/* Sky: deep purple top → warm orange mid → soft pink → lavender at the horizon */}
        <linearGradient id="ai-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#6d28d9" />
          <stop offset="22%"  stopColor="#9333ea" />
          <stop offset="42%"  stopColor="#f59e0b" />
          <stop offset="62%"  stopColor="#fbcfe8" />
          <stop offset="82%"  stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>

        {/* Sun glow — large, soft, falls off to transparent */}
        <radialGradient id="ai-sunGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#fffbeb" stopOpacity="0.95" />
          <stop offset="35%"  stopColor="#fde68a" stopOpacity="0.55" />
          <stop offset="70%"  stopColor="#fbbf24" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>

        {/* Sun core — bright but not pure white so it reads as sun, not lamp */}
        <radialGradient id="ai-sunCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#fffef0" />
          <stop offset="70%" stopColor="#fef3c7" />
          <stop offset="100%" stopColor="#fde68a" />
        </radialGradient>

        {/* Mountain layers — back layer lightest, front darkest */}
        <linearGradient id="ai-mtBack" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="ai-mtMid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6d28d9" />
          <stop offset="100%" stopColor="#4c1d95" />
        </linearGradient>
        <linearGradient id="ai-mtFront" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#312e81" />
          <stop offset="100%" stopColor="#1e1b4b" />
        </linearGradient>

        {/* Water — slightly cooler than the sky to give a "reflection" feel */}
        <linearGradient id="ai-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#a78bfa" />
          <stop offset="40%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#ddd6fe" />
        </linearGradient>

        {/* Reflected-sun stripe in the water — narrow, very soft */}
        <radialGradient id="ai-waterSun" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#fef3c7" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#fef3c7" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sky */}
      <rect width="600" height="800" fill="url(#ai-sky)" />

      {/* Sun glow (wide) */}
      <circle cx="320" cy="320" r="200" fill="url(#ai-sunGlow)" />
      {/* Sun core */}
      <circle cx="320" cy="320" r="78" fill="url(#ai-sunCore)" />

      {/* Mountains — back layer (softest, light purple, distant) */}
      <path
        d="M 0 470 L 60 410 L 130 450 L 220 360 L 310 430 L 400 380 L 480 420 L 560 380 L 600 410 L 600 560 L 0 560 Z"
        fill="url(#ai-mtBack)"
        opacity="0.85"
      />

      {/* Mountains — mid layer */}
      <path
        d="M 0 520 L 70 470 L 150 510 L 240 420 L 330 490 L 410 440 L 500 490 L 600 460 L 600 590 L 0 590 Z"
        fill="url(#ai-mtMid)"
        opacity="0.9"
      />

      {/* Mountains — front layer (darkest, with the iconic notch peak left of center) */}
      <path
        d="M 0 590 L 60 540 L 120 580 L 200 500 L 260 560 L 340 480 L 420 555 L 500 510 L 580 555 L 600 540 L 600 605 L 0 605 Z"
        fill="url(#ai-mtFront)"
      />

      {/* Water band */}
      <rect y="600" width="600" height="200" fill="url(#ai-water)" />

      {/* Reflected sun in the water — a wide soft pool, then a vertical stripe */}
      <ellipse cx="320" cy="615" rx="140" ry="14" fill="url(#ai-waterSun)" />
      <rect x="312" y="615" width="16" height="170" fill="url(#ai-waterSun)" opacity="0.7" />

      {/* Water shimmer lines — a few thin near-horizontal strokes to suggest ripples */}
      <g stroke="#ffffff" strokeOpacity="0.35" strokeLinecap="round">
        <line x1="60"  y1="650" x2="150" y2="650" strokeWidth="1.2" />
        <line x1="430" y1="660" x2="520" y2="660" strokeWidth="1.2" />
        <line x1="100" y1="700" x2="220" y2="700" strokeWidth="1" />
        <line x1="380" y1="710" x2="490" y2="710" strokeWidth="1" />
        <line x1="40"  y1="745" x2="180" y2="745" strokeWidth="0.8" />
        <line x1="350" y1="755" x2="500" y2="755" strokeWidth="0.8" />
      </g>

      {/* Leaping orca silhouette — stylized arch in the mid-distance */}
      <g fill="#1e1b4b" opacity="0.85">
        <path d="
          M 450 590
          C 455 565, 470 545, 495 540
          C 520 535, 540 555, 545 580
          L 538 580
          C 533 564, 522 555, 508 555
          C 488 555, 472 570, 466 590
          Z
        " />
        {/* Tail flick */}
        <path d="M 540 575 L 553 558 L 558 568 L 548 580 Z" />
        {/* White belly highlight */}
        <path d="M 478 583 C 483 575, 495 572, 505 575 L 503 580 C 495 578, 487 580, 483 586 Z" fill="#fafafa" opacity="0.5" />
      </g>

      {/* Foreground bare trees — left cluster */}
      <g stroke="#0f0a24" strokeLinecap="round" fill="none">
        {/* Tree 1 */}
        <line x1="55" y1="800" x2="55" y2="610" strokeWidth="3" />
        <line x1="55" y1="660" x2="42" y2="640" strokeWidth="2" />
        <line x1="55" y1="650" x2="68" y2="628" strokeWidth="2" />
        <line x1="55" y1="630" x2="44" y2="615" strokeWidth="1.5" />
        <line x1="55" y1="625" x2="65" y2="612" strokeWidth="1.5" />

        {/* Tree 2 (taller) */}
        <line x1="100" y1="800" x2="100" y2="575" strokeWidth="3.2" />
        <line x1="100" y1="640" x2="85"  y2="615" strokeWidth="2.2" />
        <line x1="100" y1="625" x2="115" y2="600" strokeWidth="2" />
        <line x1="100" y1="605" x2="88"  y2="585" strokeWidth="1.6" />
        <line x1="100" y1="595" x2="110" y2="582" strokeWidth="1.4" />
      </g>

      {/* Foreground bare trees — right cluster */}
      <g stroke="#0f0a24" strokeLinecap="round" fill="none">
        {/* Tree 3 */}
        <line x1="420" y1="800" x2="420" y2="600" strokeWidth="3" />
        <line x1="420" y1="650" x2="408" y2="628" strokeWidth="2" />
        <line x1="420" y1="640" x2="434" y2="618" strokeWidth="2" />
        <line x1="420" y1="618" x2="410" y2="606" strokeWidth="1.5" />

        {/* Tree 4 (small) */}
        <line x1="470" y1="800" x2="470" y2="640" strokeWidth="2.6" />
        <line x1="470" y1="680" x2="458" y2="660" strokeWidth="1.8" />
        <line x1="470" y1="670" x2="484" y2="650" strokeWidth="1.8" />

        {/* Tree 5 (tallest, anchors the right side) */}
        <line x1="535" y1="800" x2="535" y2="555" strokeWidth="3.4" />
        <line x1="535" y1="615" x2="518" y2="590" strokeWidth="2.4" />
        <line x1="535" y1="600" x2="554" y2="572" strokeWidth="2.2" />
        <line x1="535" y1="580" x2="522" y2="562" strokeWidth="1.6" />
        <line x1="535" y1="570" x2="548" y2="555" strokeWidth="1.4" />
      </g>

      {/* Subtle vignette to keep the form panel visually dominant */}
      <rect
        width="600"
        height="800"
        fill="url(#ai-sky)"
        opacity="0"
      />
    </svg>
  );
}
