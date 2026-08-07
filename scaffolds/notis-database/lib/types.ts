export type DatabaseCatalogRow = {
  id: string;
  slug: string | null;
  name: string | null;
  description: string | null;
  icon: string | null;
  owner_app_id: string | null;
  owner_app_name: string | null;
  documents_count?: number | null;
  total_documents: number | null;
  successful_documents: number | null;
  updated_at: string | null;
};

export type ListDatabasesArgs = Record<string, never>;

export type ListDatabasesResult = {
  databases: DatabaseCatalogRow[];
  total_count: number;
};

export type GetDatabaseArgs = {
  database_id?: string;
  database_slug?: string;
};

export type QueryDatabaseArgs = {
  database_id?: string;
  database_slug?: string;
  query: {
    page_size?: number;
  };
  offset?: number;
};

export type DatabasePropertyKind =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'date'
  | 'files'
  | 'relation'
  | 'formula'
  | 'people'
  | string;

export type PropertyOption = {
  id: string | null;
  name: string | null;
  color: string | null;
  order: number | null;
};

export type RelationTarget = {
  database_id: string | null;
  database_slug: string | null;
  database_name: string | null;
};

export type DatabaseProperty = {
  id: string;
  name: string | null;
  type: DatabasePropertyKind;
  description: string | null;
  order: number | null;
  storage_family: string | null;
  options?: PropertyOption[];
  format?: string | null;
  expression?: string | null;
  relation_target?: RelationTarget;
};

export type DatabaseDetail = {
  id: string;
  slug: string | null;
  name: string | null;
  description: string | null;
  icon: string | null;
  cover: string | null;
  owner_app_id: string | null;
  owner_app_name: string | null;
  content_type: string | null;
  view_config: unknown;
  documents_count?: number | null;
  total_documents: number | null;
  successful_documents: number | null;
  created_at: string | null;
  updated_at: string | null;
  schema?: {
    schema_version?: unknown;
    value_encoding_version?: unknown;
    coercion_version?: unknown;
    title_property_id?: string | null;
    properties: DatabaseProperty[];
  };
};

export type GetDatabaseResult =
  | { database: DatabaseDetail }
  | { status: 'error'; message: string };

export type DocumentPropertyValue = unknown;

export type DatabaseDocument = {
  id: string;
  title?: string | null;
  properties?: Record<string, DocumentPropertyValue>;
  property_states?: Record<string, string>;
  url?: string | null;
  createdAt?: string | null;
  lastEditedTime?: string | null;
  icon?: string | null;
  cover?: string | null;
};

export type QueryDatabaseResult =
  | {
      status: 'success';
      documents: DatabaseDocument[];
      results_count: number;
      total_matching?: number;
      has_more: boolean;
      next_offset: number | null;
    }
  | { status: 'error'; message: string };
