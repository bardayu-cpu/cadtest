import { createProject } from '../../src/model/project';
import type { Project } from '../../src/model/types';

export function completeProject(): Project {
  return {
    ...createProject('完整测试项目'),
    background: {
      imageDataUrl: 'data:image/png;base64,background',
      mmPerPixel: 12.5,
      offset: { x: -100, y: 200 },
      opacity: 0.6,
    },
    recognition: {
      createdAt: '2026-10-11T00:00:00Z',
      method: 'cv+vision_model',
      scaleDetected: true,
      warnings: ['比例尺需确认'],
    },
    walls: [
      {
        id: 'wall-1',
        start: { x: 0, y: 0 },
        end: { x: 5000, y: 0 },
        thickness: 240,
        height: 2800,
        source: 'auto',
        confidence: 0.9,
      },
    ],
    openings: [
      {
        id: 'opening-1',
        wallId: 'wall-1',
        offset: 1000,
        width: 900,
        kind: 'door',
        sillHeight: 0,
        headHeight: 2100,
        source: 'auto',
        confidence: 0.8,
      },
    ],
    rooms: [
      {
        id: 'room-1',
        type: 'living',
        name: '客厅',
        polygon: [
          { x: 0, y: 0 },
          { x: 5000, y: 0 },
          { x: 5000, y: 4000 },
          { x: 0, y: 4000 },
        ],
        ceilingStyle: 'cove_light',
        source: 'auto',
      },
    ],
    furniture: [
      {
        id: 'furniture-1',
        catalogId: 'sofa',
        position: { x: 1200, y: 1500 },
        rotation: 90,
        size: { w: 2400, d: 900, h: 800 },
        elevation: 0,
        roomId: 'room-1',
        source: 'auto',
      },
    ],
    requirements: '两人住',
    style: {
      presetId: 'cream-walnut',
      keywords: '暖色',
      referenceImageDataUrl: 'data:image/png;base64,reference',
      seed: 42,
      materialPalette: ['原木地板', '奶油色墙面'],
    },
    floorPlanRenders: [
      {
        id: 'floorplan-1',
        createdAt: '2026-10-11T00:00:00Z',
        imageDataUrl: 'data:image/png;base64,plan',
        provider: 'mock',
        params: {
          seed: 42,
          controls: { depth: 'depth', enabled: true },
          extra: [1, null, 'value'],
        },
      },
    ],
    approvedFloorPlanId: 'floorplan-1',
    anchors: [
      {
        id: 'anchor-1',
        name: '客厅',
        roomId: 'room-1',
        position: { x: 2000, y: 2000, z: 1400 },
        initialHeading: 90,
        links: [
          {
            targetAnchorId: 'anchor-2',
            yaw: 20,
            pitch: -10,
            label: '另一视角',
          },
        ],
        source: 'auto',
      },
      {
        id: 'anchor-2',
        name: '另一视角',
        roomId: 'room-1',
        position: { x: 3000, y: 2000, z: 1400 },
        initialHeading: 180,
        links: [],
        source: 'auto',
      },
    ],
    panoramas: [
      {
        id: 'panorama-1',
        anchorId: 'anchor-2',
        approved: true,
        createdAt: '2026-10-11T00:00:00Z',
        imageDataUrl: 'data:image/png;base64,panorama',
        provider: 'mock',
        params: { mode: 'panorama' },
      },
    ],
    publish: {
      shareId: 'random-public-id',
      publishedAt: '2026-10-11T00:00:00Z',
      revoked: false,
    },
  };
}
