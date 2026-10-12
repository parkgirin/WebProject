import type { Joint, Port } from "./types";

export interface Point {
  x: number;
  y: number;
}

export function getPortPoint(joint: Joint, port: Port): Point {
  const radians = ((joint.rotation + port.angle) * Math.PI) / 180;

  return {
    x: joint.x + Math.cos(radians) * joint.radius,
    y: joint.y + Math.sin(radians) * joint.radius,
  };
}
