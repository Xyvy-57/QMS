/**
 * Worlder 气泡系统：2026-11-17 本地证据契约。
 * A = 实际采集 JSON；B = 页面可见；C = 前端源码推断。
 * 未捕获 HTTP 状态/响应头；code: 0 是业务 JSON 值，不表示实测 HTTP 200。
 * 不包含请求执行器，不发送网络请求。接口未知字段不以 any/伪造结构补全。
 */

/** A：01/02/03/04/05/08/10/13 的成功响应外层。 */
export interface ObservedSuccess<T> {
  code: 0;
  data: T;
  message: string; // 所列样本均为 "ok"。
}

/** A：模板列表与 workspace 搜索均实际出现四个分页字段。 */
export interface ObservedPage<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** A：ID 样本为 UUID 字符串；C：graph 校验允许非 UUID 字符串。 */
export type EntityId = string;
export type IsoTimestamp = string;

/** A：responses/02_process_template_detail.json:data.graph.nodes[].position。 */
export interface ProcessPosition {
  x: number;
  y: number;
}

/**
 * A：01–04、13 的 graph 节点。这里没有 role/sampleCount/itemIds。
 * C：code 会被拓扑层级重编号；业务关联请使用 id。
 */
export interface ProcessNode {
  id: EntityId;
  code: string;
  name: string;
  description: string;
  position: ProcessPosition;
}

/** A：responses/02_process_template_detail.json:data.graph.edges[]。 */
export interface ProcessEdge {
  id: EntityId;
  source: EntityId;
  target: EntityId;
}

export interface ProcessViewport extends ProcessPosition {
  zoom: number;
}

/** A：所有已见模板图均为 version: 1；不推断其他版本。 */
export interface ProcessGraphV1 {
  version: 1;
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  viewport: ProcessViewport;
}

/** A：19 条列表对象与详情对象均实际包含这些字段。不是所有未来扩展的穷尽 schema。 */
export interface ProcessTemplateObserved {
  id: EntityId;
  name: string;
  description: string;
  graph: ProcessGraphV1;
  row_version: number;
  created_by: EntityId;
  creator_name: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export type ProcessTemplateListResponse = ObservedSuccess<ObservedPage<ProcessTemplateObserved>>;
export type ProcessTemplateDetailResponse = ObservedSuccess<ProcessTemplateObserved>;

/** A：08 中的字典项；string 不把这次六个 code 误当服务端永不扩展的枚举。 */
export interface GaugeApplicableTypeObserved {
  code: string;
  name: string;
  enabled: boolean;
  sort_order: number;
  builtin: boolean;
}

export interface GaugeApplicableTypesObserved {
  revision: number;
  items: GaugeApplicableTypeObserved[];
}

export type GaugeApplicableTypesResponse = ObservedSuccess<GaugeApplicableTypesObserved>;

export const observedGaugeApplicableCodes = [
  'linear_dimension',
  'angular_dimension',
  'geometric_tolerance',
  'thread',
  'surface_roughness',
  'welding',
] as const;

/**
 * A：10_workspace_search.json 的单个 personal workspace 样本。
 * member_role: "admin" 是空间成员角色；不等同平台系统管理员。
 * admin_names 仅观察到 []，无法确认非空元素类型，故为 unknown[]。
 */
export interface WorkspaceObserved {
  id: EntityId;
  name: string;
  type: string; // 已见 "personal"；其他值未确认。
  owner_user_id: EntityId;
  status: string; // 已见 "active"；其他值未确认。
  created_at: IsoTimestamp;
  member_role: string; // 已见 "admin"；完整权限枚举未知。
  member_count: number;
  admin_names: unknown[];
}

export type WorkspaceSearchResponse = ObservedSuccess<ObservedPage<WorkspaceObserved>>;

/** A：响应 manifest 中实际使用过的模板查询字段。 */
export interface ProcessTemplateListQueryObserved {
  page: number;
  page_size: number;
  keyword?: string;
}

export interface WorkspaceSearchQueryObserved {
  page: number;
  page_size: number;
}

/**
 * C：以下写入载荷来自调用代码，未实测 POST/PUT/DELETE。
 * 特意独立命名空间，避免被当成已验证的完整服务端契约。
 */
export namespace SourceInferred {
  /** processTemplates.js + ProcessTemplateEditor：POST /admin/process-templates。 */
  export interface TemplateCreateRequest {
    name: string;
    description: string;
    graph: ProcessGraphV1;
  }

