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

test("repository sample files are valid selectable presets", () => {
  const bodyPath = new URL("../src/presets/data/body/sample-broad-upper-body.json", import.meta.url);
  const posePath = new URL("../src/presets/data/pose/sample-relaxed-arms.json", import.meta.url);
  const verticalArmsPath = new URL("../src/presets/data/pose/팔-수직-내리기.json", import.meta.url);
  const body = JSON.parse(readFileSync(bodyPath, "utf8"));
  const pose = JSON.parse(readFileSync(posePath, "utf8"));
  const verticalArms = JSON.parse(readFileSync(verticalArmsPath, "utf8"));

  assert.equal(parseBodyPresetModules({ "./data/body/sample-broad-upper-body.json": body })[0].name,
    "sample broad upper body");
  assert.equal(parsePosePresetModules({ "./data/pose/sample-relaxed-arms.json": pose })[0].name,
    "sample relaxed arms");
  assert.equal(parsePosePresetModules({ "./data/pose/팔-수직-내리기.json": verticalArms })[0].name,
    "팔 수직 내리기");
});
