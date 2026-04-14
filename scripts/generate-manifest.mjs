import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const repeatableFlags = new Set(["component", "backend", "source-part"]);

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
      });
    }
  }

  await walk(resolvedStageDir);
  return entries;
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
  const roles = {};
  let totalBytes = 0;
  let fileCount = 0;
  let symlinkCount = 0;

  for (const entry of files) {
    roles[entry.role] = (roles[entry.role] ?? 0) + 1;
    if (entry.type === "file") {
      fileCount += 1;
      totalBytes += entry.size ?? 0;
    } else if (entry.type === "symlink") {
      symlinkCount += 1;
    }
  }

  const manifest = {
    schemaVersion: 1,
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
    },
    files,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote manifest to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
