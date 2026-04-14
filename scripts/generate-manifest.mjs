import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const repeatableFlags = new Set(["component", "backend", "source-part", "component-map"]);

function parseArgs(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }

    if (repeatableFlags.has(name)) {
      const current = values.get(name);
      if (Array.isArray(current)) {
        current.push(value);
      } else {
        values.set(name, [value]);
      }
    } else {
      values.set(name, value);
    }

    index += 1;
  }

  const required = [
    "stage",
    "output",
    "artifact-name",
    "package-type",
    "merge-target",
    "os",
    "arch",
    "archive-format",
    "manifest-file",
  ];

  for (const key of required) {
    if (!values.has(key)) {
      throw new Error(`Missing required flag --${key}`);
    }
  }

  return {
    stage: String(values.get("stage")),
    output: String(values.get("output")),
    artifactName: String(values.get("artifact-name")),
    packageType: String(values.get("package-type")),
    mergeTarget: String(values.get("merge-target")),
    os: String(values.get("os")),
    arch: String(values.get("arch")),
    archiveFormat: String(values.get("archive-format")),
    manifestFileName: String(values.get("manifest-file")),
    archiveFileName: values.has("archive-file") ? String(values.get("archive-file")) : undefined,
    components: toList(values.get("component")),
    backends: toList(values.get("backend")),
    sourceArtifacts: toList(values.get("source-part")),
    componentMaps: parseComponentMaps(toList(values.get("component-map"))),
  };
}

