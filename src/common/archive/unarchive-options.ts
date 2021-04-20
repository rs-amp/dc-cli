export default interface UnarchiveOptions {
  id?: string;
  schemaId?: string | string[];
  revertLog?: string;
  silent?: boolean;
  ignoreError?: boolean;
  repoId?: string | string[];
  folderId?: string | string[];

  facet?: string;

  force?: boolean;
  logFile?: string;
}
