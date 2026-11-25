import { DEFAULT_RISK_CONFIG } from '../engine/riskEngine.ts';
import type { AgentState } from '../engine/types.ts';

export interface CompanyProfileInfo {
  companyName: string;
  chairmanTitle: string;
  platformName: string;
  domainClassification: string;
  contactEmail: string;
  executiveThesis: string;
  governanceStatement: string;
  operationalStandard: string;
}

export interface CompanyPillar {
  index: string;
  title: string;
  summary: string;
  mechanism: string;
}

export interface CompanyDivision {
  id: string;
  code: string;
  title: string;
  agentCount: number;
  mandate: string;
  keyUnits: string[];
}

export interface CompanyCharterRule {
  label: string;
  value: string;
  enforced: boolean;
  detail: string;
}

export const COMPANY_PROFILE: CompanyProfileInfo = {
  companyName: 'Giáo Sư - Prof.TOAN',
  chairmanTitle: 'Chủ tịch & Kiến trúc sư Trưởng · Giáo Sư - Prof.TOAN',
  platformName: 'OMNISENT AI Quantitative Trading Lab',
  domainClassification: 'Tổ chức Nghiên cứu Định lượng & Giao dịch Thuật toán Đa tác tử',
  contactEmail: 'prof.toan@gmail.com',
  executiveThesis:
    'Phòng nghiên cứu và vận hành giao dịch tài sản số chuẩn tổ chức, nơi 19 Robot AI chuyên trách tranh luận phản biện đa chiều trước khi trình tín hiệu qua động cơ Risk Engine xác định độc lập.',
  governanceStatement:
    'Mọi quyết định vào lệnh đều tuân thủ quy trình kiểm định dữ liệu vi mô, đối chứng xác suất định lượng và ràng buộc bảo toàn vốn tuyệt đối — loại bỏ hoàn toàn cảm tính và đòn bẩy mất kiểm soát.',
  operationalStandard: 'Tự động thông minh (FULL_AUTO) · Risk Gate Độc Lập · Audit Trail Bất Biến',
};

export const COMPANY_SPECIFICATIONS: Array<{
  label: string;
  value: string;
  note: string;
}> = [
  {
    label: 'Hội đồng Robot AI',
    value: '19',
    note: 'Tác tử phân tách vai trò',
  },
  {
    label: 'Chuỗi Phản Biện',
    value: '7 Bước',
    note: 'Propose → Challenge → Verdict',
  },
  {
    label: 'Rủi ro Tối đa / Lệnh',
    value: `${DEFAULT_RISK_CONFIG.maxRiskPerTradePct}%`,
    note: `Drawdown trần ${DEFAULT_RISK_CONFIG.maxDrawdownPct}%`,
  },
  {
    label: 'Martingale & Rút tiền',
    value: '0%',
    note: 'Khóa cứng ở tầng Engine',
  },
];

export const COMPANY_PILLARS: CompanyPillar[] = [
  {
    index: '01',
    title: 'Hội đồng 19 Robot Phản Biện Đa Chiều',
    summary:
      'Không phụ thuộc vào một mô hình đơn lẻ. Các Robot Phân tích Kỹ thuật, Dòng lệnh Order Book, Vĩ mô và Tâm lý phải đối chất trực tiếp qua 7 vòng phản biện trong Không gian 3D.',
    mechanism: 'Multi-Agent Adversarial Debate Protocol',
  },
  {
    index: '02',
    title: 'Risk Engine Xác Định Độc Lập Hoàn Toàn',
    summary:
      'Động cơ quản trị rủi ro nằm ngoài tầm kiểm soát của AI suy luận. Mọi tín hiệu thiếu Stop Loss, vi phạm tỷ lệ R:R tối thiểu hoặc vượt trần đòn bẩy đều bị phủ quyết tức thì.',
    mechanism: `Min R:R ${DEFAULT_RISK_CONFIG.minRiskReward}x · Max Leverage ${DEFAULT_RISK_CONFIG.maxLeverage}x`,
  },
  {
    index: '03',
    title: 'Bảo Mật API Vault & Minh Bạch Kiểm Toán',
    summary:
      'Cơ chế chống gửi lệnh trùng lặp (Idempotency), chặn tuyệt đối quyền rút tiền trên khóa sàn giao dịch và lưu vết toàn bộ quyết định tại Audit Trail SQLite.',
    mechanism: 'Zero-Withdrawal Vault · Standby First',
  },
];

