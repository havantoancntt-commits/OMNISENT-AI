import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cpu,
  Eye,
  Layers,
  Maximize2,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { formatAssetPrice } from '../engine/symbolSearch';
import type {
  AgentState,
  DebateTurn,
  MarketTicker,
  OrderBookSnapshot,
  PortfolioSummary,
  TradingMode,
  TradingSignal,
} from '../engine/types';
import { CompanyDossierModal } from './CompanyProfileBoard';
import { buildTradingRoomEnvironment, type RoomScreens } from './trading3d/roomBuilder';
import {
  buildRobotTradingStaff,
  computeRobotFocusPose,
  getAgentRoleColor,
  type RobotRig,
} from './trading3d/robotFactory';
import { buildRobotLiveWorkView } from './trading3d/workstationScreen';
import { useI18n } from '../i18n/I18nContext';
import type { Locale, TranslationKey } from '../i18n/translations';

export type CameraPreset = 'ROOM_WIDE' | 'DEBATE_TABLE' | 'ORDERBOOK' | 'RISK_ENFORCER' | 'ZENITH';

interface Workspace3DProps {
  agents: AgentState[];
  selectedTicker: MarketTicker | null;
  orderBook: OrderBookSnapshot | null;
  portfolio: PortfolioSummary;
  tradingMode: TradingMode;
  latestSignal?: TradingSignal | null;
  openPositionsCount?: number;
  compact?: boolean;
  debateRunning?: boolean;
  onSelectAgent?: (agent: AgentState) => void;
  onExpandFull?: () => void;
  onRunDebate?: () => void;
}

const CAMERA_TARGETS: Record<
  CameraPreset,
  { pos: [number, number, number]; target: [number, number, number]; labelKey: TranslationKey }
> = {
  ROOM_WIDE: { pos: [0, 5.8, 12.2], target: [0, 1.35, -0.6], labelKey: 'room.cam.ROOM_WIDE' },
  DEBATE_TABLE: { pos: [0, 3.6, 7.6], target: [0, 1.1, 0], labelKey: 'room.cam.DEBATE_TABLE' },
  ORDERBOOK: { pos: [10.6, 4.4, 8.2], target: [0, 0.8, 0], labelKey: 'room.cam.ORDERBOOK' },
  RISK_ENFORCER: { pos: [-5.8, 3.1, 6.8], target: [1.6, 0.9, 1.8], labelKey: 'room.cam.RISK_ENFORCER' },
  ZENITH: { pos: [0, 15.2, 4.0], target: [0, 0, -0.5], labelKey: 'room.cam.ZENITH' },
};

// Pre-allocated scratch math objects (zero GC inside animation loop)
const _vec3 = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function getPhaseColorHex(phase?: DebateTurn['phase']): number {
  switch (phase) {
    case 'PROPOSE':
      return 0x22d3ee;
    case 'CHALLENGE':
      return 0xf59e0b;
    case 'REBUTTAL':
      return 0x818cf8;
    case 'VETO':
      return 0xf43f5e;
    case 'VERDICT':
      return 0x10b981;
    default:
      return 0x38bdf8;
  }
}

function normalizeAngleDelta(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return THREE.MathUtils.clamp(a, -1.05, 1.05);
}

