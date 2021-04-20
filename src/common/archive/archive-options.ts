export default interface ArchiveOptions {
  id?: string | string[];
  schemaId?: string | string[];
  revertLog?: string;
  repoId?: string | string[];
  folderId?: string | string[];

  facet?: string;

  logFile?: string;
  force?: boolean;
  silent?: boolean;
  ignoreError?: boolean;
}
