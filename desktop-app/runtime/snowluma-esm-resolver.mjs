import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SNOWLUMA_PACKAGE_PATH = '/node_modules/@snowluma/';
const QQ_MODE_PLUGIN_PATH = '/dsh-home/node_modules/qq-mode-console/';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/schemastery' && context.parentURL?.includes(QQ_MODE_PLUGIN_PATH)) {
    const bridgeRoot = process.env.DSBOT_BRIDGE_ROOT;
    if (bridgeRoot) {
      const schemaPath = path.join(
        path.dirname(bridgeRoot),
        'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai',
        'schemastery', 'lib', 'index.mjs',
      );
      if (fs.existsSync(schemaPath)) return nextResolve(pathToFileURL(schemaPath).href, context);
    }
  }

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
