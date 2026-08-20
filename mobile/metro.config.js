const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

/*
 * Resolve @golive/core to its TypeScript source so changes are picked up
 * live and Metro never serves a stale dist build (mirrors the web alias).
 */
const coreEntry = path.resolve(workspaceRoot, "packages/core/src/index.ts");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@golive/core") {
    return context.resolveRequest(context, coreEntry, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;