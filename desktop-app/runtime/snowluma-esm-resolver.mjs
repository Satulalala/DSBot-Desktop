import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SNOWLUMA_PACKAGE_PATH = '/node_modules/@snowluma/';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.includes(SNOWLUMA_PACKAGE_PATH)) {
    const target = new URL(specifier, context.parentURL);
    const targetPath = fileURLToPath(target);
    if (!path.extname(targetPath)) {
      for (const extension of ['.js', '.json']) {
        if (fs.existsSync(`${targetPath}${extension}`)) {
          return nextResolve(`${specifier}${extension}`, context);
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