export const COMPANY_DIVISIONS: CompanyDivision[] = [
  {
    id: 'DIV_ORCHESTRATION_DATA',
    code: '01',
    title: 'Khối Điều Phối & Toàn Vẹn Dữ Liệu',
    agentCount: 3,
    mandate: 'Giám sát luồng dữ liệu sàn, kiểm định độ tươi (freshness) và điều phối đồng thuận toàn phòng.',
    keyUnits: ['Master AI Orchestrator', 'Market Data Agent', 'Data Integrity Agent'],
  },
  {
    id: 'DIV_QUANT_ANALYSIS',
    code: '02',
    title: 'Khối Nghiên Cứu Định Lượng & Vi Mô',
    agentCount: 7,
    mandate: 'Phân tích chế độ thị trường, thanh khoản L2 Order Book, kỹ thuật đa khung, On-Chain và vĩ mô.',
    keyUnits: ['Quant AI Agent', 'Technical Analysis', 'Order Book & Liquidity', 'Market Regime'],
  },
  {
    id: 'DIV_STRATEGY_LAB',
    code: '03',
    title: 'Khối Thiết Kế & Kiểm Chứng Chiến Lược',
    agentCount: 3,
    mandate: 'Xây dựng vùng Entry/SL/TP chuẩn xác, mô phỏng chi phí trượt giá và theo dõi suy giảm hiệu suất.',
    keyUnits: ['Strategy Generation', 'Strategy Validation', 'AI Performance Agent'],
  },
  {
    id: 'DIV_RISK_SECURITY',
    code: '04',
    title: 'Khối Risk Gate, Thực Thi & An Ninh Mạng',
    agentCount: 6,
    mandate: 'Cấp quyền lệnh qua Risk Enforcer, thực thi khớp lệnh chuẩn sàn và bảo vệ khóa API 24/7.',
    keyUnits: ['Risk Management Agent', 'Execution Agent', 'Exit Strategy', 'Cybersecurity Agent'],
  },
];

export const COMPANY_CHARTER_RULES: CompanyCharterRule[] = [
  {
    label: 'Bắt buộc Stop Loss cho mọi vị thế',
    value: DEFAULT_RISK_CONFIG.requireStopLoss ? 'ENFORCED' : 'OPTIONAL',
    enforced: DEFAULT_RISK_CONFIG.requireStopLoss,
    detail: 'Mọi lệnh không có Stop Loss hợp lệ bị từ chối ở tầng Risk Engine.',
  },
  {
    label: 'Cấm chiến thuật gấp thếp (Martingale)',
    value: DEFAULT_RISK_CONFIG.allowMartingale ? 'ALLOWED' : 'BLOCKED',
    enforced: !DEFAULT_RISK_CONFIG.allowMartingale,
    detail: 'Không bao giờ nhồi lệnh bình quân giá lỗ khi vị thế đi ngược xu hướng.',
  },
  {
    label: 'Chặn quyền rút tiền tại API Vault',
    value: 'LOCKED',
    enforced: true,
    detail: 'Tài khoản kết nối chỉ cấp quyền đọc thị trường và đặt lệnh theo hạn mức.',
  },
  {
    label: 'Giới hạn lỗ ngày & Drawdown tổng',
    value: `${DEFAULT_RISK_CONFIG.dailyLossLimitPct}% / ${DEFAULT_RISK_CONFIG.maxDrawdownPct}%`,
    enforced: true,
    detail: 'Tự động kích hoạt khóa bảo vệ khi chạm ngưỡng sụt giảm quy định.',
  },
];

