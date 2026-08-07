import type { NotisRuntime } from '@notis/sdk';
import type {
  DatabaseCatalogRow,
  DatabaseDetail,
  DatabaseDocument,
  DatabaseProperty,
} from '@/lib/types';

type DatabaseSeed = {
  catalog: DatabaseCatalogRow;
  detail: DatabaseDetail;
};

const SCHEMA = (
  title_property_id: string,
  properties: DatabaseProperty[],
): DatabaseDetail['schema'] => ({
  schema_version: 1,
  value_encoding_version: 1,
  coercion_version: 1,
  title_property_id,
  properties,
});

function makeSeed(): DatabaseSeed[] {
  const customersDetail: DatabaseDetail = {
    id: 'db_customers',
    slug: 'customers',
    name: 'Customers',
    description:
      'Every person or company we sell to. The source of truth for billing identity, plan tier, and account ownership. Linked from Deals, Invoices, and Tasks.',
    icon: 'phosphor:users',
    cover: null,
    owner_app_id: 'app_sales_crm',
    owner_app_name: 'Sales CRM',
    content_type: null,
    view_config: null,
    total_documents: 4210,
    successful_documents: 4210,
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2026-04-20T00:00:00Z',
    schema: SCHEMA('prop_customers_name', [
      {
        id: 'prop_customers_name',
        name: 'name',
        type: 'title',
        description:
          'Display name shown across the workspace. Used as the canonical title in views and search.',
        order: 0,
        storage_family: 'title',
      },
      {
        id: 'prop_customers_email',
        name: 'email',
        type: 'email',
        description:
          'Primary contact email. Used to dedupe records when syncing from external CRMs.',
        order: 1,
        storage_family: 'text',
      },
      {
        id: 'prop_customers_plan',
        name: 'plan',
        type: 'select',
        description:
          'Subscription tier. Drives feature gating and upgrade prompts in the product.',
        order: 2,
        storage_family: 'select',
        options: [
          { id: 'plan_free', name: 'Free', color: 'purple', order: 0 },
          { id: 'plan_pro', name: 'Pro', color: 'blue', order: 1 },
          { id: 'plan_ent', name: 'Enterprise', color: 'yellow', order: 2 },
        ],
      },
      {
        id: 'prop_customers_owner',
        name: 'owner',
        type: 'people',
        description:
          'Account manager assigned to this customer. Routes follow-ups and reminders.',
        order: 3,
        storage_family: 'people',
      },
      {
        id: 'prop_customers_active_deals',
        name: 'active_deals',
        type: 'relation',
        description:
          'All deals where this customer is on the buying side, regardless of stage.',
        order: 4,
        storage_family: 'relation',
        relation_target: {
          database_id: 'db_deals',
          database_slug: 'deals',
          database_name: 'Deals',
        },
      },
    ]),
  };

  const dealsDetail: DatabaseDetail = {
    id: 'db_deals',
    slug: 'deals',
    name: 'Deals',
    description:
      'Pipeline records for every active and closed opportunity. Drives forecasting and revenue analytics.',
    icon: 'phosphor:currency-dollar',
    cover: null,
    owner_app_id: 'app_sales_crm',
    owner_app_name: 'Sales CRM',
    content_type: null,
    view_config: null,
    total_documents: 1120,
    successful_documents: 1120,
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2026-04-25T00:00:00Z',
    schema: SCHEMA('prop_deals_name', [
      {
        id: 'prop_deals_name',
        name: 'name',
        type: 'title',
        description: 'Short label for the deal, usually customer + product line.',
        order: 0,
        storage_family: 'title',
      },
      {
        id: 'prop_deals_amount',
        name: 'amount',
        type: 'number',
        description: 'Annualized contract value in USD.',
        order: 1,
        storage_family: 'number',
        format: 'dollar',
      },
      {
        id: 'prop_deals_stage',
        name: 'stage',
        type: 'status',
        description: 'Pipeline stage. Drives forecast probability.',
        order: 2,
        storage_family: 'status',
        options: [
          { id: 'stage_lead', name: 'Lead', color: 'gray', order: 0 },
          { id: 'stage_qualified', name: 'Qualified', color: 'blue', order: 1 },
          { id: 'stage_won', name: 'Won', color: 'green', order: 2 },
          { id: 'stage_lost', name: 'Lost', color: 'red', order: 3 },
        ],
      },
      {
        id: 'prop_deals_customer',
        name: 'customer',
        type: 'relation',
        description: 'Customer the deal belongs to.',
        order: 3,
        storage_family: 'relation',
        relation_target: {
          database_id: 'db_customers',
          database_slug: 'customers',
          database_name: 'Customers',
        },
      },
    ]),
  };

  const invoicesDetail: DatabaseDetail = {
    id: 'db_invoices',
    slug: 'invoices',
    name: 'Invoices',
    description: 'Issued invoices and their payment status.',
    icon: 'phosphor:file-text',
    cover: null,
    owner_app_id: 'app_sales_crm',
    owner_app_name: 'Sales CRM',
    content_type: null,
    view_config: null,
    total_documents: 890,
    successful_documents: 890,
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2026-04-25T00:00:00Z',
    schema: SCHEMA('prop_invoices_name', [
      {
        id: 'prop_invoices_name',
        name: 'invoice',
        type: 'title',
        description: 'Invoice number used externally.',
        order: 0,
        storage_family: 'title',
      },
      {
        id: 'prop_invoices_amount',
        name: 'amount',
        type: 'number',
        description: 'Line-item total in USD.',
        order: 1,
        storage_family: 'number',
        format: 'dollar',
      },
      {
        id: 'prop_invoices_due',
        name: 'due_date',
        type: 'date',
        description: 'When payment is expected.',
        order: 2,
        storage_family: 'date',
      },
    ]),
  };

  const tasksDetail: DatabaseDetail = {
    id: 'db_tasks',
    slug: 'tasks',
    name: 'Tasks',
    description:
      'Things to do across the workspace. Captures both personal todos and account follow-ups.',
    icon: 'phosphor:check-square',
    cover: null,
    owner_app_id: 'app_tasks_notes',
    owner_app_name: 'Tasks & Notes',
    content_type: null,
    view_config: null,
    total_documents: 785,
    successful_documents: 785,
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2026-04-29T00:00:00Z',
    schema: SCHEMA('prop_tasks_title', [
      {
        id: 'prop_tasks_title',
        name: 'task',
        type: 'title',
        description: 'Short imperative description of the work.',
        order: 0,
        storage_family: 'title',
      },
      {
        id: 'prop_tasks_status',
        name: 'status',
        type: 'status',
        description: 'Workflow state. Defaults to Not started.',
        order: 1,
        storage_family: 'status',
        options: [
          { id: 'task_not_started', name: 'Not started', color: 'gray', order: 0 },
          { id: 'task_in_progress', name: 'In progress', color: 'blue', order: 1 },
          { id: 'task_done', name: 'Done', color: 'green', order: 2 },
        ],
      },
      {
        id: 'prop_tasks_priority',
        name: 'priority',
        type: 'select',
        description: 'Lightweight triage label.',
        order: 2,
        storage_family: 'select',
        options: [
          { id: 'pri_low', name: 'Low', color: 'gray', order: 0 },
          { id: 'pri_med', name: 'Medium', color: 'yellow', order: 1 },
          { id: 'pri_high', name: 'High', color: 'red', order: 2 },
        ],
      },
      {
        id: 'prop_tasks_due',
        name: 'due_date',
        type: 'date',
        description: 'Optional deadline.',
        order: 3,
        storage_family: 'date',
      },
      {
        id: 'prop_tasks_notes',
        name: 'notes',
        type: 'rich_text',
        description: 'Free-form context for the task.',
        order: 4,
        storage_family: 'text',
      },
    ]),
  };

  const notesDetail: DatabaseDetail = {
    id: 'db_notes',
    slug: 'notes',
    name: 'Notes',
    description: 'Long-form notes captured from conversations and meetings.',
    icon: 'phosphor:note-pencil',
    cover: null,
    owner_app_id: 'app_tasks_notes',
    owner_app_name: 'Tasks & Notes',
    content_type: null,
    view_config: null,
    total_documents: 2304,
    successful_documents: 2304,
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2026-04-28T00:00:00Z',
    schema: SCHEMA('prop_notes_title', [
      {
        id: 'prop_notes_title',
        name: 'title',
        type: 'title',
        description: 'Short note title.',
        order: 0,
        storage_family: 'title',
      },
      {
        id: 'prop_notes_tags',
        name: 'tags',
        type: 'multi_select',
        description: 'Lightweight labels.',
        order: 1,
        storage_family: 'multi_select',
        options: [
          { id: 'tag_idea', name: 'idea', color: 'blue', order: 0 },
          { id: 'tag_meeting', name: 'meeting', color: 'green', order: 1 },
          { id: 'tag_followup', name: 'followup', color: 'orange', order: 2 },
        ],
      },
      {
        id: 'prop_notes_content',
        name: 'content',
        type: 'rich_text',
        description: 'The note body.',
        order: 2,
        storage_family: 'text',
      },
    ]),
  };

  const usersDetail: DatabaseDetail = {
    id: 'db_users',
    slug: 'users',
    name: 'Users',
    description: 'People with access to the Notis workspace.',
    icon: 'phosphor:user',
    cover: null,
    owner_app_id: 'app_identity',
    owner_app_name: 'Identity',
    content_type: null,
    view_config: null,
    total_documents: 64,
    successful_documents: 64,
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2026-04-15T00:00:00Z',
    schema: SCHEMA('prop_users_name', [
      {
        id: 'prop_users_name',
        name: 'name',
        type: 'title',
        description: 'Full name.',
        order: 0,
        storage_family: 'title',
      },
      {
        id: 'prop_users_email',
        name: 'email',
        type: 'email',
        description: 'Login email.',
        order: 1,
        storage_family: 'text',
      },
      {
        id: 'prop_users_role',
        name: 'role',
        type: 'select',
        description: 'Permission tier.',
        order: 2,
        storage_family: 'select',
        options: [
          { id: 'role_admin', name: 'Admin', color: 'red', order: 0 },
          { id: 'role_member', name: 'Member', color: 'blue', order: 1 },
          { id: 'role_guest', name: 'Guest', color: 'gray', order: 2 },
        ],
      },
    ]),
  };

  const all: DatabaseDetail[] = [
    customersDetail,
    dealsDetail,
    invoicesDetail,
    tasksDetail,
    notesDetail,
    usersDetail,
  ];

  return all.map((detail) => ({
    detail,
    catalog: {
      id: detail.id,
      slug: detail.slug,
      name: detail.name,
      description: detail.description,
      icon: detail.icon,
      owner_app_id: detail.owner_app_id,
      owner_app_name: detail.owner_app_name,
      total_documents: detail.total_documents,
      successful_documents: detail.successful_documents,
      updated_at: detail.updated_at,
    },
  }));
}

