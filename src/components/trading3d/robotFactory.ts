import * as THREE from 'three';
import type { AgentCategory, AgentState, AgentStatus } from '../../engine/types';
import {
  computeRobotScreenSignature,
  drawRobotWorkstationCanvas,
  type RobotScreenContext,
} from './workstationScreen';

export interface RobotRig {
  agentId: string;
  group: THREE.Group;
  headPivot: THREE.Group;
  armPivot: THREE.Group;
  torsoMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshBasicMaterial;
  deskScreenMat: THREE.MeshBasicMaterial;
  screenMat: THREE.MeshBasicMaterial;
  haloMat: THREE.MeshBasicMaterial;
  seatPos: THREE.Vector3;
  baseYaw: number;
  scale: number;
  isWarTable: boolean;
  screenCanvas: HTMLCanvasElement;
  screenCtx: CanvasRenderingContext2D;
  screenTex: THREE.CanvasTexture;
  lastScreenSig: string;
}

const DEBATE_SEAT_ORDER: string[] = [
  'MASTER_ORCHESTRATOR',
  'TECHNICAL_ANALYSIS',
  'QUANT_AI',
  'ORDER_BOOK_LIQUIDITY',
  'MARKET_REGIME',
  'NEWS_SENTIMENT',
  'RISK_MANAGEMENT',
];

// U-shaped Horseshoe seating around the central war-room table (open front +Z so camera sees faces & table)
const WAR_TABLE_ANGLES = [
  -0.5 * Math.PI, // Master Orchestrator (Back Center, facing camera)
  -0.76 * Math.PI, // Technical (Back Left)
  -0.24 * Math.PI, // Quant AI (Back Right)
  0.96 * Math.PI, // Order Book (Mid Left)
  0.04 * Math.PI, // Market Regime (Mid Right)
  0.76 * Math.PI, // Sentiment (Front Left)
  0.24 * Math.PI, // Risk Management Enforcer (Front Right)
];

export function getAgentRoleColor(category: AgentCategory, status: AgentStatus): number {
  if (status === 'DISABLED' || status === 'OFFLINE') return 0x475569;
  if (status === 'ERROR') return 0xef4444;
  switch (category) {
    case 'ORCHESTRATION':
      return 0x22d3ee;
    case 'DATA':
      return 0x38bdf8;
    case 'ANALYSIS':
      return 0x818cf8;
    case 'STRATEGY':
      return 0xf59e0b;
    case 'RISK':
      return 0x10b981;
    case 'EXECUTION':
      return 0x34d399;
    case 'SECURITY':
      return 0xf43f5e;
    default:
      return 0x06b6d4;
  }
}

export function computeRobotFocusPose(rig: RobotRig): {
  pos: [number, number, number];
  target: [number, number, number];
} {
  const { seatPos, baseYaw, scale } = rig;
  const cos = Math.cos(baseYaw);
  const sin = Math.sin(baseYaw);
  const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
    seatPos.x + scale * (lx * cos + lz * sin),
    seatPos.y + scale * ly,
    seatPos.z + scale * (-lx * sin + lz * cos),
  ];

  // Camera sits cleanly above and to the side of the robot's shoulder, framing the entire 512x256 screen above the bottom dock
  return {
    pos: toWorld(0.88, 1.62, -0.26),
    target: toWorld(0.02, 0.66, 0.62),
  };
}

