import * as THREE from 'three';
import type { DebateTurn, MarketTicker, OrderBookSnapshot, TradingSignal } from '../../engine/types';
import { getCompanyPlaqueLines } from '../../data/companyProfile';
import type { Locale } from '../../i18n/translations';

export interface RoomScreens {
  marketTex: THREE.CanvasTexture;
  marketCtx: CanvasRenderingContext2D;
  verdictTex: THREE.CanvasTexture;
  verdictCtx: CanvasRenderingContext2D;
  debateTex: THREE.CanvasTexture;
  debateCtx: CanvasRenderingContext2D;
  drawScreens: (params: {
    ticker: MarketTicker | null;
    orderBook: OrderBookSnapshot | null;
    signal: TradingSignal | null;
    activeTurn: DebateTurn | null;
    tradingMode: string;
    locale?: Locale;
  }) => void;
  dispose: () => void;
}

function createScreenCanvas(width = 768, height = 384): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return { canvas, ctx, tex };
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
      if (lines.length >= maxLines) break;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

export function buildTradingRoomEnvironment(
  scene: THREE.Scene,
  maxAnisotropy: number,
): {
  screens: RoomScreens;
  masterCrystal: THREE.Mesh;
  gimbalOuter: THREE.Mesh;
  gimbalInner: THREE.Mesh;
  shieldRing: THREE.Mesh;
  shieldMat: THREE.MeshStandardMaterial;
  crystalMat: THREE.MeshPhysicalMaterial;
  holoBars: THREE.InstancedMesh;
  companyBoardProxy: THREE.Mesh;
} {
  const roomGroup = new THREE.Group();

  // 1. Stepped Institutional Trading Floor & Command Dais
  const outerDeckGeo = new THREE.CylinderGeometry(11.6, 12.1, 0.24, 64);
  const darkDeckMat = new THREE.MeshStandardMaterial({
    color: 0x0b1220,
    metalness: 0.72,
    roughness: 0.38,
  });
  const outerDeck = new THREE.Mesh(outerDeckGeo, darkDeckMat);
  outerDeck.position.y = -0.14;
  outerDeck.receiveShadow = true;
  roomGroup.add(outerDeck);

  const innerDaisGeo = new THREE.CylinderGeometry(4.55, 4.85, 0.14, 48);
  const daisMat = new THREE.MeshStandardMaterial({
    color: 0x111c30,
    metalness: 0.78,
    roughness: 0.28,
  });
  const innerDais = new THREE.Mesh(innerDaisGeo, daisMat);
  innerDais.position.y = 0.05;
  innerDais.receiveShadow = true;
  roomGroup.add(innerDais);

  const gridHelper = new THREE.GridHelper(36, 36, 0x1d3b5c, 0x0d1829);
  gridHelper.position.y = -0.005;
  roomGroup.add(gridHelper);

  // Concentric glowing floor calibration strips (polygonOffset prevents Z-fighting)
  const floorRingMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    emissive: 0x0369a1,
    emissiveIntensity: 0.45,
    metalness: 0.85,
    roughness: 0.22,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  [4.55, 6.95, 9.2].forEach((r) => {
    const rGeo = new THREE.RingGeometry(r - 0.035, r + 0.035, 64);
    const rMesh = new THREE.Mesh(rGeo, floorRingMat);
    rMesh.rotation.x = -Math.PI / 2;
    rMesh.position.y = 0.025;
    roomGroup.add(rMesh);
  });

  // 2. Architectural Framing Pillars along rear perimeter (open front for camera)
  const pillarBodyGeo = new THREE.BoxGeometry(0.45, 5.4, 0.65);
  const pillarStripGeo = new THREE.BoxGeometry(0.08, 4.8, 0.08);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x172133,
    metalness: 0.75,
    roughness: 0.42,
  });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });

  const pillarAngles = [-0.88, -0.68, -0.32, -0.12].map((f) => f * Math.PI);
  pillarAngles.forEach((ang) => {
    const pGroup = new THREE.Group();
    const px = Math.cos(ang) * 10.7;
    const pz = Math.sin(ang) * 10.7;
    pGroup.position.set(px, 2.7, pz);
    pGroup.lookAt(0, 2.7, 0);

    const body = new THREE.Mesh(pillarBodyGeo, pillarMat);
    pGroup.add(body);
    const strip = new THREE.Mesh(pillarStripGeo, stripMat);
    strip.position.set(0, 0, 0.34);
    pGroup.add(strip);
    roomGroup.add(pGroup);
  });

  // 3. Central Holographic Conference War-Room Table
  const tableGroup = new THREE.Group();
  const tablePedestalGeo = new THREE.CylinderGeometry(1.1, 1.55, 0.72, 16);
  const tablePedestal = new THREE.Mesh(tablePedestalGeo, daisMat);
  tablePedestal.position.y = 0.42;
  tableGroup.add(tablePedestal);

  // Table outer titanium rim
  const tableRimGeo = new THREE.TorusGeometry(2.55, 0.14, 16, 48);
  const titaniumMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    metalness: 0.9,
    roughness: 0.24,
  });
  const tableRim = new THREE.Mesh(tableRimGeo, titaniumMat);
  tableRim.rotation.x = Math.PI / 2;
  tableRim.position.y = 0.82;
  tableGroup.add(tableRim);

  // Table translucent holographic glass deck
  const tableTopGeo = new THREE.CylinderGeometry(2.52, 2.52, 0.06, 48);
  const tableTopMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1f33,
    metalness: 0.25,
    roughness: 0.15,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.82,
  });
  const tableTop = new THREE.Mesh(tableTopGeo, tableTopMat);
  tableTop.position.y = 0.81;
  tableTop.receiveShadow = true;
  tableGroup.add(tableTop);

  // Recessed tabletop holo emitter ring
  const emitterRingGeo = new THREE.RingGeometry(1.25, 1.32, 48);
  const emitterRingMat = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    side: THREE.DoubleSide,
  });
  const emitterRing = new THREE.Mesh(emitterRingGeo, emitterRingMat);
  emitterRing.rotation.x = -Math.PI / 2;
  emitterRing.position.y = 0.855;
  tableGroup.add(emitterRing);

  // Mini Holographic Candlestick Cluster floating slightly over tabletop center
  const holoBarGeo = new THREE.BoxGeometry(0.11, 1, 0.11);
  const holoBarMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x0f172a,
    metalness: 0.3,
    roughness: 0.25,
  });
  const holoBars = new THREE.InstancedMesh(holoBarGeo, holoBarMat, 14);
  holoBars.frustumCulled = false;
  tableGroup.add(holoBars);

  // Master AI Orchestrator Gyroscopic Hologram above table center
  const masterGroup = new THREE.Group();
  masterGroup.position.set(0, 1.95, 0);

  const crystalGeo = new THREE.OctahedronGeometry(0.56, 0);
  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0x22d3ee,
    emissive: 0x0e7490,
    emissiveIntensity: 0.75,
    metalness: 0.2,
    roughness: 0.12,
    clearcoat: 1.0,
  });
  const masterCrystal = new THREE.Mesh(crystalGeo, crystalMat);
  masterGroup.add(masterCrystal);

  const gimbalOuter = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.038, 12, 48), titaniumMat);
  masterGroup.add(gimbalOuter);

  const gimbalInner = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.028, 12, 48), titaniumMat);
  gimbalInner.rotation.x = Math.PI / 2.5;
  masterGroup.add(gimbalInner);

  tableGroup.add(masterGroup);
  roomGroup.add(tableGroup);

  // Contact shadow disc under conference table
  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(2.7, 36),
    new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.set(0, 0.125, 0);
  roomGroup.add(shadowDisc);

  // Risk Containment Shield Ring around main dais
  const shieldMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x064e3b,
    emissiveIntensity: 0.55,
    metalness: 0.72,
    roughness: 0.25,
  });
  const shieldRing = new THREE.Mesh(new THREE.TorusGeometry(4.55, 0.055, 12, 64), shieldMat);
  shieldRing.rotation.x = Math.PI / 2;
  shieldRing.position.y = 0.16;
  roomGroup.add(shieldRing);

  // 4. Three Panoramic Curved Holographic Wall Screens behind the dais
  const marketCanvas = createScreenCanvas(768, 384);
  const verdictCanvas = createScreenCanvas(896, 420);
  const debateCanvas = createScreenCanvas(768, 384);
  [marketCanvas.tex, verdictCanvas.tex, debateCanvas.tex].forEach((t) => {
    t.anisotropy = maxAnisotropy;
  });

  const makeCurvedPanel = (
    tex: THREE.CanvasTexture,
    thetaStart: number,
    thetaLength: number,
    radius: number,
    height: number,
    yPos: number,
    frameColor: number,
  ) => {
    // Inner face of a cylinder segment facing inward (openEnded = true, BackSide)
    const geo = new THREE.CylinderGeometry(radius, radius, height, 32, 1, true, thetaStart, thetaLength);
    // Flip horizontal UV so text reads left-to-right from inside the room
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setX(i, 1 - uv.getX(i));
    }
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.96,
    });
    const screenMesh = new THREE.Mesh(geo, mat);
    screenMesh.position.y = yPos;
    roomGroup.add(screenMesh);

    const frameGeo = new THREE.CylinderGeometry(
      radius + 0.08,
      radius + 0.08,
      height + 0.18,
      32,
      1,
      true,
      thetaStart - 0.015,
      thetaLength + 0.03,
    );
    const frameMat = new THREE.MeshStandardMaterial({
      color: frameColor,
      metalness: 0.8,
      roughness: 0.3,
      side: THREE.BackSide,
    });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.y = yPos;
    roomGroup.add(frameMesh);
  };

  // In Three.js CylinderGeometry, theta = 0 is +Z, theta = PI is -Z!
  // Rear wall spans centered around theta = PI (-Z).
  makeCurvedPanel(verdictCanvas.tex, Math.PI - 0.34, 0.68, 9.4, 3.25, 3.25, 0x0f172a);
  makeCurvedPanel(marketCanvas.tex, Math.PI + 0.42, 0.56, 9.4, 2.9, 3.05, 0x0f172a);
  makeCurvedPanel(debateCanvas.tex, Math.PI - 0.98, 0.56, 9.4, 2.9, 3.05, 0x0f172a);

  // 5. Composite 6-Part Executive Corporate Plaque ("GIÁO SƯ · PROF.TOAN") centered above panoramic gantry
  const plaqueCanvas = createScreenCanvas(1024, 256);
  plaqueCanvas.tex.anisotropy = maxAnisotropy;
  {
    const ctx = plaqueCanvas.ctx;
    const W = 1024;
    const H = 256;
    const lines = getCompanyPlaqueLines();

    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#060B14');
    bgGrad.addColorStop(0.5, '#0D1728');
    bgGrad.addColorStop(1, '#060B14');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle champagne-gold architectural double border
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(20, 20, W - 40, H - 40);

    // Wide flanking monogram bars (well clear of centered label)
    ctx.fillStyle = '#FBBF24';
    ctx.fillRect(W / 2 - 365, 48, 120, 2);
    ctx.fillRect(W / 2 + 245, 48, 120, 2);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#FCD34D';
    ctx.font = 'bold 21px monospace';
    ctx.fillText('FOUNDER & EXECUTIVE LAB', W / 2, 55);

    ctx.fillStyle = '#FEF3C7';
    ctx.font = 'bold 70px sans-serif';
    ctx.fillText(lines.title, W / 2, 134);

    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 23px monospace';
    ctx.fillText(lines.subtitle, W / 2, 180);

    ctx.fillStyle = '#CBD5E1';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(lines.badgeLine, W / 2, 220);
    ctx.textAlign = 'left';

    plaqueCanvas.tex.needsUpdate = true;
  }

  const plaqueGroup = new THREE.Group();
  plaqueGroup.position.set(0, 5.58, -9.28);

  const plaqueChassisMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.85,
    roughness: 0.25,
  });
  const champagneGoldMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    emissive: 0x785609,
    emissiveIntensity: 0.35,
    metalness: 0.92,
    roughness: 0.18,
  });

  // Part 1: Brushed titanium & obsidian rear housing
  const plaqueHousing = new THREE.Mesh(new THREE.BoxGeometry(5.36, 1.38, 0.14), plaqueChassisMat);
  plaqueGroup.add(plaqueHousing);

  // Part 2: Champagne-gold architectural bezel frame
  const plaqueBezel = new THREE.Mesh(new THREE.BoxGeometry(5.46, 1.46, 0.06), champagneGoldMat);
  plaqueBezel.position.z = -0.02;
  plaqueGroup.add(plaqueBezel);

  // Part 3: Illuminated obsidian face displaying CanvasTexture
  const plaqueFaceMat = new THREE.MeshBasicMaterial({
    map: plaqueCanvas.tex,
  });
  const plaqueFace = new THREE.Mesh(new THREE.PlaneGeometry(5.16, 1.24), plaqueFaceMat);
  plaqueFace.position.z = 0.075;
  plaqueGroup.add(plaqueFace);

  // Part 4 & 5: Twin vertical mounting pylons anchoring plaque to rear panoramic gantry
  const pylonGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.86, 10);
  [-1.95, 1.95].forEach((px) => {
    const pylon = new THREE.Mesh(pylonGeo, titaniumMat);
    pylon.position.set(px, -0.98, -0.06);
    plaqueGroup.add(pylon);
  });

  // Part 6: Warm gold crown accent rail
  const crownRail = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.045, 0.1), champagneGoldMat);
  crownRail.position.set(0, 0.76, 0.02);
  plaqueGroup.add(crownRail);

  // Clickable Layer-1 Proxy for Company Dossier modal
  const companyBoardProxy = new THREE.Mesh(
    new THREE.BoxGeometry(5.5, 1.5, 0.4),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  companyBoardProxy.layers.set(1);
  companyBoardProxy.userData.companyBoard = true;
  plaqueGroup.add(companyBoardProxy);

  roomGroup.add(plaqueGroup);

  scene.add(roomGroup);

  const drawScreens: RoomScreens['drawScreens'] = ({
    ticker,
    orderBook,
    signal,
    activeTurn,
    tradingMode,
    locale = 'vi',
  }) => {
    const isEn = locale === 'en';
    // --- Left Screen: Market Microstructure ---
    {
      const ctx = marketCanvas.ctx;
      const W = 768;
      const H = 384;
      ctx.fillStyle = '#070E1A';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#1E3A5F';
      ctx.lineWidth = 4;
      ctx.strokeRect(8, 8, W - 16, H - 16);

      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold 24px monospace';
      ctx.fillText('MARKET TELEMETRY FEED', 32, 48);

      const srcBadge = ticker?.dataStatus === 'LIVE_EXCHANGE' ? 'LIVE EXCHANGE' : (ticker?.dataStatus ?? 'OFFLINE');
      ctx.fillStyle = ticker?.dataStatus === 'LIVE_EXCHANGE' ? '#10B981' : '#F59E0B';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(srcBadge, W - 32, 48);
      ctx.textAlign = 'left';

      ctx.fillStyle = '#F8FAFC';
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText(ticker ? `${ticker.symbol}` : 'BTC/USDT', 32, 114);

      ctx.fillStyle = '#22D3EE';
      ctx.font = 'bold 46px monospace';
      ctx.fillText(
        ticker ? `$${ticker.lastPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--',
        32,
        172,
      );

      const chg = ticker?.change24hPct ?? 0;
      ctx.fillStyle = chg >= 0 ? '#10B981' : '#F43F5E';
      ctx.font = 'bold 28px monospace';
      ctx.fillText(`${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% (24H)`, 32, 214);

      const rows = [
        ['REGIME', ticker?.regime ?? 'N/A'],
        ['SPREAD', `${(orderBook?.spreadBps ?? ticker?.spreadBps ?? 0).toFixed(2)} bps`],
        ['IMBALANCE', `${((orderBook?.imbalanceRatio ?? 0) * 100).toFixed(1)}%`],
        ['RSI 14', `${ticker?.rsi14 !== null && ticker?.rsi14 !== undefined ? ticker.rsi14.toFixed(1) : '--'}`],
      ];
      rows.forEach(([k, v], i) => {
        const y = 264 + i * 28;
        ctx.fillStyle = '#94A3B8';
        ctx.font = '20px monospace';
        ctx.fillText(k, 32, y);
        ctx.fillStyle = '#E2E8F0';
        ctx.font = 'bold 20px monospace';
        ctx.fillText(v, 220, y);
      });

      marketCanvas.tex.needsUpdate = true;
    }

    // --- Center Screen: Consensus Verdict & Execution Levels ---
    {
      const ctx = verdictCanvas.ctx;
      const W = 896;
      const H = 420;
      ctx.fillStyle = '#070E1A';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = tradingMode === 'EMERGENCY_STOP' ? '#EF4444' : '#0EA5E9';
      ctx.lineWidth = 4;
      ctx.strokeRect(8, 8, W - 16, H - 16);

      ctx.fillStyle = '#94A3B8';
      ctx.font = 'bold 22px monospace';
      ctx.fillText('AI INVESTMENT COMMITTEE · FINAL CONSENSUS', 36, 46);

      const dir = signal?.direction ?? 'ANALYZING';
      const approved = signal?.state === 'APPROVED';
      ctx.fillStyle =
        dir === 'LONG' && approved
          ? '#10B981'
          : dir === 'SHORT' && approved
            ? '#F43F5E'
            : '#F59E0B';
      ctx.font = 'bold 58px sans-serif';
      ctx.fillText(dir, 36, 122);

      ctx.fillStyle = approved ? '#10B981' : '#F59E0B';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(
        signal ? `${signal.state} · CONF ${signal.confidenceScore}/100` : `MODE: ${tradingMode}`,
        36,
        164,
      );

      // Signal Precision Metrics
      const metrics = [
        ['ENTRY', signal ? `$${signal.entryRange[0].toFixed(2)}` : '--'],
        ['STOP LOSS', signal ? `$${signal.stopLoss.toFixed(2)}` : '--'],
        ['TAKE PROFIT', signal?.takeProfitLevels?.[1] ? `$${signal.takeProfitLevels[1].toFixed(2)}` : '--'],
        ['RISK / REWARD', signal ? `${signal.riskReward}x · ${signal.riskCheck.decision}` : '--'],
      ];
      metrics.forEach(([label, val], idx) => {
        const bx = 36 + (idx % 2) * 415;
        const by = 196 + Math.floor(idx / 2) * 84;
        ctx.fillStyle = '#0E172A';
        ctx.fillRect(bx, by, 395, 70);
        ctx.strokeStyle = '#1E293B';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, 395, 70);

        ctx.fillStyle = '#64748B';
        ctx.font = '18px monospace';
        ctx.fillText(label, bx + 16, by + 26);

        ctx.fillStyle = '#F8FAFC';
        ctx.font = 'bold 24px monospace';
        ctx.fillText(val, bx + 16, by + 56);
      });

      const summary =
        signal?.reasoningSummary ??
        (isEn
          ? 'Click "RUN AI Debate" to convene all 19 robot agents and generate a Risk-Engine-verified setup.'
          : 'Nhấn "Họp Phản Biện AI" để các nhân viên robot tranh luận và xuất tín hiệu chính xác.');
      ctx.fillStyle = '#CBD5E1';
      ctx.font = '20px sans-serif';
      const lines = wrapLines(ctx, summary, W - 72, 2);
      lines.forEach((ln, i) => ctx.fillText(ln, 36, 376 + i * 24));

      verdictCanvas.tex.needsUpdate = true;
    }

    // --- Right Screen: Active Robot Debate Feed ---
    {
      const ctx = debateCanvas.ctx;
      const W = 768;
      const H = 384;
      ctx.fillStyle = '#070E1A';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 4;
      ctx.strokeRect(8, 8, W - 16, H - 16);

      ctx.fillStyle = '#A78BFA';
      ctx.font = 'bold 22px monospace';
      ctx.fillText('LIVE ROBOT DEBATE FLOOR', 32, 48);

      if (activeTurn) {
        const phaseColor =
          activeTurn.phase === 'VETO'
            ? '#F43F5E'
            : activeTurn.phase === 'CHALLENGE'
              ? '#F59E0B'
              : activeTurn.phase === 'VERDICT'
                ? '#10B981'
                : '#22D3EE';

        ctx.fillStyle = phaseColor;
        ctx.font = 'bold 22px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`STEP ${activeTurn.step}/7 · ${activeTurn.phase}`, W - 32, 48);
        ctx.textAlign = 'left';

        ctx.fillStyle = '#F8FAFC';
        ctx.font = 'bold 30px sans-serif';
        ctx.fillText(activeTurn.speakerName, 32, 102);

        ctx.fillStyle = '#94A3B8';
        ctx.font = '22px sans-serif';
        ctx.fillText(
          `${isEn ? '→ Debating:' : '→ Phản biện:'} ${activeTurn.targetName}`,
          32,
          138,
        );

        ctx.fillStyle = '#E2E8F0';
        ctx.font = '24px sans-serif';
        const lines = wrapLines(ctx, activeTurn.argument, W - 64, 5);
        lines.forEach((ln, i) => ctx.fillText(ln, 32, 192 + i * 32));

        ctx.fillStyle = '#38BDF8';
        ctx.font = 'bold 20px monospace';
        ctx.fillText(activeTurn.evidenceMetric, 32, 356);
      } else {
        ctx.fillStyle = '#94A3B8';
        ctx.font = '24px sans-serif';
        ctx.fillText(
          isEn ? 'All 19 AI agents on standby.' : 'Các nhân viên Robot đang trực chiến.',
          32,
          120,
        );
        ctx.fillText(
          isEn
            ? 'Click "RUN AI Debate" to start the council session.'
            : 'Nhấn "Họp Phản Biện AI" để bắt đầu phiên tranh luận.',
          32,
          160,
        );
      }

      debateCanvas.tex.needsUpdate = true;
    }
  };

  return {
    screens: {
      marketTex: marketCanvas.tex,
      marketCtx: marketCanvas.ctx,
      verdictTex: verdictCanvas.tex,
      verdictCtx: verdictCanvas.ctx,
      debateTex: debateCanvas.tex,
      debateCtx: debateCanvas.ctx,
      drawScreens,
      dispose: () => {
        marketCanvas.tex.dispose();
        verdictCanvas.tex.dispose();
        debateCanvas.tex.dispose();
        plaqueCanvas.tex.dispose();
      },
    },
    masterCrystal,
    gimbalOuter,
    gimbalInner,
    shieldRing,
    shieldMat,
    crystalMat,
    holoBars,
    companyBoardProxy,
  };
}