const SEED = makeSeed();

function mockPropertyValue(property: DatabaseProperty, index: number): Record<string, unknown> {
  switch (property.type) {
    case 'title':
      return {
        type: 'title',
        title: [{ type: 'text', text: { content: `${property.name ?? 'Title'} ${index + 1}` } }],
        rich_text: [{ type: 'text', text: { content: `${property.name ?? 'Title'} ${index + 1}` } }],
      };
    case 'rich_text':
      return {
        type: 'rich_text',
        rich_text: [{ type: 'text', text: { content: `Metadata value ${index + 1}` } }],
      };
    case 'number':
      return { type: 'number', number: (index + 1) * 10 };
    case 'select':
    case 'status': {
      const option = property.options?.[index % Math.max(property.options.length, 1)];
      return {
        type: property.type,
        [property.type]: option
          ? { id: option.id, name: option.name, color: option.color }
          : null,
      };
    }
    case 'multi_select': {
      const options = property.options?.slice(0, 2) ?? [];
      return {
        type: 'multi_select',
        multi_select: options.map((option) => ({
          id: option.id,
          name: option.name,
          color: option.color,
        })),
      };
    }
    case 'checkbox':
      return { type: 'checkbox', checkbox: index % 2 === 0 };
    case 'date':
      return { type: 'date', date: { start: `2026-04-${String(20 + index).padStart(2, '0')}`, end: null } };
    case 'relation':
      return { type: 'relation', relation: [{ id: `linked-${index + 1}` }] };
    case 'people':
      return { type: 'people', people: [{ id: `person-${index + 1}` }] };
    case 'files':
      return { type: 'files', files: [{ name: `file-${index + 1}.pdf` }] };
    case 'email':
      return { type: 'email', email: `person${index + 1}@example.com` };
    case 'phone_number':
      return { type: 'phone_number', phone_number: `+1 555 010${index}` };
    case 'url':
      return { type: 'url', url: `https://example.com/${index + 1}` };
    default:
      return { type: property.type, [property.type]: `Value ${index + 1}` };
  }
}