export function buildRobotTradingStaff(
  scene: THREE.Scene,
  agentList: AgentState[],
  maxAnisotropy = 4,
): {
  rigs: Map<string, RobotRig>;
  interactables: THREE.Object3D[];
  updateScreens: (agents: AgentState[], ctxData: RobotScreenContext) => void;
  dispose: () => void;
} {
  const rigs = new Map<string, RobotRig>();
  const interactables: THREE.Object3D[] = [];

  // Shared geometries across all 19 composite robots & workstations
  const seatPedestalGeo = new THREE.CylinderGeometry(0.28, 0.36, 0.36, 12);
  const pelvisGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.22, 10);
  const torsoGeo = new THREE.BoxGeometry(0.44, 0.48, 0.28);
  const chestCoreGeo = new THREE.OctahedronGeometry(0.11, 0);
  const pauldronGeo = new THREE.BoxGeometry(0.14, 0.16, 0.22);
  const upperArmGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.36, 8);
  const headGeo = new THREE.BoxGeometry(0.28, 0.24, 0.26);
  const crestGeo = new THREE.BoxGeometry(0.08, 0.08, 0.28);
  const visorGeo = new THREE.BoxGeometry(0.24, 0.075, 0.04);

  // 5-part Institutional Workstation Console geometries (used for ALL 19 robots)
  const deskFootGeo = new THREE.CylinderGeometry(0.14, 0.19, 0.04, 12);
  const deskStandGeo = new THREE.CylinderGeometry(0.042, 0.068, 0.54, 10);
  const deskTopGeo = new THREE.BoxGeometry(0.68, 0.036, 0.32);
  const holoPadGeo = new THREE.BoxGeometry(0.46, 0.012, 0.14);
  const monitorNeckGeo = new THREE.BoxGeometry(0.06, 0.22, 0.04);
  const monitorHousingGeo = new THREE.BoxGeometry(0.76, 0.41, 0.024);
  const deskScreenGeo = new THREE.PlaneGeometry(0.72, 0.36);
  const rearLedBarGeo = new THREE.BoxGeometry(0.54, 0.022, 0.012);

  const shadowGeo = new THREE.CircleGeometry(0.46, 20);
  const haloGeo = new THREE.RingGeometry(0.42, 0.48, 24);
  const proxyGeo = new THREE.SphereGeometry(0.86, 8, 8);

  const darkChassisMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.65,
    roughness: 0.55,
  });
  const titaniumTrimMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.9,
    roughness: 0.22,
  });
  const obsidianBezelMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.82,
    roughness: 0.26,
  });
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x020617,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });

  const perRobotMats: THREE.Material[] = [];

  // Order agents: 7 primary War-Table Debate Robots first, then 12 Gallery Desk Robots
  const sorted = [...agentList].sort((a, b) => {
    const ia = DEBATE_SEAT_ORDER.indexOf(a.id);
    const ib = DEBATE_SEAT_ORDER.indexOf(b.id);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.id.localeCompare(b.id);
  });

  const galleryAgents = sorted.filter((a) => !DEBATE_SEAT_ORDER.includes(a.id));

  sorted.forEach((ag) => {
    const warIdx = DEBATE_SEAT_ORDER.indexOf(ag.id);
    const isWarTable = warIdx !== -1;

    let angle = 0;
    let radius = 3.84;
    let floorY = 0.12; // Dais elevation for war table

    if (isWarTable) {
      angle = WAR_TABLE_ANGLES[warIdx];
      // Seated outside table rim (R=2.69) with clean room for individual workstation monitor at local z=0.64
      radius = ag.id === 'MASTER_ORCHESTRATOR' ? 3.94 : 3.84;
      floorY = 0.12;
    } else {
      const gIdx = galleryAgents.findIndex((g) => g.id === ag.id);
      const count = Math.max(1, galleryAgents.length);
      const t = count > 1 ? gIdx / (count - 1) : 0.5;
      // Span rear/side wings (-165 deg to -15 deg) leaving front +Z camera lane open
      angle = -0.92 * Math.PI + t * (0.84 * Math.PI);
      radius = gIdx % 2 === 0 ? 6.22 : 7.32;
      floorY = -0.02;
    }

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const seatPos = new THREE.Vector3(x, floorY, z);

    const roleColor = getAgentRoleColor(ag.category, ag.status);
    const robotGroup = new THREE.Group();
    robotGroup.position.copy(seatPos);
    const lookYaw = Math.atan2(-x, -z);
    robotGroup.rotation.y = lookYaw;

    const scale = ag.id === 'MASTER_ORCHESTRATOR' ? 1.15 : isWarTable ? 1.0 : 0.9;
    robotGroup.scale.setScalar(scale);

    // Contact shadow disc grounded at local y = 0.015
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    robotGroup.add(shadow);

    // Status Halo ring around chair base
    const haloMat = new THREE.MeshBasicMaterial({
      color: roleColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
    });
    perRobotMats.push(haloMat);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.022;
    robotGroup.add(halo);

    // Part 1: Grounded Hover-Chair Pedestal
    const pedestal = new THREE.Mesh(seatPedestalGeo, darkChassisMat);
    pedestal.position.y = 0.18;
    pedestal.castShadow = true;
    robotGroup.add(pedestal);

    // Part 2: Swivel Pelvis Column
    const pelvis = new THREE.Mesh(pelvisGeo, titaniumTrimMat);
    pelvis.position.y = 0.47;
    robotGroup.add(pelvis);

    // Part 3: Armored Torso Chassis
    const torsoMat = new THREE.MeshStandardMaterial({
      color: roleColor,
      emissive: roleColor,
      emissiveIntensity: 0.25,
      metalness: 0.55,
      roughness: 0.3,
    });
    perRobotMats.push(torsoMat);
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 0.82;
    torso.castShadow = true;
    robotGroup.add(torso);

    // Part 4: Chest Core Emitter
    const chestCore = new THREE.Mesh(chestCoreGeo, titaniumTrimMat);
    chestCore.position.set(0, 0.84, 0.16);
    robotGroup.add(chestCore);

    // Part 5: Left & Right Shoulder Pauldrons
    const leftShoulder = new THREE.Mesh(pauldronGeo, darkChassisMat);
    leftShoulder.position.set(-0.29, 0.96, 0);
    robotGroup.add(leftShoulder);

    const rightShoulder = new THREE.Mesh(pauldronGeo, darkChassisMat);
    rightShoulder.position.set(0.29, 0.96, 0);
    robotGroup.add(rightShoulder);

    // Left arm angled toward workstation keypad
    const leftArm = new THREE.Mesh(upperArmGeo, titaniumTrimMat);
    leftArm.position.set(-0.29, 0.72, 0.08);
    leftArm.rotation.x = -0.48;
    robotGroup.add(leftArm);

    // Part 6: Articulated Gesturing Right Arm Pivot (raises when debating!)
    const armPivot = new THREE.Group();
    armPivot.position.set(0.29, 0.92, 0);
    const rightArm = new THREE.Mesh(upperArmGeo, titaniumTrimMat);
    rightArm.position.set(0, -0.17, 0.08);
    rightArm.rotation.x = -0.48;
    armPivot.add(rightArm);
    robotGroup.add(armPivot);

    // Part 7: Articulated Head Pivot with Helmet Crest & Glowing Visor
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.2, 0);

    const head = new THREE.Mesh(headGeo, darkChassisMat);
    head.castShadow = true;
    headPivot.add(head);

    const crest = new THREE.Mesh(crestGeo, titaniumTrimMat);
    crest.position.y = 0.14;
    headPivot.add(crest);

    const visorMat = new THREE.MeshBasicMaterial({ color: roleColor });
    perRobotMats.push(visorMat);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.02, 0.13);
    headPivot.add(visor);
    robotGroup.add(headPivot);

    // Part 8: Individual Institutional Workstation Console & Live Display in front of EVERY Robot
    const deskScreenMat = new THREE.MeshBasicMaterial({
      color: roleColor,
      transparent: true,
      opacity: 0.9,
    });
    perRobotMats.push(deskScreenMat);

    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 512;
    screenCanvas.height = 256;
    const screenCtx = screenCanvas.getContext('2d')!;
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    screenTex.generateMipmaps = false;
    screenTex.minFilter = THREE.LinearFilter;
    screenTex.magFilter = THREE.LinearFilter;
    screenTex.anisotropy = maxAnisotropy;

    const screenMat = new THREE.MeshBasicMaterial({
      map: screenTex,
    });
    perRobotMats.push(screenMat);

    const deskGroup = new THREE.Group();
    deskGroup.position.set(0, 0, 0.64);

    // Grounded desk base footing & column
    const deskFoot = new THREE.Mesh(deskFootGeo, titaniumTrimMat);
    deskFoot.position.y = 0.02;
    deskGroup.add(deskFoot);

    const deskStand = new THREE.Mesh(deskStandGeo, darkChassisMat);
    deskStand.position.y = 0.3;
    deskGroup.add(deskStand);

    // Angled control deck & glowing holo-keypad pad
    const deskTop = new THREE.Mesh(deskTopGeo, titaniumTrimMat);
    deskTop.position.y = 0.58;
    deskTop.rotation.x = -0.16;
    deskGroup.add(deskTop);

    const holoPad = new THREE.Mesh(holoPadGeo, deskScreenMat);
    holoPad.position.set(0, 0.6, -0.05);
    holoPad.rotation.x = -0.16;
    deskGroup.add(holoPad);

    // Dual-joint monitor neck arm placed cleanly BEHIND the monitor housing (+Z side)
    const monitorNeck = new THREE.Mesh(monitorNeckGeo, titaniumTrimMat);
    monitorNeck.position.set(0, 0.71, 0.08);
    deskGroup.add(monitorNeck);

    // Monitor pivot rotated Math.PI around Y so front display faces the robot (-Z), tilted slightly upward (-0.24)
    const monitorYawGroup = new THREE.Group();
    monitorYawGroup.position.set(0, 0.88, 0.04);
    monitorYawGroup.rotation.y = Math.PI;

    const monitorTiltGroup = new THREE.Group();
    monitorTiltGroup.rotation.x = -0.24;

    const monitorHousing = new THREE.Mesh(monitorHousingGeo, obsidianBezelMat);
    monitorTiltGroup.add(monitorHousing);

    const deskScreen = new THREE.Mesh(deskScreenGeo, screenMat);
    deskScreen.position.z = 0.014;
    monitorTiltGroup.add(deskScreen);

    // Sleek glowing status light strip on the rear of the monitor visible from across the room
    const rearLedBar = new THREE.Mesh(rearLedBarGeo, deskScreenMat);
    rearLedBar.position.set(0, 0.16, -0.015);
    monitorTiltGroup.add(rearLedBar);

    monitorYawGroup.add(monitorTiltGroup);
    deskGroup.add(monitorYawGroup);
    robotGroup.add(deskGroup);

    // Simplified Layer 1 Raycast Proxy covering robot + desk
    const proxy = new THREE.Mesh(proxyGeo, proxyMat);
    proxy.position.set(0, 0.84, 0.25);
    proxy.layers.set(1);
    proxy.userData.agentId = ag.id;
    robotGroup.add(proxy);
    interactables.push(proxy);

    scene.add(robotGroup);
    rigs.set(ag.id, {
      agentId: ag.id,
      group: robotGroup,
      headPivot,
      armPivot,
      torsoMat,
      visorMat,
      deskScreenMat,
      screenMat,
      haloMat,
      seatPos,
      baseYaw: lookYaw,
      scale,
      isWarTable,
      screenCanvas,
      screenCtx,
      screenTex,
      lastScreenSig: '',
    });
  });

  const updateScreens = (agents: AgentState[], ctxData: RobotScreenContext) => {
    for (const ag of agents) {
      const rig = rigs.get(ag.id);
      if (!rig) continue;
      const sig = computeRobotScreenSignature(ag, ctxData);
      if (sig === rig.lastScreenSig) continue;
      rig.lastScreenSig = sig;
      drawRobotWorkstationCanvas(rig.screenCtx, rig.screenTex, ag, ctxData);
    }
  };

  const dispose = () => {
    [
      seatPedestalGeo,
      pelvisGeo,
      torsoGeo,
      chestCoreGeo,
      pauldronGeo,
      upperArmGeo,
      headGeo,
      crestGeo,
      visorGeo,
      deskFootGeo,
      deskStandGeo,
      deskTopGeo,
      holoPadGeo,
      monitorNeckGeo,
      monitorHousingGeo,
      deskScreenGeo,
      rearLedBarGeo,
      shadowGeo,
      haloGeo,
      proxyGeo,
    ].forEach((g) => g.dispose());

    [darkChassisMat, titaniumTrimMat, obsidianBezelMat, shadowMat, proxyMat, ...perRobotMats].forEach(
      (m) => m.dispose(),
    );

    rigs.forEach((rig) => {
      rig.screenTex.dispose();
    });
  };

  return { rigs, interactables, updateScreens, dispose };
}
