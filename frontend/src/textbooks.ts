import textbookRegistry from '../../shared/textbooks.json';

export type TextbookId = 'gaodai_shang' | 'gaodai_xia' | 'gaoshu_shang' | 'gaoshu_xia';

export interface TextbookSpec {
  id: TextbookId;
  name: string;
  path: string;
  subject: 'gaodai' | 'gaoshu';
  volume: 1 | 2;
}

type RegistryRow = {
  id: TextbookId;
  display_name: string;
  web_path: string;
  subject: 'gaodai' | 'gaoshu';
  volume: 1 | 2;
};

export const TEXTBOOKS: readonly TextbookSpec[] = (textbookRegistry as RegistryRow[]).map((item) => ({
  id: item.id,
  name: item.display_name,
  path: item.web_path,
  subject: item.subject,
  volume: item.volume,
}));

export const TEXTBOOK_IDS = new Set<string>(TEXTBOOKS.map((item) => item.id));