function mockDocuments(detail: DatabaseDetail): DatabaseDocument[] {
  const properties = detail.schema?.properties ?? [];
  return [0, 1, 2].map((index) => {
    const title = `${detail.name ?? 'Database'} record ${index + 1}`;
    return {
      id: `${detail.id}-doc-${index + 1}`,
      title,
      properties: Object.fromEntries(
        properties.map((property) => [
          property.name ?? property.id,
          property.type === 'title'
            ? {
                type: 'title',
                title: [{ type: 'text', text: { content: title } }],
                rich_text: [{ type: 'text', text: { content: title } }],
              }
            : mockPropertyValue(property, index),
        ]),
      ),
      property_states: {},
      url: null,
      created_time: `2026-04-${String(20 + index).padStart(2, '0')}T10:00:00Z`,
      last_edited_time: `2026-04-${String(23 + index).padStart(2, '0')}T15:30:00Z`,
      icon: null,
      cover: null,
    };
  });
}

export function installMockRuntime(): NotisRuntime {
  return {
    app: {
      id: 'dev-notis-database',
      name: 'Notis Database',
      icon: 'phosphor:database',
      description: 'Dev preview — seeded catalog data.',
    },
    route: {
      slug: 'catalog',
      path: '/',
      name: 'Catalog',
      icon: 'phosphor:database',
      parentSlug: null,
      default: true,
      collection: null,
    },
    databases: [],
    context: {},
    listTools: async () => [
      { name: 'LOCAL_NOTIS_DATABASE_LIST_DATABASES', inputSchema: { type: 'object', properties: {} } },
      { name: 'LOCAL_NOTIS_DATABASE_GET_DATABASE', inputSchema: { type: 'object', properties: {} } },
      { name: 'LOCAL_NOTIS_DATABASE_QUERY', inputSchema: { type: 'object', properties: {} } },
    ],
    callTool: async <TResult = unknown>(
      name: string,
      args?: Record<string, unknown>,
    ): Promise<TResult> => {
      if (name === 'LOCAL_NOTIS_DATABASE_LIST_DATABASES') {
        return {
          databases: SEED.map((s) => s.catalog),
          total_count: SEED.length,
        } as TResult;
      }
      if (name === 'LOCAL_NOTIS_DATABASE_GET_DATABASE') {
        const request = args ?? {};
        const id = typeof request.database_id === 'string' ? request.database_id : null;
        const slug = typeof request.database_slug === 'string' ? request.database_slug : null;
        const match = SEED.find(
          (s) => (id && s.detail.id === id) || (slug && s.detail.slug === slug),
        );
        if (!match) {
          return { status: 'error', message: 'Database not found' } as TResult;
        }
        return { database: match.detail } as TResult;
      }
      if (name === 'LOCAL_NOTIS_DATABASE_QUERY') {
        const request = args ?? {};
        const id = typeof request.database_id === 'string' ? request.database_id : null;
        const slug = typeof request.database_slug === 'string' ? request.database_slug : null;
        const match = SEED.find(
          (s) => (id && s.detail.id === id) || (slug && s.detail.slug === slug),
        );
        if (!match) {
          return { status: 'error', message: 'Database not found' } as TResult;
        }
        const documents = mockDocuments(match.detail);
        return {
          status: 'success',
          documents,
          results_count: documents.length,
          total_matching: documents.length,
          has_more: false,
          next_offset: null,
        } as TResult;
      }
      throw new Error(`Tool not available in dev preview: ${name}`);
    },
    request: async () => {
      throw new Error('Backend requests unavailable in dev preview.');
    },
  };
}