export type CompanyLocale = 'en' | 'vi';

const COMPANY_PROFILE_EN: CompanyProfileInfo = {
  companyName: 'Giáo Sư - Prof.TOAN',
  chairmanTitle: 'Chairman & Chief Architect · Giáo Sư - Prof.TOAN',
  platformName: 'OMNISENT AI Quantitative Trading Lab',
  domainClassification: 'Institutional Quantitative Research & Multi-Agent Algorithmic Trading',
  contactEmail: 'prof.toan@gmail.com',
  executiveThesis:
    'An institutional-grade digital asset research and execution lab where 19 specialized AI agents run structured adversarial debate before any trade intent is audited by a deterministic Risk Engine.',
  governanceStatement:
    'Every execution proposal enforces microstructure validation, quantitative expectancy verification, and strict capital-preservation constraints — eliminating emotional discretion and uncontrolled leverage.',
  operationalStandard: 'Autonomous Precision (FULL_AUTO) · Deterministic Risk Gate · Immutable Audit Trail',
};

const COMPANY_SPECIFICATIONS_EN: Array<{
  label: string;
  value: string;
  note: string;
}> = [
  {
    label: 'AI Agent Committee',
    value: '19',
    note: 'Role-segregated units',
  },
  {
    label: 'Adversarial Protocol',
    value: '7 Steps',
    note: 'Propose → Challenge → Verdict',
  },
  {
    label: 'Max Risk / Trade',
    value: `${DEFAULT_RISK_CONFIG.maxRiskPerTradePct}%`,
    note: `Drawdown cap ${DEFAULT_RISK_CONFIG.maxDrawdownPct}%`,
  },
  {
    label: 'Martingale & Withdrawals',
    value: '0%',
    note: 'Hard-locked at Engine layer',
  },
];

const COMPANY_PILLARS_EN: CompanyPillar[] = [
  {
    index: '01',
    title: '19-Agent Adversarial Debate Committee',
    summary:
      'Never relies on a single opaque model. Technical, L2 Order Book, Quantitative, Macro, and Sentiment agents must challenge one another across a 7-step debate protocol in the 3D War Room.',
    mechanism: 'Multi-Agent Adversarial Debate Protocol',
  },
  {
    index: '02',
    title: 'Fully Deterministic Independent Risk Engine',
    summary:
      'Risk enforcement is isolated from AI inference. Any setup missing a valid Stop Loss, falling below minimum R:R, or breaching leverage limits is vetoed deterministically.',
    mechanism: `Min R:R ${DEFAULT_RISK_CONFIG.minRiskReward}x · Max Leverage ${DEFAULT_RISK_CONFIG.maxLeverage}x`,
  },
  {
    index: '03',
    title: 'Zero-Withdrawal Vault & Immutable Audit',
    summary:
      'Enforces execution idempotency keys against duplicate fills, rejects exchange keys with withdrawal access, and logs every committee verdict in an immutable SQLite Audit Trail.',
    mechanism: 'Zero-Withdrawal Vault · Standby First',
  },
];

const COMPANY_DIVISIONS_EN: CompanyDivision[] = [
  {
    id: 'DIV_ORCHESTRATION_DATA',
    code: '01',
    title: 'Orchestration & Data Integrity',
    agentCount: 3,
    mandate: 'Supervises live exchange feeds, verifies quote freshness, and coordinates multi-agent consensus.',
    keyUnits: ['Master AI Orchestrator', 'Market Data Agent', 'Data Integrity Agent'],
  },
  {
    id: 'DIV_QUANT_ANALYSIS',
    code: '02',
    title: 'Quantitative & Microstructure Research',
    agentCount: 7,
    mandate: 'Evaluates market regime, L2 Order Book liquidity, multi-timeframe technicals, On-Chain, and funding flows.',
    keyUnits: ['Quant AI Agent', 'Technical Analysis', 'Order Book & Liquidity', 'Market Regime'],
  },
  {
    id: 'DIV_STRATEGY_LAB',
    code: '03',
    title: 'Strategy Design & Validation Lab',
    agentCount: 3,
    mandate: 'Constructs calibrated Entry/SL/TP structures, models fee & slippage drag, and audits live performance decay.',
    keyUnits: ['Strategy Generation', 'Strategy Validation', 'AI Performance Agent'],
  },
  {
    id: 'DIV_RISK_SECURITY',
    code: '04',
    title: 'Risk Gate, Execution & Security',
    agentCount: 6,
    mandate: 'Enforces Risk Charter rules, executes precision lot-sized orders, and defends encrypted API Vaults 24/7.',
    keyUnits: ['Risk Management Agent', 'Execution Agent', 'Exit Strategy', 'Cybersecurity Agent'],
  },
];

