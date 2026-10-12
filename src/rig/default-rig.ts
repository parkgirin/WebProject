import type { Rig } from "./types";

export function createDefaultRig(): Rig {
  return {
    joints: [],
    ports: [],
    faces: [],
  };
}