  /** C：PUT 在 create payload 上添加当前服务器 row_version。 */
  export interface TemplateUpdateRequest extends TemplateCreateRequest {
    row_version: number;
  }

  export interface TemplateDeleteQuery {
    row_version: number;
  }

  /** C：关联模板到尚无工序安排的图纸时，这四项在调用点明确出现。 */
  export interface ApplyTemplateToDrawingRequest {
    description: string;
    graph: ProcessGraphV1;
    source_template_id: EntityId;
    source_template_row_version: number;
  }

  /** C：PUT wrapper 确认版本字段，完整安排 payload 未从调用方采集。 */
  export interface ArrangementUpdateVersionField {
    row_version: number;
  }

  export interface ArrangementDeleteQuery {
    arrangement_id: EntityId;
    row_version: number;
  }

  export interface ExplicitWorkspaceHeaders {
    'X-Workspace-ID': EntityId;
  }

  export interface LinkedDrawingsQuery {
    page: number;
    page_size: number;
  }

  /**
   * C：仅表示 UI 所访问的字段投影；不是完整响应对象。
   * 没有实际 JSON，且多个字段使用 fallback，保留 optional/null。
   */
  export interface LinkedDrawingUiProjection {
    drawing_package_id: EntityId;
    drawing_name: string;
    drawing_no?: string | null;
    revision?: string | null;
    linked_by_name?: string | null;
    linked_at?: IsoTimestamp | null;
  }
}

/** A：已捕获 JSON 的 GET；路径包含 /api/v1，HTTP 状态统一未知。 */
export const observedGetContracts = {
  processTemplates: {
    path: '/api/v1/process-templates',
    evidence: 'A',
    httpStatus: null,
    responses: ['01_process_templates_page1.json', '03_process_templates_keyword.json', '04_process_templates_page2.json', '05_process_templates_empty.json'],
  },
  processTemplateDetail: {
    path: '/api/v1/process-templates/{id}',
    evidence: 'A',
    httpStatus: null,
    responses: ['02_process_template_detail.json', '13_process_template_after_checks.json'],
  },
  gaugeApplicableTypes: {
    path: '/api/v1/basic-data/gauge-applicable-types',
    evidence: 'A',
    httpStatus: null,
    responses: ['08_gauge_applicable_types.json'],
  },
  workspaceSearch: {
    path: '/api/v1/workspaces/mine/search',
    evidence: 'A',
    httpStatus: null,
    responses: ['10_workspace_search.json'],
  },
} as const;

/** C：只记录源码明确出现的路径/方法；不为未知响应虚构返回类型。 */
export const sourceInferredEndpoints = [
  { method: 'POST', path: '/api/v1/admin/process-templates', workspaceHeader: 'omit-auto', evidence: 'C' },
  { method: 'PUT', path: '/api/v1/admin/process-templates/{id}', workspaceHeader: 'omit-auto', evidence: 'C' },
  { method: 'DELETE', path: '/api/v1/admin/process-templates/{id}', workspaceHeader: 'omit-auto', evidence: 'C' },
  { method: 'GET', path: '/api/v1/process-templates/{id}/drawings', workspaceHeader: 'explicit', evidence: 'C' },
  { method: 'GET', path: '/api/v1/drawing-packages', workspaceHeader: 'explicit', evidence: 'C', fixedQuery: 'include_process_summary=true' },
  { method: 'GET', path: '/api/v1/drawing-packages/process-picker-counts', workspaceHeader: 'explicit', evidence: 'C' },
  { method: 'GET', path: '/api/v1/drawing-process-arrangements', workspaceHeader: 'explicit', evidence: 'C' },
  { method: 'GET', path: '/api/v1/drawing-packages/{id}/process-arrangement', workspaceHeader: 'explicit', evidence: 'C' },
  { method: 'POST', path: '/api/v1/drawing-packages/{id}/process-arrangement', workspaceHeader: 'explicit', evidence: 'C' },
  { method: 'PUT', path: '/api/v1/drawing-packages/{id}/process-arrangement', workspaceHeader: 'explicit', evidence: 'C' },
  { method: 'DELETE', path: '/api/v1/drawing-packages/{id}/process-arrangement', workspaceHeader: 'explicit', evidence: 'C' },
  { method: 'GET', path: '/api/v1/drawing-packages/{id}/process-arrangement/annotations', workspaceHeader: 'explicit', evidence: 'C' },
  { method: 'POST', path: '/api/v1/drawing-packages/{id}/process-arrangement/inspection-reports', workspaceHeader: 'explicit', evidence: 'C' },
] as const;