export const Workspace3D: React.FC<Workspace3DProps> = ({
  agents,
  selectedTicker,
  orderBook,
  portfolio,
  tradingMode,
  latestSignal = null,
  openPositionsCount,
  compact = false,
  debateRunning = false,
  onSelectAgent,
  onExpandFull,
  onRunDebate,
}) => {
  const { locale, t } = useI18n();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [preset, setPreset] = useState<CameraPreset>('ROOM_WIDE');
  const [dockOpen, setDockOpen] = useState(() =>
    !compact && (typeof window === 'undefined' ? true : window.innerWidth >= 640),
  );
  const [showOrderBook3D, setShowOrderBook3D] = useState(true);
  const [showDebateBeams, setShowDebateBeams] = useState(true);
  const [debatePlaying, setDebatePlaying] = useState(true);
  const [activeTurnIdx, setActiveTurnIdx] = useState(0);
  const [inspectedAgentId, setInspectedAgentId] = useState<string | null>(
    agents[0]?.id ?? null,
  );
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  const debateRounds: DebateTurn[] = latestSignal?.debateRounds ?? [];

  // Reset debate playback step when active signal switches or clears
  const lastSignalIdRef = useRef<string | null>(null);
  useEffect(() => {
    const nextId = latestSignal?.id ?? null;
    if (nextId !== lastSignalIdRef.current) {
      lastSignalIdRef.current = nextId;
      setActiveTurnIdx(0);
      setDebatePlaying(Boolean(nextId));
    }
  }, [latestSignal?.id]);

  // Auto-advance robot debate transcript cleanly at 3.2s intervals
  useEffect(() => {
    if (!debatePlaying || debateRounds.length <= 1) return;
    const id = window.setInterval(() => {
      setActiveTurnIdx((prev) => (prev + 1) % debateRounds.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, [debatePlaying, debateRounds.length]);

  const activeTurn: DebateTurn | null =
    debateRounds.length > 0 ? debateRounds[activeTurnIdx % debateRounds.length] : null;

  // Refs synced from React props so WebGL canvas never tears down on telemetry ticks
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const tickerRef = useRef(selectedTicker);
  tickerRef.current = selectedTicker;
  const orderBookRef = useRef(orderBook);
  orderBookRef.current = orderBook;
  const tradingModeRef = useRef(tradingMode);
  tradingModeRef.current = tradingMode;
  const portfolioRef = useRef(portfolio);
  portfolioRef.current = portfolio;
  const signalRef = useRef(latestSignal);
  signalRef.current = latestSignal;
  const activeTurnRef = useRef(activeTurn);
  activeTurnRef.current = activeTurn;
  const openPositionsCountRef = useRef(
    openPositionsCount ?? (portfolio.usedMarginUsd > 0 ? 1 : 0),
  );
  openPositionsCountRef.current =
    openPositionsCount ?? (portfolio.usedMarginUsd > 0 ? 1 : 0);
  const showObRef = useRef(showOrderBook3D);
  showObRef.current = showOrderBook3D;
  const showBeamsRef = useRef(showDebateBeams);
  showBeamsRef.current = showDebateBeams;
  const onSelectAgentRef = useRef(onSelectAgent);
  onSelectAgentRef.current = onSelectAgent;
  const localeRef = useRef<Locale>(locale);
  localeRef.current = locale;

  const agentStateFingerprint = agents
    .map((a) => `${a.id}:${a.status}:${a.enabled ? 1 : 0}:${a.latencyMs}:${a.currentTask}`)
    .join('|');

  const screensDirtyRef = useRef(true);
  const robotScreensDirtyRef = useRef(true);
  useEffect(() => {
    screensDirtyRef.current = true;
    robotScreensDirtyRef.current = true;
  }, [
    locale,
    selectedTicker?.lastPrice,
    selectedTicker?.symbol,
    selectedTicker?.marketType,
    selectedTicker?.exchange,
    orderBook?.timestampUtc,
    latestSignal?.id,
    debateRounds.length,
    activeTurnIdx,
    activeTurn?.step,
    activeTurn?.speakerId,
    tradingMode,
    portfolio.totalEquityUsd,
    portfolio.unrealizedPnlUsd,
    portfolio.totalClosedTrades,
    openPositionsCount,
    agentStateFingerprint,
  ]);

  const robotRigsRef = useRef<Map<string, RobotRig>>(new Map());

  const presetRef = useRef<{
    active: boolean;
    pos: [number, number, number];
    target: [number, number, number];
  }>({
    active: false,
    pos: CAMERA_TARGETS.ROOM_WIDE.pos,
    target: CAMERA_TARGETS.ROOM_WIDE.target,
  });

  const triggerPreset = (nextPreset: CameraPreset) => {
    setFocusedAgentId(null);
    setPreset(nextPreset);
    const cfg = CAMERA_TARGETS[nextPreset];
    presetRef.current = {
      active: true,
      pos: cfg.pos,
      target: cfg.target,
    };
  };

  const focusRobotById = (agentId: string) => {
    setInspectedAgentId(agentId);
    setFocusedAgentId(agentId);
    const rig = robotRigsRef.current.get(agentId);
    if (rig) {
      const pose = computeRobotFocusPose(rig);
      presetRef.current = {
        active: true,
        pos: pose.pos,
        target: pose.target,
      };
    }
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initW = Math.max(container.clientWidth, 320);
    const initH = Math.max(container.clientHeight, 240);
    renderer.setSize(initW, initH);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a11);
    scene.fog = new THREE.FogExp2(0x060a11, 0.022);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(45, initW / initH, 0.1, 140);
    camera.position.set(...CAMERA_TARGETS.ROOM_WIDE.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.05;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.target.set(...CAMERA_TARGETS.ROOM_WIDE.target);
    controls.addEventListener('start', () => {
      presetRef.current.active = false;
    });

    // Three-point warm/cool institutional lighting rig
    const hemiLight = new THREE.HemisphereLight(0x7dd3fc, 0x0f172a, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1e0, 2.1);
    keyLight.position.set(8, 13, 9);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -11;
      keyLight.shadow.camera.right = 11;
      keyLight.shadow.camera.top = 11;
      keyLight.shadow.camera.bottom = -11;
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x06b6d4, 1.35);
    rimLight.position.set(-9, 6, -8);
    scene.add(rimLight);

    // Build Institutional 3D Trading Room + Panoramic Wall Holo-Screens
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const room = buildTradingRoomEnvironment(scene, maxAniso);
    const screens: RoomScreens = room.screens;

    // Build Composite Articulated 3D Robot Trading Staff + Individual Live Workstation Monitors
    let robotRigs = new Map<string, RobotRig>();
    let interactables: THREE.Object3D[] = [room.companyBoardProxy];
    let updateRobotScreensFn: ((agents: AgentState[], ctxData: Parameters<ReturnType<typeof buildRobotTradingStaff>['updateScreens']>[1]) => void) | null = null;
    let disposeRobotsFn: (() => void) | null = null;
    const ensureRobotsBuilt = () => {
      if (robotRigs.size === 0 && agentsRef.current.length > 0) {
        const built = buildRobotTradingStaff(scene, agentsRef.current, maxAniso);
        robotRigs = built.rigs;
        robotRigsRef.current = built.rigs;
        interactables = [room.companyBoardProxy, ...built.interactables];
        updateRobotScreensFn = built.updateScreens;
        disposeRobotsFn = built.dispose;
        robotScreensDirtyRef.current = true;
      }
    };
    ensureRobotsBuilt();

    // --- 3D Order Book Depth Towers flanking the trading floor ---
    const obCount = 20;
    const obGeo = new THREE.BoxGeometry(0.28, 1, 0.28);
    const obMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.45,
      roughness: 0.35,
    });
    const obInstanced = new THREE.InstancedMesh(obGeo, obMat, obCount);
    obInstanced.frustumCulled = false;
    scene.add(obInstanced);

    // --- 3D Debate Beam Arc + Traveling Logic Pulses between debating robots ---
    const arcSegments = 24;
    const arcPoints: THREE.Vector3[] = Array.from(
      { length: arcSegments + 1 },
      () => new THREE.Vector3(),
    );
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcMat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.85,
    });
    const debateArcLine = new THREE.Line(arcGeo, arcMat);
    debateArcLine.frustumCulled = false;
    scene.add(debateArcLine);

    const pulseCount = 10;
    const pulseGeo = new THREE.SphereGeometry(0.085, 8, 8);
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const pulseInstanced = new THREE.InstancedMesh(pulseGeo, pulseMat, pulseCount);
    pulseInstanced.frustumCulled = false;
    scene.add(pulseInstanced);

    // Raycasting setup (Layer 1 simplified proxies)
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const handlePointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactables, false);
      if (hits.length > 0) {
        if (hits[0].object.userData.companyBoard) {
          setCompanyModalOpen(true);
          return;
        }
        const hitId = hits[0].object.userData.agentId as string | undefined;
        if (hitId) {
          focusRobotById(hitId);
          const found = agentsRef.current.find((a) => a.id === hitId);
          if (found && onSelectAgentRef.current) {
            onSelectAgentRef.current(found);
          }
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = Math.max(container.clientWidth, 280);
      const h = Math.max(container.clientHeight, 220);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let frameId = 0;
    let disposed = false;
    const startMs = performance.now();
    let lastMs = startMs;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 6);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 85);
        }
      };
      frameId = window.setTimeout(poll, 6);
    }

    const tick = () => {
      if (disposed) return;
      const nowMs = performance.now();
      const dt = Math.min((nowMs - lastMs) / 1000, 0.1);
      lastMs = nowMs;
      const elapsed = (nowMs - startMs) / 1000;

      ensureRobotsBuilt();

      // Redraw wall screens only when state/debate turn/locale changes
      if (screensDirtyRef.current) {
        screensDirtyRef.current = false;
        screens.drawScreens({
          ticker: tickerRef.current,
          orderBook: orderBookRef.current,
          signal: signalRef.current,
          activeTurn: activeTurnRef.current,
          tradingMode: tradingModeRef.current,
          locale: localeRef.current,
        });
      }

      // Redraw individual robot workstation screens selectively (only changed signatures)
      if (robotScreensDirtyRef.current && updateRobotScreensFn) {
        robotScreensDirtyRef.current = false;
        updateRobotScreensFn(agentsRef.current, {
          ticker: tickerRef.current,
          orderBook: orderBookRef.current,
          portfolio: portfolioRef.current,
          signal: signalRef.current,
          activeTurn: activeTurnRef.current,
          tradingMode: tradingModeRef.current,
          openPositionsCount: openPositionsCountRef.current,
          locale: localeRef.current,
        });
      }

      // Smooth damped camera preset transitions
      if (presetRef.current.active) {
        _targetPos.set(...presetRef.current.pos);
        _targetLook.set(...presetRef.current.target);
        const lambda = 7.5;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetPos.x, lambda, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetPos.y, lambda, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetPos.z, lambda, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetLook.x, lambda, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetLook.y, lambda, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetLook.z, lambda, dt);
        if (camera.position.distanceTo(_targetPos) < 0.05) {
          presetRef.current.active = false;
        }
      }
      controls.update();

      // Rotate Master AI Hologram above Conference Table
      const isEmergency = tradingModeRef.current === 'EMERGENCY_STOP';
      const spinMult = isEmergency ? 0.15 : 1.0;
      room.masterCrystal.rotation.y += dt * 0.65 * spinMult;
      room.masterCrystal.rotation.x = Math.sin(elapsed * 0.6) * 0.12;
      room.gimbalOuter.rotation.y += dt * 0.35 * spinMult;
      room.gimbalOuter.rotation.x += dt * 0.18 * spinMult;
      room.gimbalInner.rotation.z -= dt * 0.45 * spinMult;

      // Update Risk Shield Color
      const dd = portfolioRef.current.currentDrawdownPct;
      if (isEmergency) {
        room.shieldMat.color.setHex(0xef4444);
        room.shieldMat.emissive.setHex(0x7f1d1d);
        room.crystalMat.color.setHex(0xef4444);
      } else if (dd > 4) {
        room.shieldMat.color.setHex(0xf59e0b);
        room.shieldMat.emissive.setHex(0x78350f);
        room.crystalMat.color.setHex(0xf59e0b);
      } else {
        room.shieldMat.color.setHex(0x10b981);
        room.shieldMat.emissive.setHex(0x064e3b);
        room.crystalMat.color.setHex(0x22d3ee);
      }

      // Tabletop Holographic Order-Depth Bars (14 bars driven by live L2 Order Book levels)
      const book = orderBookRef.current;
      const bids = book?.bids ?? [];
      const asks = book?.asks ?? [];
      const maxHoloUsd = Math.max(
        1,
        ...bids.slice(0, 7).map((b) => b.totalUsd),
        ...asks.slice(0, 7).map((a) => a.totalUsd),
      );
      const chg = tickerRef.current?.change24hPct ?? 0;
      for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        const r = 1.62;
        const isBidSlot = i < 7;
        const lvl = isBidSlot ? bids[i] : asks[i - 7];
        const barH = lvl
          ? Math.max(0.14, (lvl.totalUsd / maxHoloUsd) * 0.72)
          : 0.08;
        _dummy.position.set(Math.cos(angle) * r, 0.85 + barH / 2, Math.sin(angle) * r);
        _dummy.scale.set(1, barH, 1);
        _dummy.updateMatrix();
        room.holoBars.setMatrixAt(i, _dummy.matrix);
        const bullishBar = lvl ? isBidSlot : chg >= 0;
        _color.setHex(bullishBar ? 0x10b981 : 0xf43f5e);
        room.holoBars.setColorAt(i, _color);
      }
      room.holoBars.instanceMatrix.needsUpdate = true;
      if (room.holoBars.instanceColor) room.holoBars.instanceColor.needsUpdate = true;

      // Animate Articulated Robot Trading Staff & Debate Choreography
      const turn = activeTurnRef.current;
      const speakerRig = turn ? robotRigs.get(turn.speakerId) : undefined;
      const targetRig = turn ? robotRigs.get(turn.targetId) : undefined;

      for (const ag of agentsRef.current) {
        const rig = robotRigs.get(ag.id);
        if (!rig) continue;

        const isSpeaker = Boolean(turn && ag.id === turn.speakerId);
        const isTarget = Boolean(turn && ag.id === turn.targetId);
        const roleHex = getAgentRoleColor(ag.category, ag.status);

        // Turn head smoothly toward partner during debate, else face table center
        let desiredHeadYaw = 0;
        if (isSpeaker && targetRig) {
          const toTargetYaw = Math.atan2(
            targetRig.seatPos.x - rig.seatPos.x,
            targetRig.seatPos.z - rig.seatPos.z,
          );
          desiredHeadYaw = normalizeAngleDelta(toTargetYaw - rig.baseYaw);
        } else if (isTarget && speakerRig) {
          const toSpeakerYaw = Math.atan2(
            speakerRig.seatPos.x - rig.seatPos.x,
            speakerRig.seatPos.z - rig.seatPos.z,
          );
          desiredHeadYaw = normalizeAngleDelta(toSpeakerYaw - rig.baseYaw);
        } else if (ag.enabled && ag.status === 'ONLINE') {
          desiredHeadYaw = Math.sin(elapsed * 0.7 + rig.baseYaw) * 0.14;
        }
        rig.headPivot.rotation.y = THREE.MathUtils.damp(
          rig.headPivot.rotation.y,
          desiredHeadYaw,
          6.0,
          dt,
        );

        // Speaker raises gesturing arm & leans slightly forward; others rest calmly
        const desiredArmX = isSpeaker
          ? -1.15 + Math.sin(elapsed * 5.2) * 0.16
          : isTarget
            ? -0.45
            : 0;
        rig.armPivot.rotation.x = THREE.MathUtils.damp(
          rig.armPivot.rotation.x,
          desiredArmX,
          6.5,
          dt,
        );

        const liftY = isSpeaker ? 0.08 + Math.sin(elapsed * 3.0) * 0.025 : 0;
        rig.group.position.y = THREE.MathUtils.damp(
          rig.group.position.y,
          rig.seatPos.y + liftY,
          6.0,
          dt,
        );

        // Highlight active speaker & target visors/torsos
        const phaseHex = getPhaseColorHex(turn?.phase);
        if (isSpeaker) {
          rig.torsoMat.color.setHex(phaseHex);
          rig.torsoMat.emissive.setHex(phaseHex);
          rig.torsoMat.emissiveIntensity = 0.85;
          rig.visorMat.color.setHex(0xffffff);
          rig.deskScreenMat.color.setHex(phaseHex);
          rig.haloMat.color.setHex(phaseHex);
          rig.haloMat.opacity = 1.0;
        } else if (isTarget) {
          rig.torsoMat.color.setHex(roleHex);
          rig.torsoMat.emissive.setHex(phaseHex);
          rig.torsoMat.emissiveIntensity = 0.55;
          rig.visorMat.color.setHex(phaseHex);
          rig.deskScreenMat.color.setHex(phaseHex);
          rig.haloMat.color.setHex(phaseHex);
          rig.haloMat.opacity = 0.85;
        } else {
          rig.torsoMat.color.setHex(roleHex);
          rig.torsoMat.emissive.setHex(roleHex);
          rig.torsoMat.emissiveIntensity = ag.enabled ? 0.25 : 0.08;
          rig.visorMat.color.setHex(roleHex);
          rig.deskScreenMat.color.setHex(roleHex);
          rig.haloMat.color.setHex(roleHex);
          rig.haloMat.opacity = 0.55;
        }
      }

      // 3D Debate Beam Arc + Animated Pulses across the War-Room Table
      const showDebateBeam = Boolean(showBeamsRef.current && !isEmergency && speakerRig && targetRig);
      debateArcLine.visible = showDebateBeam;
      pulseInstanced.visible = showDebateBeam;

      if (showDebateBeam && speakerRig && targetRig) {
        const beamHex = getPhaseColorHex(turn?.phase);
        arcMat.color.setHex(beamHex);
        pulseMat.color.setHex(beamHex);

        _p0.set(speakerRig.seatPos.x, speakerRig.seatPos.y + 1.15, speakerRig.seatPos.z);
        _p2.set(targetRig.seatPos.x, targetRig.seatPos.y + 1.15, targetRig.seatPos.z);
        _p1.set(
          (_p0.x + _p2.x) * 0.5,
          Math.max(_p0.y, _p2.y) + 1.35,
          (_p0.z + _p2.z) * 0.5,
        );

        const posAttr = arcGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i <= arcSegments; i++) {
          const t = i / arcSegments;
          const inv = 1 - t;
          const x = inv * inv * _p0.x + 2 * inv * t * _p1.x + t * t * _p2.x;
          const y = inv * inv * _p0.y + 2 * inv * t * _p1.y + t * t * _p2.y;
          const z = inv * inv * _p0.z + 2 * inv * t * _p1.z + t * t * _p2.z;
          posAttr.setXYZ(i, x, y, z);
        }
        posAttr.needsUpdate = true;

        for (let i = 0; i < pulseCount; i++) {
          const t = (elapsed * 0.85 + i / pulseCount) % 1;
          const inv = 1 - t;
          _vec3.set(
            inv * inv * _p0.x + 2 * inv * t * _p1.x + t * t * _p2.x,
            inv * inv * _p0.y + 2 * inv * t * _p1.y + t * t * _p2.y,
            inv * inv * _p0.z + 2 * inv * t * _p1.z + t * t * _p2.z,
          );
          _dummy.position.copy(_vec3);
          _dummy.scale.setScalar(0.85 + Math.sin(t * Math.PI) * 0.45);
          _dummy.updateMatrix();
          pulseInstanced.setMatrixAt(i, _dummy.matrix);
        }
        pulseInstanced.instanceMatrix.needsUpdate = true;
      }

      // Update 3D Order Book Depth Towers flanking the room wings
      obInstanced.visible = showObRef.current;
      if (showObRef.current) {
        const book = orderBookRef.current;
        const bids = book?.bids ?? [];
        const asks = book?.asks ?? [];
        const maxUsd = Math.max(
          1,
          ...bids.map((b) => b.totalUsd),
          ...asks.map((a) => a.totalUsd),
        );

        for (let i = 0; i < 10; i++) {
          const bUsd = bids[i]?.totalUsd;
          const bH = bUsd && bUsd > 0 ? Math.max(0.18, (bUsd / maxUsd) * 2.5) : 0.04;
          _dummy.position.set(-5.8 - i * 0.42, bH / 2, 1.4 + (i % 2) * 0.42);
          _dummy.scale.set(1, bH, 1);
          _dummy.updateMatrix();
          obInstanced.setMatrixAt(i, _dummy.matrix);
          _color.setHex(0x10b981);
          obInstanced.setColorAt(i, _color);

          const aUsd = asks[i]?.totalUsd;
          const aH = aUsd && aUsd > 0 ? Math.max(0.18, (aUsd / maxUsd) * 2.5) : 0.04;
          _dummy.position.set(5.8 + i * 0.42, aH / 2, 1.4 + (i % 2) * 0.42);
          _dummy.scale.set(1, aH, 1);
          _dummy.updateMatrix();
          obInstanced.setMatrixAt(10 + i, _dummy.matrix);
          _color.setHex(0xef4444);
          obInstanced.setColorAt(10 + i, _color);
        }
        obInstanced.instanceMatrix.needsUpdate = true;
        if (obInstanced.instanceColor) obInstanced.instanceColor.needsUpdate = true;
      }

      renderer.render(scene, camera);
      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      screens.dispose();
      disposeRobotsFn?.();
      robotRigsRef.current = new Map();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  const inspectedAgent =
    agents.find((a) => a.id === inspectedAgentId) ?? agents[0] ?? null;
  const inspectedIdx = inspectedAgent
    ? agents.findIndex((a) => a.id === inspectedAgent.id)
    : -1;
  const inspectedWorkView = inspectedAgent
    ? buildRobotLiveWorkView(inspectedAgent, {
        ticker: selectedTicker,
        orderBook,
        portfolio,
        signal: latestSignal,
        activeTurn,
        tradingMode,
        openPositionsCount: openPositionsCount ?? (portfolio.usedMarginUsd > 0 ? 1 : 0),
        locale,
      })
    : null;

  const stepInspectedRobot = (delta: number) => {
    if (agents.length === 0) return;
    const baseIdx = inspectedIdx >= 0 ? inspectedIdx : 0;
    const nextIdx = (baseIdx + delta + agents.length) % agents.length;
    const nextAgent = agents[nextIdx];
    if (nextAgent) {
      focusRobotById(nextAgent.id);
      onSelectAgent?.(nextAgent);
    }
  };

  const phaseBadgeClass = (phase?: DebateTurn['phase']) => {
    switch (phase) {
      case 'PROPOSE':
        return 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300';
      case 'CHALLENGE':
        return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
      case 'REBUTTAL':
        return 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300';
      case 'VETO':
        return 'border-rose-500/40 bg-rose-500/15 text-rose-300';
      case 'VERDICT':
        return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300';
      default:
        return 'border-slate-700 bg-slate-800 text-slate-300';
    }
  };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-slate-800/90 bg-[#060A11] ${
        compact ? 'h-[340px] sm:h-[410px]' : 'h-[calc(100vh-140px)] min-h-[520px]'
      }`}
      data-testid="workspace-3d-container"
    >
      {/* Isolated WebGL Canvas Mount */}
      {webglUnavailable ? (
        <div className="flex h-full flex-col items-center justify-center p-6 text-center">
          <Cpu className="mb-3 h-10 w-10 text-cyan-400" />
          <p className="font-display text-base font-semibold text-slate-100">
            {t('room.fallback.title')}
          </p>
          <p className="mt-1 max-w-md text-xs text-slate-400">
            {t('room.fallback.desc')}
          </p>
        </div>
      ) : (
        <div ref={mountRef} className="h-full w-full touch-none" />
      )}

      {/* Top-Left Context Strip & Focused Return Control (Zero Mobile Overlap) */}
      <div
        className={`absolute top-3 left-3 z-10 flex items-center gap-2 ${
          (compact && onExpandFull) || (!compact && onRunDebate)
            ? 'max-w-[calc(100%-185px)]'
            : 'max-w-[calc(100%-24px)]'
        }`}
      >
        {focusedAgentId && (
          <button
            type="button"
            onClick={() => triggerPreset('ROOM_WIDE')}
            aria-label={t('room.btn.exitRobotAria')}
            className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/50 bg-[#0B111D]/95 px-2.5 py-1.5 text-xs font-medium text-cyan-300 shadow-lg hover:bg-cyan-500/15"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="whitespace-nowrap">{t('room.btn.wholeRoom')}</span>
          </button>
        )}
        <div
          className={`pointer-events-none items-center gap-2 rounded-lg border border-slate-800 bg-[#0B111D]/92 px-3 py-1.5 text-xs ${
            focusedAgentId ? 'hidden sm:flex' : 'flex'
          }`}
        >
          <span className="truncate font-display font-semibold text-slate-100">
            {t('room.badge.title')}
          </span>
          <span className="hidden text-slate-600 sm:inline" aria-hidden="true">·</span>
          <span className="hidden truncate font-mono tabular-nums text-cyan-400 sm:inline">
            {selectedTicker
              ? `${selectedTicker.symbol} (${selectedTicker.exchange}) ${formatAssetPrice(selectedTicker.lastPrice)}`
              : t('room.badge.floorIdle')}
          </span>
          {latestSignal && (
            <>
              <span className="hidden text-slate-600 md:inline" aria-hidden="true">·</span>
              <span
                className={`hidden font-mono font-semibold md:inline ${
                  latestSignal.state === 'APPROVED'
                    ? latestSignal.direction === 'LONG'
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                    : 'text-amber-400'
                }`}
              >
                {latestSignal.direction} ({latestSignal.confidenceScore}/100)
              </span>
            </>
          )}
        </div>
      </div>

      {/* Top-Right Single Primary Action */}
      {compact && onExpandFull ? (
        <button
          type="button"
          onClick={onExpandFull}
          aria-label={t('room.btn.expandAria')}
          className="absolute top-3 right-3 z-10 flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B111D]/92 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-500/60 hover:text-cyan-300"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          <span className="whitespace-nowrap">{t('room.btn.expand')}</span>
        </button>
      ) : (
        onRunDebate && (
          <button
            type="button"
            disabled={debateRunning || !selectedTicker}
            onClick={onRunDebate}
            aria-label={t('room.btn.runDebateAria')}
            className="absolute top-3 right-3 z-10 flex min-h-[40px] items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 shadow-lg transition-opacity hover:opacity-95 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="whitespace-nowrap">
              {debateRunning ? t('room.btn.running') : t('room.btn.runDebate')}
            </span>
          </button>
        )
      )}

      {/* Collapsible Bottom Control & Robot Debate Dock (Zero Viewport Occlusion) */}
      <div className="absolute bottom-3 left-1/2 z-10 w-[min(940px,calc(100%-24px))] -translate-x-1/2">
        <div className="mb-1.5 flex justify-center">
          <button
            type="button"
            onClick={() => setDockOpen((v) => !v)}
            className="flex min-h-[36px] items-center gap-1.5 rounded-t-lg border border-b-0 border-slate-700 bg-[#0B111D]/95 px-3 py-1 text-[11px] font-medium text-slate-300 hover:text-cyan-300"
          >
            {dockOpen ? (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>{t('room.dock.hide')}</span>
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span>{t('room.dock.show')}</span>
              </>
            )}
          </button>
        </div>

        {dockOpen && (
          <div className="max-h-[230px] space-y-2 overflow-y-auto rounded-xl border border-slate-800 bg-[#0B111D]/95 p-2.5 shadow-2xl sm:max-h-none sm:space-y-2.5 sm:p-3">
            {/* Row 1: Camera Presets & 3D Layers (single horizontal scroll strip on mobile) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 md:flex-wrap md:justify-between md:overflow-visible md:pb-0">
              <div className="flex shrink-0 items-center gap-1.5">
                {(Object.keys(CAMERA_TARGETS) as CameraPreset[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => triggerPreset(key)}
                    className={`min-h-[34px] shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                      preset === key
                        ? 'border border-cyan-500/40 bg-cyan-500/20 text-cyan-300'
                        : 'border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t(CAMERA_TARGETS[key].labelKey)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => triggerPreset('ROOM_WIDE')}
                  aria-label={t('room.btn.resetViewAria')}
                  className="flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowOrderBook3D((v) => !v)}
                  className={`flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                    showOrderBook3D
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>{t('room.btn.ob3d')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowDebateBeams((v) => !v)}
                  className={`flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                    showDebateBeams
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                      : 'border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{t('room.btn.beams')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCompanyModalOpen(true)}
                  aria-label={t('room.btn.companyAria')}
                  className="flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-200 whitespace-nowrap transition-colors hover:bg-amber-400/25"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  <span>Prof.TOAN</span>
                </button>
              </div>
            </div>

            {/* Row 2: Live Adversarial Robot Debate Transcript & Final Precision Signal */}
            <div className="rounded-lg border border-slate-800/90 bg-[#070B12] p-2.5">
              {activeTurn ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${phaseBadgeClass(
                          activeTurn.phase,
                        )}`}
                      >
                        {t('room.debate.stepLabel', {
                          step: activeTurn.step,
                          total: debateRounds.length,
                          phase: activeTurn.phase,
                        })}
                      </span>
                      <span className="font-semibold text-slate-100">{activeTurn.speakerName}</span>
                      <span className="text-slate-500" aria-hidden="true">→</span>
                      <span className="text-cyan-300">{activeTurn.targetName}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDebatePlaying(false);
                          setActiveTurnIdx(
                            (prev) => (prev - 1 + debateRounds.length) % debateRounds.length,
                          );
                        }}
                        aria-label={t('room.debate.prevAria')}
                        className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-cyan-300"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDebatePlaying((v) => !v)}
                        aria-label={
                          debatePlaying ? t('room.debate.pauseAria') : t('room.debate.playAria')
                        }
                        className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded border border-slate-800 bg-slate-900 text-cyan-300 hover:border-cyan-500/40"
                      >
                        {debatePlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDebatePlaying(false);
                          setActiveTurnIdx((prev) => (prev + 1) % debateRounds.length);
                        }}
                        aria-label={t('room.debate.nextAria')}
                        className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded border border-slate-800 bg-slate-900 text-slate-300 hover:text-cyan-300"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-slate-200">{activeTurn.argument}</p>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[11px]">
                    <span className="font-mono tabular-nums text-cyan-400">
                      {activeTurn.evidenceMetric}
                    </span>
                    {latestSignal && (
                      <span className="font-mono tabular-nums text-slate-300">
                        {t('room.debate.verdictPrefix')}{' '}
                        <strong
                          className={
                            latestSignal.state === 'APPROVED'
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }
                        >
                          {latestSignal.direction}
                        </strong>
                        {' · '}SL {formatAssetPrice(latestSignal.stopLoss)} · TP{' '}
                        {latestSignal.takeProfitLevels[1]
                          ? formatAssetPrice(latestSignal.takeProfitLevels[1])
                          : '--'}{' '}
                        · R:R {latestSignal.riskReward}x
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-400">
                    {t('room.debate.idlePrefix')}{' '}
                    <strong className="text-cyan-300">RUN</strong> {t('room.debate.idleSuffix')}
                  </p>
                  {onRunDebate && (
                    <button
                      type="button"
                      disabled={debateRunning}
                      onClick={onRunDebate}
                      className="min-h-[36px] shrink-0 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 text-xs font-bold text-slate-950 hover:opacity-95 disabled:opacity-50"
                    >
                      {debateRunning ? t('room.btn.running') : t('room.debate.runNow')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Row 3: Inspected 3D Robot Workstation Monitor Telemetry & Focus Switcher */}
            {inspectedAgent && (
              <div className="flex flex-col gap-2 border-t border-slate-800/80 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-[10px] text-slate-500">
                      [{inspectedIdx + 1}/{agents.length}]
                    </span>
                    <span className="font-semibold text-slate-100">{inspectedAgent.name}</span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="font-mono text-cyan-400">
                      {inspectedWorkView?.statusTag ?? inspectedAgent.status}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {inspectedAgent.latencyMs} ms
                    </span>
                    {inspectedWorkView && (
                      <>
                        <span className="text-slate-600 hidden sm:inline" aria-hidden="true">·</span>
                        <span className="hidden font-mono text-[11px] text-emerald-300 sm:inline">
                          {inspectedWorkView.metricLabel}: {inspectedWorkView.metricValue}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-300">
                    {inspectedWorkView ? `${inspectedWorkView.headline} — ${inspectedWorkView.body}` : inspectedAgent.currentTask}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {portfolio.currentDrawdownPct > 4 && (
                    <div className="mr-1 flex items-center gap-1 text-xs text-amber-400">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-mono tabular-nums">
                        DD {portfolio.currentDrawdownPct}%
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => stepInspectedRobot(-1)}
                    aria-label={t('room.robot.prevAria')}
                    className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-cyan-300"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      focusedAgentId === inspectedAgent.id
                        ? triggerPreset('ROOM_WIDE')
                        : focusRobotById(inspectedAgent.id)
                    }
                    aria-label={t('room.robot.inspectAria')}
                    className={`flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      focusedAgentId === inspectedAgent.id
                        ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-200'
                        : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-500/40 hover:text-cyan-300'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>
                      {focusedAgentId === inspectedAgent.id
                        ? t('room.robot.inspecting')
                        : t('room.robot.inspect')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => stepInspectedRobot(1)}
                    aria-label={t('room.robot.nextAria')}
                    className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-cyan-300"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {companyModalOpen && (
        <CompanyDossierModal
          agents={agents}
          tradingMode={tradingMode}
          onClose={() => setCompanyModalOpen(false)}
        />
      )}
    </div>
  );
};
