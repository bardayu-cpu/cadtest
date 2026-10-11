// All model lengths are millimetres; angles are degrees.
export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
export type Source = 'auto' | 'manual';

export interface Wall {
  id: string;
  start: Vec2;
  end: Vec2;
  thickness: number;
  height?: number;
  source: Source;
  confidence?: number;
}

export interface Opening {
  id: string;
  wallId: string;
  offset: number;
  width: number;
  kind: 'door' | 'window' | 'sliding_door' | 'opening' | 'floor_window';
  sillHeight: number;
  headHeight: number;
  source: Source;
  confidence?: number;
}

export type RoomType =
  | 'living'
  | 'dining'
  | 'bedroom'
  | 'master_bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'study'
  | 'balcony'
  | 'entrance'
  | 'corridor'
  | 'other';

export interface Room {
  id: string;
  type: RoomType;
  name: string;
  polygon: Vec2[];
  ceilingStyle: 'flat' | 'cove_light' | 'drop_edge';
  source: Source;
}

export interface FurnitureItem {
  id: string;
  catalogId: string;
  position: Vec2;
  rotation: number;
  size: { w: number; d: number; h: number };
  elevation: number;
  roomId?: string;
  source: Source;
}

export interface StyleConfig {
  presetId?: string;
  keywords?: string;
  referenceImageDataUrl?: string;
  seed: number;
  materialPalette?: string[];
}

export interface AnchorLink {
  targetAnchorId: string;
  yaw: number;
  pitch: number;
  label: string;
}

export interface Anchor {
  id: string;
  name: string;
  roomId: string;
  position: Vec3;
  initialHeading: number;
  links: AnchorLink[];
  source: Source;
}

export interface ImageResult {
  id: string;
  createdAt: string;
  imageDataUrl: string;
  provider: string;
  params: Record<string, unknown>;
}

export interface PanoramaResult extends ImageResult {
  anchorId: string;
  approved: boolean;
}

export interface RecognitionReport {
  createdAt: string;
  method: 'cv' | 'vision_model' | 'cv+vision_model';
  scaleDetected: boolean;
  warnings: string[];
}

export interface Project {
  id: string;
  name: string;
  version: 2;
  background: {
    imageDataUrl: string;
    mmPerPixel: number;
    offset: Vec2;
    opacity: number;
  };
  settings: { wallHeight: number; defaultWallThickness: number };
  recognition?: RecognitionReport;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  furniture: FurnitureItem[];
  requirements?: string;
  style: StyleConfig;
  floorPlanRenders: ImageResult[];
  approvedFloorPlanId?: string;
  anchors: Anchor[];
  panoramas: PanoramaResult[];
  publish?: { shareId: string; publishedAt: string; revoked: boolean };
}
export interface ProjectIndexEntry {
  id: string;
  name: string;
  updatedAt: string;
}
