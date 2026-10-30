import assert from "node:assert/strict";
import test from "node:test";

import { createStoredZip } from "../src/editor/zip.ts";

test("stored ZIP contains local entries, a central directory, and UTF-8 file names", async () => {
  const zip = new Uint8Array(await (await createStoredZip([
    { name: "frames/frame_0000.txt", data: "first" },
    { name: "정보.json", data: "{}" },
  ])).arrayBuffer());
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), 2);
  assert.ok(new TextDecoder().decode(zip).includes("frames/frame_0000.txt"));
  assert.ok(new TextDecoder().decode(zip).includes("정보.json"));
});
