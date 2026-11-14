import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createDefaultRig } from "../src/rig/default-rig.ts";
import { createUserBodyPreset } from "../src/presets/body-presets.ts";
import { createUserPosePreset } from "../src/presets/pose-presets.ts";
import { parseBodyPresetModules, parsePosePresetModules } from "../src/presets/preset-catalog-core.ts";

test("folder preset modules are validated and sorted by file path", () => {
  const later = createUserBodyPreset("shared-body-b", "두 번째", createDefaultRig());
  const earlier = createUserBodyPreset("shared-body-a", "첫 번째", createDefaultRig());

  const parsed = parseBodyPresetModules({
    "./data/body/z-later.json": { default: later },
    "./data/body/a-earlier.json": earlier,
  });

  assert.deepEqual(parsed.map((preset) => preset.id), ["shared-body-a", "shared-body-b"]);
});

test("folder pose presets accept JSON default exports", () => {
  const pose = createUserPosePreset("shared-pose-idle", "대기", createDefaultRig());
  assert.equal(parsePosePresetModules({ "./data/pose/idle.json": { default: pose } })[0].name, "대기");
});

test("regular exported rig presets use their file names in the selected folder", () => {
  const body = createUserBodyPreset("ignored", "ignored", createDefaultRig()).preset;
  const pose = createUserPosePreset("ignored", "ignored", createDefaultRig()).preset;

  assert.equal(parseBodyPresetModules({ "./data/body/slim_male.json": { default: body } })[0].name, "slim male");
  assert.equal(parsePosePresetModules({ "./data/pose/대기-자세.json": { default: pose } })[0].name, "대기 자세");
});

test("folder preset errors identify invalid files and duplicate ids", () => {
  assert.throws(
    () => parseBodyPresetModules({ "./data/body/broken.json": { default: { id: "broken" } } }),
    /broken\.json/,
  );

  const pose = createUserPosePreset("shared-pose-duplicate", "대기", createDefaultRig());
  assert.throws(
    () => parsePosePresetModules({
      "./data/pose/first.json": pose,
      "./data/pose/second.json": { default: { ...pose, name: "다른 이름" } },
    }),
    /ID가 중복됩니다/,
  );
});

test("the repository quadruped sample is a valid selectable preset", () => {
  const quadrupedPath = new URL("../src/presets/data/body/사족동물-기본체.json", import.meta.url);
  const quadruped = JSON.parse(readFileSync(quadrupedPath, "utf8"));

  assert.equal(parseBodyPresetModules({ "./data/body/사족동물-기본체.json": quadruped })[0].name,
    "사족동물 기본체");
});
