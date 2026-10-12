import { createDefaultRig } from "./rig/default-rig";

export function createApp(container: HTMLDivElement): void {
  const rig = createDefaultRig();

  container.innerHTML = `
    <main class="app-shell">
      <header class="app-header">
        <h1>Pose Mesh Editor</h1>
        <p>관절과 연결 면을 편집하는 도구</p>
      </header>
      <section class="editor-placeholder" aria-label="편집 영역">
        <strong>리그 준비됨</strong>
        <span>관절 ${rig.joints.length}개 · 연결 면 ${rig.faces.length}개</span>
      </section>
    </main>
  `;
}
