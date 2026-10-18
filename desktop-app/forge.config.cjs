const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

if (process.platform === 'win32') {
  const shortTemp = process.env.DSBOT_BUILD_TEMP || path.resolve(__dirname, '..', '..', 't');
  fs.mkdirSync(shortTemp, { recursive: true });
  let tempRoot = shortTemp;
  for (const letter of ['Z', 'Y', 'X', 'W', 'V', 'U', 'T', 'S', 'R']) {
    const drive = `${letter}:`;
    if (fs.existsSync(`${drive}\\`)) continue;
    const result = spawnSync('subst.exe', [drive, shortTemp], { windowsHide: true, stdio: 'ignore' });
    if (!result.error && result.status === 0) {
      tempRoot = `${drive}\\`;
      process.once('exit', () => spawnSync('subst.exe', [drive, '/D'], { windowsHide: true, stdio: 'ignore' }));
      break;
    }
  }
  process.env.TEMP = tempRoot;
  process.env.TMP = tempRoot;
}

module.exports = {
  outDir: process.env.DSBOT_DIST_DIR || path.resolve(__dirname, '..', '..', 'dist'),
  packagerConfig: {
    asar: true,
    extraResource: [
      'runtime/hide-console.cjs',
      'runtime/register-snowluma-resolver.mjs',
      'runtime/snowluma-esm-resolver.mjs',
      'runtime/bundle/DSBot-runtime.zip'
    ],
    ignore: [/^\/(?:out|release(?:-[^/]+)?|scripts|runtime)(?:\/|$)/],
    executableName: 'DSBotDesktop',
    appBundleId: 'com.dsbot.desktop',
    download: {
      mirrorOptions: {
        mirror: 'https://npmmirror.com/mirrors/electron/'
      }
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'DSBotDesktop',
        authors: 'DSBot',
        description: 'DSBot 桌面端'
      }
    }
  ]
};
