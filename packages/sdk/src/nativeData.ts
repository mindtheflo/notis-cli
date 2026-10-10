/** The native row contract, shared by direct tools and scoped Space actions. */
export type NativeField = { property_id: string } | { property: string } | {
  column: 'record_key' | 'id' | 'title' | 'created_at' | 'updated_at' | 'last_edited_time' | 'content_type' | 'file_type';
};
export type NativeFilter = { and: NativeFilter[] } | { or: NativeFilter[] } | {
  field: NativeField;
  op: 'equals' | 'not_equals' | 'in' | 'contains' | 'not_contains' | 'does_not_contain'
    | 'starts_with' | 'ends_with' | 'is_empty' | 'is_not_empty' | 'greater_than' | 'less_than'
    | 'greater_than_or_equal_to' | 'less_than_or_equal_to' | 'before' | 'after' | 'on_or_before' | 'on_or_after';
  value?: unknown;
};
export interface NativeQuery {
  include_content?: boolean;
  include_archived?: boolean;
  mode?: 'rows' | 'search' | 'count' | 'aggregate';
  filter?: NativeFilter;
  sorts?: Array<{ field: NativeField; direction: 'asc' | 'desc' }>;
  search?: { text: string; fields: NativeField[] };
  aggregate?: { op: 'sum' | 'avg' | 'min' | 'max'; field: NativeField };
  page_size?: number;
  offset?: number;
}
export interface NativeInsert {
  columns?: { title?: string | null; icon?: string | null; cover?: string | null };
  properties?: Record<string, unknown>;
  body?: { blocks: Array<Record<string, unknown>> };
}
export interface NativeUpdate extends NativeInsert { record_key: string; expected_revision: number; }
export interface NativeDelete { record_key: string; expected_revision: number; }
export interface NativeMutationReceipt {
  record_key: string;
  id: string;
  database_id: string;
  revision: number;
  schema_revision: number;
  receipt_id: string;
  operation: 'insert' | 'update' | 'delete';
  replayed?: boolean;
}