function toList(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function normalizeTargetPrefix(value) {
  if (!value || value === "." || value === "/") {
    return "";
  }
  return normalizeRelativePath(value).replace(/^\/+|\/+$/g, "");
}

function parseComponentMaps(entries) {
  return entries.map((entry) => {
    const parts = entry.split("|");
    if (parts.length < 3 || parts.length > 4) {
      throw new Error(
        `Invalid --component-map value "${entry}". Expected "component|sourceArtifact|sourceRoot|targetPrefix".`,
      );
    }

    const [componentId, sourceArtifact, sourceRoot, targetPrefix = "."] = parts;
    if (!componentId || !sourceArtifact || !sourceRoot) {
      throw new Error(
        `Invalid --component-map value "${entry}". Component, sourceArtifact, and sourceRoot are required.`,
      );
    }

    return {
      componentId,
      sourceArtifact,
      sourceRoot,
      targetPrefix: normalizeTargetPrefix(targetPrefix),
    };
  });
}

function inferRole(relativePath, manifestFileName) {
  const normalizedPath = relativePath.toLowerCase();
  const normalizedManifest = manifestFileName.toLowerCase();

  if (normalizedPath === normalizedManifest) {
    return "metadata";
  }
  if (normalizedPath.startsWith("include/")) {
    return "header";
  }
  if (normalizedPath.includes("/cmake/") || normalizedPath.endsWith(".cmake")) {
    return "cmake";
  }
  if (normalizedPath.endsWith(".pdb")) {
    return "debug-symbol";
  }
  if (
    normalizedPath.endsWith(".dll") ||
    normalizedPath.endsWith(".so") ||
    normalizedPath.includes(".so.") ||
    normalizedPath.endsWith(".dylib")
  ) {
    return "runtime-library";
  }
  if (
    normalizedPath.endsWith(".lib") ||
    normalizedPath.endsWith(".a") ||
    normalizedPath.endsWith(".exp")
  ) {
    return "link-library";
  }
  if (normalizedPath.endsWith(".exe")) {
    return "executable";
  }
  if (normalizedPath.startsWith("share/")) {
    return "resource";
  }
  if (normalizedPath.startsWith("bin/")) {
    return "runtime";
  }
  if (normalizedPath.startsWith("lib/")) {
    return "library";
  }
  return "other";
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function collectEntries(stageDir, manifestFileName, outputPath) {
  const resolvedStageDir = path.resolve(stageDir);
  const resolvedOutputPath = path.resolve(outputPath);
  const relativeOutputPath = normalizeRelativePath(path.relative(resolvedStageDir, resolvedOutputPath));
  const entries = [];

  async function walk(currentDir) {
    const children = await fs.readdir(currentDir, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      const absoluteChildPath = path.join(currentDir, child.name);
      const relativeChildPath = normalizeRelativePath(path.relative(resolvedStageDir, absoluteChildPath));

      if (relativeChildPath === relativeOutputPath) {
        continue;
      }

      if (child.isDirectory()) {
        await walk(absoluteChildPath);
        continue;
      }

      const role = inferRole(relativeChildPath, manifestFileName);

      if (child.isSymbolicLink()) {
        const linkTarget = await fs.readlink(absoluteChildPath);
        entries.push({
          path: relativeChildPath,
          type: "symlink",
          role,
          size: null,
          sha256: null,
          linkTarget: normalizeRelativePath(linkTarget),
          component: null,
          componentSourceArtifact: null,
        });
        continue;
      }

      const stats = await fs.stat(absoluteChildPath);
      if (!stats.isFile()) {
        continue;
      }

      entries.push({
        path: relativeChildPath,
        type: "file",
        role,
        size: stats.size,
        sha256: await sha256File(absoluteChildPath),
        component: null,
        componentSourceArtifact: null,
      });
    }
  }

  await walk(resolvedStageDir);
  return entries;
}

function createComponentRecord(componentId) {
  return {
    id: componentId,
    sourceArtifacts: new Set(),
    sourceMappings: [],
  };
}

async function walkSourceFiles(sourceRoot, onEntry) {
  const resolvedRoot = path.resolve(sourceRoot);
  const stats = await fs.stat(resolvedRoot).catch(() => null);
  if (!stats?.isDirectory()) {
    return false;
  }

  async function walk(currentDir) {
    const children = await fs.readdir(currentDir, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      const absoluteChildPath = path.join(currentDir, child.name);
      const relativeChildPath = normalizeRelativePath(path.relative(resolvedRoot, absoluteChildPath));

      if (child.isDirectory()) {
        await walk(absoluteChildPath);
        continue;
      }

      await onEntry({
        absolutePath: absoluteChildPath,
        relativePath: relativeChildPath,
        dirent: child,
      });
    }
  }

  await walk(resolvedRoot);
  return true;
}

async function applyComponentMappings(stageEntries, componentMaps) {
  const stageEntryByPath = new Map(stageEntries.map((entry) => [entry.path, entry]));
  const componentById = new Map();

  for (const mapping of componentMaps) {
    let component = componentById.get(mapping.componentId);
    if (!component) {
      component = createComponentRecord(mapping.componentId);
      componentById.set(mapping.componentId, component);
    }

    component.sourceArtifacts.add(mapping.sourceArtifact);

    const sourceRootResolved = path.resolve(mapping.sourceRoot);
    const mappingRecord = {
      sourceArtifact: mapping.sourceArtifact,
      sourceRoot: normalizeRelativePath(path.relative(process.cwd(), sourceRootResolved)),
      targetPrefix: mapping.targetPrefix,
      exists: false,
    };
    component.sourceMappings.push(mappingRecord);

    const exists = await walkSourceFiles(sourceRootResolved, async ({ absolutePath, relativePath, dirent }) => {
      const stagePath = normalizeRelativePath(
        mapping.targetPrefix ? path.join(mapping.targetPrefix, relativePath) : relativePath,
      );
      const stageEntry = stageEntryByPath.get(stagePath);
      if (!stageEntry) {
        return;
      }

      if (dirent.isSymbolicLink()) {
        if (stageEntry.type !== "symlink") {
          return;
        }

        const sourceLinkTarget = normalizeRelativePath(await fs.readlink(absolutePath));
        if (stageEntry.linkTarget !== sourceLinkTarget) {
          return;
        }
      } else {
        if (stageEntry.type !== "file") {
          return;
        }

        const sourceHash = await sha256File(absolutePath);
        if (stageEntry.sha256 !== sourceHash) {
          return;
        }
      }

      stageEntry.component = mapping.componentId;
      stageEntry.componentSourceArtifact = mapping.sourceArtifact;
    });

    mappingRecord.exists = exists;
  }

  return componentById;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stageDir = path.resolve(options.stage);
  const outputPath = path.resolve(options.output);
  const outputDir = path.dirname(outputPath);

  const stageStats = await fs.stat(stageDir).catch(() => null);
  if (!stageStats?.isDirectory()) {
    throw new Error(`Stage directory does not exist: ${stageDir}`);
  }

  await fs.mkdir(outputDir, { recursive: true });

  const files = await collectEntries(stageDir, options.manifestFileName, outputPath);
  const componentById = await applyComponentMappings(files, options.componentMaps);

  for (const componentId of options.components) {
    if (!componentById.has(componentId)) {
      componentById.set(componentId, createComponentRecord(componentId));
    }
  }

  const roles = {};
  let totalBytes = 0;
  let fileCount = 0;
  let symlinkCount = 0;
  let mappedEntryCount = 0;

  for (const entry of files) {
    roles[entry.role] = (roles[entry.role] ?? 0) + 1;
    if (entry.component) {
      mappedEntryCount += 1;
    }
    if (entry.type === "file") {
      fileCount += 1;
      totalBytes += entry.size ?? 0;
    } else if (entry.type === "symlink") {
      symlinkCount += 1;
    }
  }

  const components = [...componentById.values()]
    .map((component) => {
      const componentFiles = files
        .filter((entry) => entry.component === component.id)
        .map((entry) => entry.path)
        .sort((left, right) => left.localeCompare(right));

      return {
        id: component.id,
        sourceArtifacts: [...component.sourceArtifacts].sort((left, right) => left.localeCompare(right)),
        sourceMappings: component.sourceMappings,
        fileCount: componentFiles.length,
        files: componentFiles,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    artifact: {
      name: options.artifactName,
      packageType: options.packageType,
      mergeTarget: options.mergeTarget,
      rootDirectory: path.basename(stageDir),
      manifestFileName: options.manifestFileName,
      archiveFileName: options.archiveFileName,
      os: options.os,
      arch: options.arch,
      archiveFormat: options.archiveFormat,
      components: options.components,
      backends: options.backends,
      sourceArtifacts: options.sourceArtifacts,
    },
    summary: {
      entryCount: files.length,
      fileCount,
      symlinkCount,
      totalBytes,
      roles,
      mappedEntryCount,
      unmappedEntryCount: files.length - mappedEntryCount,
    },
    components,
    files,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote manifest to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