const COMPANY_CHARTER_RULES_EN: CompanyCharterRule[] = [
  {
    label: 'Mandatory Stop Loss on Every Position',
    value: DEFAULT_RISK_CONFIG.requireStopLoss ? 'ENFORCED' : 'OPTIONAL',
    enforced: DEFAULT_RISK_CONFIG.requireStopLoss,
    detail: 'Any order ticket lacking a structurally valid Stop Loss is rejected by the Risk Engine.',
  },
  {
    label: 'Strict Anti-Martingale Prohibition',
    value: DEFAULT_RISK_CONFIG.allowMartingale ? 'ALLOWED' : 'BLOCKED',
    enforced: !DEFAULT_RISK_CONFIG.allowMartingale,
    detail: 'Loss-averaging and doubling down against adverse price movement are hard-blocked.',
  },
  {
    label: 'Zero-Withdrawal Custody Guard',
    value: 'LOCKED',
    enforced: true,
    detail: 'Connected exchange keys are audited for read and scoped trading scopes only.',
  },
  {
    label: 'Daily Loss & Total Drawdown Circuit Breaker',
    value: `${DEFAULT_RISK_CONFIG.dailyLossLimitPct}% / ${DEFAULT_RISK_CONFIG.maxDrawdownPct}%`,
    enforced: true,
    detail: 'Automatically suspends new execution upon hitting daily or cumulative drawdown thresholds.',
  },
];

export function getCompanyProfile(locale: CompanyLocale = 'vi'): CompanyProfileInfo {
  return locale === 'en' ? COMPANY_PROFILE_EN : COMPANY_PROFILE;
}

export function getCompanySpecifications(locale: CompanyLocale = 'vi') {
  return locale === 'en' ? COMPANY_SPECIFICATIONS_EN : COMPANY_SPECIFICATIONS;
}

export function getCompanyPillars(locale: CompanyLocale = 'vi'): CompanyPillar[] {
  return locale === 'en' ? COMPANY_PILLARS_EN : COMPANY_PILLARS;
}

export function getCompanyDivisions(locale: CompanyLocale = 'vi'): CompanyDivision[] {
  return locale === 'en' ? COMPANY_DIVISIONS_EN : COMPANY_DIVISIONS;
}

export function getCompanyCharterRules(locale: CompanyLocale = 'vi'): CompanyCharterRule[] {
  return locale === 'en' ? COMPANY_CHARTER_RULES_EN : COMPANY_CHARTER_RULES;
}

export function getTotalDivisionAgents(): number {
  return COMPANY_DIVISIONS.reduce((acc, d) => acc + d.agentCount, 0);
}

export function computeLiveDivisionCount(agents: AgentState[]): number {
  if (agents.length === 0) return getTotalDivisionAgents();
  return agents.filter((a) => a.enabled && a.status === 'ONLINE').length;
}

export function getCompanyPlaqueLines(): {
  title: string;
  subtitle: string;
  badgeLine: string;
} {
  return {
    title: 'GIÁO SƯ · PROF.TOAN',
    subtitle: 'INSTITUTIONAL QUANTITATIVE AI & AUTONOMOUS TRADING LAB',
    badgeLine: `OMNISENT AI  ·  19 ROBOT COMMITTEE  ·  RISK-FIRST ARCHITECTURE`,
  };
}

