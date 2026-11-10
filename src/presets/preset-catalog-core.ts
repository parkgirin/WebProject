import { parseUserBodyPresets, type UserBodyPreset } from "./body-presets.ts";
import { parseUserPosePresets, type UserPosePreset } from "./pose-presets.ts";
import { parseRigPreset, type RigPreset } from "../storage/rig-preset.ts";

type LoadedModule = unknown | { default: unknown };

export function parseBodyPresetModules(modules: Record<string, LoadedModule>): UserBodyPreset[] {
  return parseCatalog(modules, parseUserBodyPresets, "체형", "body", (path, preset) => {
    if (!preset.proportions?.joints.length) throw new Error("체형 정보가 없는 프리셋입니다.");
    return createFileEntry(path, "body", preset);
  });
}

export function parsePosePresetModules(modules: Record<string, LoadedModule>): UserPosePreset[] {
  return parseCatalog(modules, parseUserPosePresets, "포즈", "pose", (path, preset) => {
    if (!preset.pose?.joints.length) throw new Error("포즈 정보가 없는 프리셋입니다.");
    return createFileEntry(path, "pose", preset);
  });
}

function parseCatalog<T extends { id: string }>(
  modules: Record<string, LoadedModule>,
  parse: (value: unknown) => T[],
  label: string,
  kind: "body" | "pose",
  fromRigPreset: (path: string, preset: RigPreset) => T,
): T[] {
  const entries = Object.entries(modules).sort(([first], [second]) => first.localeCompare(second)).map(([path, module]) => {
    const value = isRecord(module) && "default" in module ? module.default : module;
    try {
      if (isRecord(value) && value.format === "pose-mesh-editor") {
        return fromRigPreset(path, parseRigPreset(JSON.stringify(value)));
      }
      return parse([value])[0];
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} 프리셋 데이터가 올바르지 않습니다.`;
      throw new Error(`${path}: ${message}`);
    }
  });
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`${label} 프리셋 ID가 중복됩니다: ${entry.id}`);
    ids.add(entry.id);
  }
  return entries;
}

function createFileEntry(path: string, kind: "body" | "pose", preset: RigPreset): UserBodyPreset | UserPosePreset {
  const fileName = path.split("/").at(-1)?.replace(/\.json$/i, "") ?? `${kind}-preset`;
  return {
    id: `file-${kind}:${path}`,
    name: fileName.replace(/[-_]+/g, " ").trim() || `${kind} preset`,
    createdAt: preset.createdAt,
    preset,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
