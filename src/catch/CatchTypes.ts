// Sankofa Catch wire contract — RN mirror of server/engine/ee/catch/wire.go.
//
// Identical field names to the Go struct. Renames here would be a
// wire-contract break; every SDK (web, rn, ios, android, flutter,
// node, go, python, java) uses this exact JSON shape.

export const WireVersionCurrent = 1 as const;

export type Level = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export type EventType =
  | 'unhandled_exception'
  | 'unhandled_rejection'
  | 'console_error'
  | 'handled'
  | 'anr'
  | 'oom'
  | 'native_crash'
  | (string & {});

export type Platform =
  | 'javascript'
  | 'react-native'
  | 'ios'
  | 'android'
  | 'flutter'
  | 'node'
  | 'go'
  | 'python'
  | 'java';

export interface SDKInfo {
  name: string;
  version: string;
}

export interface Mechanism {
  type: string;
  handled: boolean;
  description?: string;
}

export interface StackFrame {
  filename?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  abs_path?: string;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  in_app?: boolean;
  vars?: Record<string, unknown>;
  platform?: string;
  instruction_addr?: string;
  package?: string;
  symbol?: string;
  symbol_addr?: string;
  addr_mode?: string;
}

export interface StackTrace {
  frames: StackFrame[];
}

export interface Exception {
  type: string;
  value: string;
  module?: string;
  mechanism?: Mechanism;
  stacktrace?: StackTrace;
  chained?: Exception[];
}

export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  ip_address?: string;
  segment?: string;
  data?: Record<string, string>;
}

export interface DeviceContext {
  os?: string;
  os_version?: string;
  browser?: string;
  browser_version?: string;
  model?: string;
  arch?: string;
  memory_mb?: number;
  screen?: string;
  locale?: string;
  country?: string;
  timezone?: string;
  app_version?: string;
  online?: boolean;
}

export interface Breadcrumb {
  ts_ms: number;
  type: string;
  category?: string;
  message?: string;
  level?: Level;
  data?: Record<string, unknown>;
}

export interface DebugImage {
  type: 'macho' | 'elf' | 'pe' | 'wasm' | 'proguard' | 'sourcemap';
  debug_id: string;
  code_id?: string;
  code_file?: string;
  debug_file?: string;
  image_addr: string;
  image_size?: number;
  image_vmaddr?: string;
  arch?: string;
}

export interface DebugMeta {
  images?: DebugImage[];
  sdk_info?: {
    sdk_name?: string;
    version_major?: number;
    version_minor?: number;
    version_patchlevel?: number;
  };
}

export interface CatchEvent {
  wire_version: typeof WireVersionCurrent;
  event_id: string;
  ts_ms: number;
  received_at_ms?: number;
  environment: 'live' | 'test';
  project_id?: string;

  distinct_id?: string;
  anon_id?: string;
  session_id?: string;

  level: Level;
  type: EventType;

  exception?: Exception;
  message?: string;

  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: UserContext;
  device?: DeviceContext;
  release?: string;
  platform: Platform;
  sdk: SDKInfo;

  breadcrumbs?: Breadcrumb[];
  fingerprint?: string[];

  flag_snapshot?: Record<string, string>;
  config_snapshot?: Record<string, unknown>;
  trace_id?: string;
  span_id?: string;
  replay_chunk_index?: number;
  debug_meta?: DebugMeta;
}

export interface CatchBatch {
  wire_version: typeof WireVersionCurrent;
  events: CatchEvent[];
}

// ── Handshake config ────────────────────────────────────────────────

export interface CatchHandshakeConfig {
  enabled?: boolean;
  wire_version?: number;
  ingest_url?: string;
  sampling?: {
    error_sample_rate?: number;
    transaction_sample_rate?: number;
    profiles_sample_rate?: number;
  };
  replay?: {
    on_error_enabled?: boolean;
    burst_seconds?: number;
  };
  breadcrumbs?: {
    max_buffer?: number;
  };
  reason?: string;
}

// ── Public API ──────────────────────────────────────────────────────

export interface CaptureOptions {
  level?: Level;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: UserContext;
  fingerprint?: string[];
  contexts?: {
    trace?: { trace_id: string; span_id?: string };
  };
}

export interface SankofaCatchAPI {
  captureException(err: unknown, options?: CaptureOptions): string;
  captureMessage(message: string, options?: CaptureOptions): string;
  addBreadcrumb(crumb: Omit<Breadcrumb, 'ts_ms'> & { ts_ms?: number }): void;
  setUser(user: UserContext | null): void;
  setTags(tags: Record<string, string>): void;
  setExtra(key: string, value: unknown): void;
  flush(): Promise<void>;
}
