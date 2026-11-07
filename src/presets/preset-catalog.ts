import { parseBodyPresetModules, parsePosePresetModules } from "./preset-catalog-core.ts";

const bodyModules = import.meta.glob("./data/body/*.json", { eager: true, import: "default" });
const poseModules = import.meta.glob("./data/pose/*.json", { eager: true, import: "default" });

export const FILE_BODY_PRESETS = parseBodyPresetModules(bodyModules);
export const FILE_POSE_PRESETS = parsePosePresetModules(poseModules);
