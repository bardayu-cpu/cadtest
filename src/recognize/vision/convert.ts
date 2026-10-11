import type { Wall } from '../../model/types';
import type { RecognitionData } from '../types';
import type { VisionPlan } from './schema';

export function visionWalls(plan: VisionPlan, scale: number): Wall[] {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error('Invalid vision scale.');
  return plan.walls.map((w) => ({
    id: w.id,
    start: { x: w.start.x * scale, y: w.start.y * scale },
    end: { x: w.end.x * scale, y: w.end.y * scale },
    thickness: w.thicknessPixels * scale,
    source: 'auto',
    confidence: 0.5,
  }));
}

/** Convert model-only pixels to the repository's mm model, without CV refinement. */
export function visionToRecognition(
  plan: VisionPlan,
  scale: number,
  walls = visionWalls(plan, scale),
): RecognitionData {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error('Invalid vision scale.');
  const openings = plan.openings.flatMap((opening, index) => {
    const center = { x: opening.center.x * scale, y: opening.center.y * scale };
    const candidates = walls
      .map((wall) => {
        const dx = wall.end.x - wall.start.x,
          dy = wall.end.y - wall.start.y,
          length = Math.hypot(dx, dy);
        const offset = Math.max(
          0,
          Math.min(
            length,
            ((center.x - wall.start.x) * dx + (center.y - wall.start.y) * dy) /
              length,
          ),
        );
        const separation = Math.hypot(
          center.x - wall.start.x - (dx * offset) / length,
          center.y - wall.start.y - (dy * offset) / length,
        );
        return { wall, offset, separation };
      })
      .filter((c) => Number.isFinite(c.separation));
    // Prefer the model's referenced segment, otherwise the merged containing
    // segment. Projection is required by Opening's wallId/offset representation.
    const candidate =
      candidates.find((c) => c.wall.id === opening.wallId) ??
      candidates.sort((a, b) => a.separation - b.separation)[0];
    if (!candidate) return [];
    return [
      {
        id: `vision-opening-${index + 1}`,
        wallId: candidate.wall.id,
        offset: candidate.offset,
        width: opening.widthPixels * scale,
        kind: opening.kind,
        sillHeight: opening.kind === 'window' ? 900 : 0,
        headHeight: opening.kind.includes('window') ? 2400 : 2100,
        source: 'auto' as const,
        confidence: 0.5,
      },
    ];
  });
  const rooms = plan.rooms.map((room, index) => ({
    id: `vision-room-${index + 1}`,
    type: room.type,
    name: room.name,
    polygon: room.polygon.map((p) => ({ x: p.x * scale, y: p.y * scale })),
    ceilingStyle: 'flat' as const,
    source: 'auto' as const,
  }));
  return { mmPerPixel: scale, walls, openings, rooms };
}
