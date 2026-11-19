'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function userDataDirectory(env, platform = process.platform) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    if (local && path.win32.isAbsolute(local)) return path.win32.join(local, 'Deepmine');
    return path.win32.join(env.USERPROFILE || os.homedir(), 'AppData', 'Local', 'Deepmine');
  }
  const home = env.HOME || os.homedir();
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'Deepmine');
  const xdg = env.XDG_DATA_HOME;
  return path.posix.join(xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, '.local', 'share'), 'deepmine');
}

function settingsDirectory(appRoot = path.resolve(__dirname, '..'), env = process.env) {
  if (env.DEEPMINE_DATA_DIR) return path.resolve(env.DEEPMINE_DATA_DIR);
  const legacy = path.resolve(appRoot, '.deepmine');
  if (fs.existsSync(path.join(legacy, 'config.json'))) return legacy;
  return userDataDirectory(env);
}

module.exports = {settingsDirectory, userDataDirectory};
