export interface Joint {
  id: string;
  x: number;
  y: number;
  radius: number;
  rotation: number;
  guideVisible: boolean;
  bodyVisible: boolean;
}

export interface Port {
  id: string;
  jointId: string;
  angle: number;
}

export interface Face {
  id: string;
  portIds: string[];
  color: string;
  zIndex: number;
}

export interface Rig {
  joints: Joint[];
  ports: Port[];
  faces: Face[];
}
