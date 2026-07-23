import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const directoryFromMetaUrl = (metaUrl: string): string =>
  path.dirname(fileURLToPath(metaUrl));

export const listRuntimeModules = async (directory: string): Promise<string[]> => {
  const extension = path.extname(fileURLToPath(import.meta.url));
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && path.extname(entry.name) === extension)
    .map((entry) => path.join(directory, entry.name));
};

export const importModule = async <T>(filePath: string): Promise<T> =>
  (await import(pathToFileURL(filePath).href)) as T;
