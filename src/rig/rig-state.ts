import {
  DEFAULT_RIG_LIMITS,
  type AxisPointSide,
  type Rig,
  type RigLimits,
} from "./types";

const VALID_SIDES = new Set<AxisPointSide>([-1, 1]);

export function validateRig(
  rig: Rig,
  limits: Readonly<RigLimits> = DEFAULT_RIG_LIMITS,
): string[] {
  const errors: string[] = [];
  const jointIds = new Set<string>();
  const faceIds = new Set<string>();

  if (!isHexColor(rig.defaultColor)) {
    errors.push(`Invalid default color: ${rig.defaultColor}`);
  }

  for (const joint of rig.joints) {
    if (jointIds.has(joint.id)) {
      errors.push(`Duplicate joint id: ${joint.id}`);
    }
    jointIds.add(joint.id);

    if (!(joint.radius > 0)) {
      errors.push(`Joint radius must be positive: ${joint.id}`);
    }
    if (joint.bodyRadius !== undefined && !(joint.bodyRadius > 0)) {
      errors.push(`Joint body radius must be positive: ${joint.id}`);
    }
    if (joint.axes.length > limits.maxAxesPerJoint) {
      errors.push(
        `Joint ${joint.id} has ${joint.axes.length} axes; current limit is ${limits.maxAxesPerJoint}`,
      );
    }

    const axisIds = new Set<string>();
    for (const axis of joint.axes) {
      if (axisIds.has(axis.id)) {
        errors.push(`Duplicate axis id: ${joint.id}.${axis.id}`);
      }
      axisIds.add(axis.id);

      const sides = new Set<AxisPointSide>();
      for (const side of axis.pointSides) {
        if (!VALID_SIDES.has(side)) {
          errors.push(`Invalid axis point side: ${joint.id}.${axis.id}[${side}]`);
        } else if (sides.has(side)) {
          errors.push(`Duplicate axis point side: ${joint.id}.${axis.id}[${side}]`);
        }
        sides.add(side);
      }
    }
  }

  for (const face of rig.faces) {
    if (faceIds.has(face.id)) {
      errors.push(`Duplicate face id: ${face.id}`);
    }
    faceIds.add(face.id);

    if (face.color !== undefined && !isHexColor(face.color)) {
      errors.push(`Invalid face color: ${face.id}.${face.color}`);
    }

    for (const vertex of face.vertices) {
      const joint = rig.joints.find((candidate) => candidate.id === vertex.jointId);
      const axis = joint?.axes.find((candidate) => candidate.id === vertex.axisId);
      if (!joint) {
        errors.push(`Face ${face.id} references unknown joint: ${vertex.jointId}`);
      } else if (!axis) {
        errors.push(
          `Face ${face.id} references unknown axis: ${vertex.jointId}.${vertex.axisId}`,
        );
      } else if (!axis.pointSides.includes(vertex.side)) {
        errors.push(
          `Face ${face.id} references inactive point: ${vertex.jointId}.${vertex.axisId}[${vertex.side}]`,
        );
      }
    }
  }

  return errors;
}

export class RigState {
  private readonly listeners = new Set<() => void>();

  public constructor(
    public readonly rig: Rig,
    public readonly limits: Readonly<RigLimits> = DEFAULT_RIG_LIMITS,
  ) {
    const errors = validateRig(rig, limits);
    if (errors.length > 0) {
      throw new Error(`Invalid rig:\n${errors.join("\n")}`);
    }
  }

  public getJoint(jointId: string) {
    const joint = this.rig.joints.find((candidate) => candidate.id === jointId);
    if (!joint) {
      throw new Error(`Unknown joint: ${jointId}`);
    }
    return joint;
  }

  public getFace(faceId: string) {
    const face = this.rig.faces.find((candidate) => candidate.id === faceId);
    if (!face) {
      throw new Error(`Unknown face: ${faceId}`);
    }
    return face;
  }

  public moveJoint(jointId: string, x: number, y: number): void {
    const joint = this.getJoint(jointId);
    joint.x = x;
    joint.y = y;
    this.notify();
  }

  public setJointRadius(jointId: string, radius: number): void {
    if (!Number.isFinite(radius)) return;
    this.getJoint(jointId).radius = Math.min(80, Math.max(8, radius));
    this.notify();
  }

  public setJointBodyVisible(jointId: string, visible: boolean): void {
    this.getJoint(jointId).bodyVisible = visible;
    this.notify();
  }

  public setFaceColor(faceId: string, color: string): void {
    if (!isHexColor(color)) return;
    this.getFace(faceId).color = color;
    this.notify();
  }

  public clearFaceColor(faceId: string): void {
    delete this.getFace(faceId).color;
    this.notify();
  }

  public setDefaultColor(color: string): void {
    if (!isHexColor(color)) return;
    this.rig.defaultColor = color;
    this.notify();
  }

  public setAxisAngle(jointId: string, axisId: string, angle: number): void {
    if (!Number.isFinite(angle)) return;
    const axis = this.getJoint(jointId).axes.find(
      (candidate) => candidate.id === axisId,
    );
    if (!axis) {
      throw new Error(`Unknown axis: ${jointId}.${axisId}`);
    }
    axis.angle = ((angle % 360) + 360) % 360;
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
