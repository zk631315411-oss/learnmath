export type CatalogManifest = {
  schema_version: number;
  node_index?: Record<string, CatalogNodeIndexItem[]>;
  catalogs: CatalogEntry[];
};

export type CatalogEntry = {
  textbook_id: string;
  display_name: string;
  catalog_version: string;
  index_path: string;
  catalog_path: string;
  chapters: CatalogChapterSummary[];
};

export type CatalogChapterSummary = {
  id: string;
  name: string;
  number: number | null;
  order: number;
  node_count: number;
  first_page: number | null;
};

export type CatalogNode = {
  node_id: string;
  name: string;
  type?: string | null;
  chapter: string;
  section: string;
  section_node_id?: string | null;
  prerequisite_ids: string[];
  order: number;
};

export type CatalogNodeIndexItem = Pick<CatalogNode, 'node_id' | 'chapter' | 'section' | 'name' | 'order'>;
export type CatalogIndex = { textbook_id: string; catalog_version: string; node_index: CatalogNodeIndexItem[] };
export type CatalogSection = { id: string; name: string; page: number | null; nodes: CatalogNode[] };
export type CatalogChapter = CatalogChapterSummary & { sections: CatalogSection[] };
export type TextbookCatalog = Omit<CatalogEntry, 'chapters'> & { chapters: CatalogChapter[] };
