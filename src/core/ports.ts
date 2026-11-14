export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;
export interface SqlSession {
  query<T extends object = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: readonly SqlValue[]): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  backup(): Promise<void>;
  close(): Promise<void>;
}
export interface DatabaseAdapter {
  read<T>(work: (session: SqlSession) => Promise<T>): Promise<T>;
  transaction<T>(work: (session: SqlSession) => Promise<T>): Promise<T>;
  backup(): Promise<void>;
  close(): Promise<void>;
}

// Future platform boundaries. No default implementations or successful no-ops.
export interface FileAdapter {
  read(relativeId: string): Promise<Uint8Array>;
  writeAtomic(relativeId: string, bytes: Uint8Array): Promise<void>;
  remove(relativeId: string): Promise<void>;
}
export interface TransportAdapter {
  send(encryptedPacket: Uint8Array): Promise<{ deliveryId: string }>;
  receive(cursor: string | null): Promise<{ packets: Uint8Array[]; cursor: string }>;
}
export interface SecureCredentialsAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface ExternalActionsAdapter {
  openUrl(url: string): Promise<void>;
  createCalendarEvent(event: { title: string; startsLocal: string }): Promise<void>;
}
export interface PlatformLifecycleAdapter {
  subscribe(listener: (state: 'active' | 'inactive') => void): () => void;
}
