import { createElement } from 'react';
import type { NotisDocumentEditorProps, NotisDocumentPageProps, NotisRuntimeUI } from './runtime';
import type { SpacePublicRecordUI } from './space';

/**
 * A DocumentPage `properties` choice with these editor-only properties left out. A chosen `include` list is filtered
 * case-insensitively; otherwise they are excluded by name, which the host matches exactly, so the names passed are the
 * declared ones plus the real names the page has seen in rows and schemas.
 */
export function publicDocumentPageProperties(option: NotisDocumentPageProps['properties'], names: readonly string[]): NotisDocumentPageProps['properties'] {
  if (option === 'hidden' || !names.length) return option;
  const hidden = new Set(names.map(name => name.toLowerCase()));
  const chosen = option && option !== 'panel' ? option : {};
  return { ...chosen,
    ...(chosen.include ? { include: chosen.include.filter(name => !hidden.has(name.toLowerCase())) } : {}),
    exclude: [...new Set([...(chosen.exclude ?? []), ...names])] };
}

/**
 * The host record components while an editor views the Space as the public. They read and write with the editor's
 * authority, so what they draw is held to the public floor here: a document page leaves the editor-only properties
 * out, a document editor shows no properties, and the properties form (which cannot leave single properties out) is
 * not drawn. The title stays: the host does not say which column is the record's title.
 */
export const publicRecordUI: SpacePublicRecordUI = (ui, columns): NotisRuntimeUI => {
  const { DocumentPage, DocumentEditor } = ui;
  return { ...ui,
    DocumentPage: DocumentPage ? function PublicDocumentPage(props: NotisDocumentPageProps) {
      return createElement(DocumentPage, { ...props, properties: publicDocumentPageProperties(props.properties, columns()) });
    } : undefined,
    DocumentEditor: DocumentEditor ? function PublicDocumentEditor(props: NotisDocumentEditorProps) {
      return createElement(DocumentEditor, { ...props, showProperties: false });
    } : undefined,
    RecordProperties: undefined,
  };
};
