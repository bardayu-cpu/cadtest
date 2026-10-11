import type { Opening, Room, Vec2, Wall } from '../model/types';

export interface RecognitionData {
  mmPerPixel: number | null;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
}

export interface ExpectedFloorplan extends RecognitionData {
  mmPerPixel: number;
  image: string;
  imageSize: { width: number; height: number };
  calibration: {
    label: string;
    startPixel: Vec2;
    endPixel: Vec2;
    lengthMm: number;
  }[];
}
